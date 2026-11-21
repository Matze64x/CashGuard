#!/bin/sh
# Packs the portable Linux version after `npm run tauri build`: the AppImage plus an empty
# `CashGuard-data` folder next to it, which makes the app keep all its data there (see
# src-tauri/src/data_dir.rs). Writes src-tauri/target/release/bundle/portable/*.tar.gz.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./src-tauri/tauri.conf.json').version")
bundle=src-tauri/target/release/bundle
name="CashGuard_${version}_amd64-portable"
rm -rf "$bundle/portable/$name"
mkdir -p "$bundle/portable/$name/CashGuard-data"
cp "$bundle/appimage/CashGuard_${version}_amd64.AppImage" "$bundle/portable/$name/CashGuard.AppImage"
cp scripts/portable-readme.txt "$bundle/portable/$name/CashGuard-data/README.txt"
tar --owner=0 --group=0 --numeric-owner -czf "$bundle/portable/$name.tar.gz" -C "$bundle/portable" "$name"
echo "$bundle/portable/$name.tar.gz"
