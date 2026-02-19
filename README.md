# kanban-desktop
Electron-based Linux app for accessing CryptPad Kanban boards.

This app was initially generated with AI assistance and then adjusted manually.
The goal was to provide a working desktop app for CryptPad Kanban on AUR.

## Configuration (`kanban.conf`)

The app can load the startup board URL from:

- `~/.config/kanban.conf`

Rules:

- The first non-empty line that does not start with `#` is used as the URL.
- If the file is missing or the URL is invalid, the app falls back to stored state and then the built-in default URL.

Example `~/.config/kanban.conf`:

```conf
# Personal board
https://cryptpad.arch-linux.cz/kanban/b/your-board-id
```

## Workspace Restore (XFCE)

- On Linux, the app stores the last virtual desktop/workspace where the window was visible.
- On next launch, it restores the window to that workspace.
- Restore uses `wmctrl` first, with fallbacks to `xdotool` and `xprop`.
