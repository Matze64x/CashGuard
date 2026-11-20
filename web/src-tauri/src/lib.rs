use tauri::Manager;

mod synced_file;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second instance would keep its own copy of the data; focus the running one instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(synced_file::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            synced_file::read_synced_file,
            synced_file::write_synced_file,
            synced_file::watch_synced_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the CashGuard desktop app");
}
