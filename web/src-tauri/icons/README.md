# Icons

`app-icon.svg` is the master (a black rounded tile). `app-icon-square.svg` is the same on a full
square for the iPhone (it rounds the corners itself), `app-icon-maskable.svg` a smaller one for
Android (it cuts a circle or other shape out of it). Change all three together. Everything else is
made from them:

```sh
cd web
npx tauri icon src-tauri/icons/app-icon.svg -o /tmp/icons   # then copy the files that are here
rsvg-convert -w 192 -h 192 src-tauri/icons/app-icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 src-tauri/icons/app-icon.svg -o public/icon-512.png
rsvg-convert -w 512 -h 512 src-tauri/icons/app-icon-maskable.svg -o public/icon-maskable-512.png
rsvg-convert -w 180 -h 180 src-tauri/icons/app-icon-square.svg -o public/apple-touch-icon.png
```

`public/favicon.svg` is a simplified copy for browser tabs (no fine details, bolder lines): change
it along with the master.
