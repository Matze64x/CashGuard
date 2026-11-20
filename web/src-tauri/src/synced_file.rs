//! Reading, writing and watching the synced CashGuard file.
//!
//! Writes are atomic (temporary file in the same directory, then rename), like the C++ client's,
//! so a crash or a sync tool reading at the wrong moment never sees a half-written file. They are
//! also conditional: the file is only replaced if it still has the content the app last read (or
//! doesn't exist yet, when creating it). The check happens right before the rename, so another
//! writer (Syncthing, the C++ client) can only slip in during a few microseconds. Before replacing
//! a file, a copy is kept in the app's data directory, so even that case is recoverable.

use std::ffi::OsString;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

/// Event sent to the frontend when the watched file may have changed on disk.
pub const CHANGED_EVENT: &str = "synced-file-changed";
/// Error prefixes the frontend reacts to (the rest of the message is for humans).
pub const CHANGED_ERROR: &str = "CHANGED:";
pub const EXISTS_ERROR: &str = "EXISTS:";
/// How many backups are kept per file name.
const BACKUPS_KEPT: usize = 30;

/// Writes to the real file when `path` is a symlink, so the link (e.g. into a sync folder) stays.
fn resolve(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn split(path: &Path) -> std::io::Result<(PathBuf, OsString)> {
    let name = path.file_name().ok_or_else(|| std::io::Error::other("not a file path"))?;
    let dir = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    Ok((dir.to_path_buf(), name.to_owned()))
}

pub fn read(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

#[derive(Debug, PartialEq)]
pub enum Expected<'a> {
    /// The file must not exist yet
    Missing,
    /// The file must have exactly this content
    Content(&'a str),
}

#[derive(Debug)]
pub enum WriteError {
    /// The file isn't in the expected state; nothing was written
    Changed,
    Exists,
    Io(std::io::Error),
}

impl From<std::io::Error> for WriteError {
    fn from(e: std::io::Error) -> Self {
        WriteError::Io(e)
    }
}

/// Atomically replaces (or creates) the file, if it's in the expected state. Keeps a backup of
/// the replaced content in `backup_dir` and the file's permissions.
pub fn write_atomic(path: &Path, contents: &str, expected: Expected, backup_dir: Option<&Path>) -> Result<(), WriteError> {
    let path = resolve(path);
    let (dir, name) = split(&path)?;
    // the process id makes the name unique per app instance; writes within one are sequential
    let tmp = dir.join(format!(".{}.tmp{}", name.to_string_lossy(), std::process::id()));
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // check right before replacing, to keep the window for another writer as small as possible
        let current = match fs::read_to_string(&path) {
            Ok(text) => Some(text),
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        match (&expected, &current) {
            (Expected::Missing, Some(_)) => return Err(WriteError::Exists),
            (Expected::Content(want), Some(have)) if want != have => return Err(WriteError::Changed),
            (Expected::Content(_), None) => return Err(WriteError::Changed),
            _ => {}
        }
        if let Some(current) = &current {
            fs::set_permissions(&tmp, fs::metadata(&path)?.permissions())?;
            if let Some(backup_dir) = backup_dir {
                backup(backup_dir, &name, current)?;
            }
        }
        fs::rename(&tmp, &path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Saves `contents` as `<stem>-<unix seconds>.json` in `dir` and removes all but the newest backups.
fn backup(dir: &Path, name: &OsString, contents: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let stem = Path::new(name).file_stem().unwrap_or(name).to_string_lossy().into_owned();
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    fs::write(dir.join(format!("{stem}-{seconds:012}.json")), contents)?;
    let prefix = format!("{stem}-");
    let mut backups: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&prefix)))
        .collect();
    // zero-padded timestamps sort chronologically
    backups.sort();
    for old in backups.iter().rev().skip(BACKUPS_KEPT) {
        fs::remove_file(old)?;
    }
    Ok(())
}

/// Whether a file system event may concern the file `name`.
fn is_relevant(event: &notify::Event, name: &OsString) -> bool {
    // after an overflow the system lost track of events, so anything may have changed
    event.need_rescan() || (!event.kind.is_access() && event.paths.iter().any(|p| p.file_name() == Some(name.as_os_str())))
}

/// The current watcher; replacing it stops watching the previous file.
#[derive(Default)]
pub struct WatcherState(Mutex<Option<RecommendedWatcher>>);

/// Watches the file's directory rather than the file itself: sync tools and atomic writes replace
/// the file by renaming, which a watch on the old file would not survive.
fn watch(app: AppHandle, path: &Path) -> notify::Result<RecommendedWatcher> {
    let (dir, name) = split(&resolve(path))?;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        // on errors the watcher may have missed something, so let the frontend check
        if event.as_ref().map_or(true, |e| is_relevant(e, &name)) {
            // the frontend debounces and compares contents, so duplicate events are harmless
            let _ = app.emit(CHANGED_EVENT, ());
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

// Commands run on a worker thread (async), so slow disks don't freeze the window.

#[tauri::command(async)]
pub fn read_synced_file(path: PathBuf) -> Result<String, String> {
    read(&resolve(&path)).map_err(|e| format!("Can't read {}: {e}", path.display()))
}

/// `expected`: the content the file must still have, or `None` to create a new file.
#[tauri::command(async)]
pub fn write_synced_file(app: AppHandle, path: PathBuf, contents: String, expected: Option<String>) -> Result<(), String> {
    let expected = expected.as_deref().map_or(Expected::Missing, Expected::Content);
    let backup_dir = app.path().app_data_dir().ok().map(|d| d.join("backups"));
    write_atomic(&path, &contents, expected, backup_dir.as_deref()).map_err(|e| match e {
        WriteError::Changed => format!("{CHANGED_ERROR} {} changed on disk", path.display()),
        WriteError::Exists => format!("{EXISTS_ERROR} {} already exists", path.display()),
        WriteError::Io(e) => format!("Can't write {}: {e}", path.display()),
    })
}

#[tauri::command(async)]
pub fn watch_synced_file(app: AppHandle, state: State<'_, WatcherState>, path: PathBuf) -> Result<(), String> {
    let watcher = watch(app, &path).map_err(|e| format!("Can't watch {}: {e}", path.display()))?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn creates_and_replaces_atomically_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cashguard.json");
        write_atomic(&path, "first", Expected::Missing, None).unwrap();
        write_atomic(&path, "second ü€", Expected::Content("first"), None).unwrap();
        assert_eq!(read(&path).unwrap(), "second ü€");
        assert_eq!(names(dir.path()), vec!["cashguard.json"]);
    }

    #[test]
    fn refuses_to_overwrite_unexpected_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cashguard.json");
        fs::write(&path, "written by someone else").unwrap();
        assert!(matches!(write_atomic(&path, "new", Expected::Content("what we read"), None), Err(WriteError::Changed)));
        assert!(matches!(write_atomic(&path, "new", Expected::Missing, None), Err(WriteError::Exists)));
        fs::remove_file(&path).unwrap();
        assert!(matches!(write_atomic(&path, "new", Expected::Content("what we read"), None), Err(WriteError::Changed)));
        assert_eq!(names(dir.path()), Vec::<String>::new());
    }

    #[test]
    #[cfg(unix)]
    fn keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cashguard.json");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&path, "new", Expected::Content("old"), None).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    #[cfg(unix)]
    fn writes_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.json");
        let link = dir.path().join("link.json");
        fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&link, "new", Expected::Content("old"), None).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(read(&real).unwrap(), "new");
    }

    #[test]
    fn backs_up_the_replaced_content_and_keeps_only_the_newest_backups() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        fs::create_dir(&backups).unwrap();
        for i in 0..BACKUPS_KEPT + 5 {
            fs::write(backups.join(format!("cashguard-{i:012}.json")), "older").unwrap();
        }
        let path = dir.path().join("cashguard.json");
        fs::write(&path, "previous").unwrap();
        write_atomic(&path, "new", Expected::Content("previous"), Some(&backups)).unwrap();
        let kept = names(&backups);
        assert_eq!(kept.len(), BACKUPS_KEPT);
        assert_eq!(fs::read_to_string(backups.join(kept.last().unwrap())).unwrap(), "previous");
    }

    #[test]
    fn relevant_events() {
        use notify::event::{AccessKind, CreateKind, EventKind, Flag};
        let name = OsString::from("cashguard.json");
        let event = |kind, path: &str| notify::Event::new(kind).add_path(PathBuf::from(path));
        assert!(is_relevant(&event(EventKind::Create(CreateKind::File), "/sync/cashguard.json"), &name));
        assert!(!is_relevant(&event(EventKind::Create(CreateKind::File), "/sync/other.json"), &name));
        assert!(!is_relevant(&event(EventKind::Access(AccessKind::Read), "/sync/cashguard.json"), &name));
        assert!(is_relevant(&notify::Event::new(EventKind::Other).set_flag(Flag::Rescan), &name));
    }
}
