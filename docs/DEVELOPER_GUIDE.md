# Developer Guide — ncSender

This guide covers the codebase layout, development workflow, build scripts, and release process for ncSender.

## Architecture Overview
- Electron application that embeds a local HTTP + WebSocket server.
- Vue 3 + Vite frontend served by the embedded server in production, or Vite dev server in development.
- Feature‑oriented server modules (Express) for CNC control, G‑code jobs, settings, firmware, etc.
- CNC communication via `serialport` or TCP (Ethernet/telnet‑style) with a command queue and GRBL/GrblHAL parsing.

## Project Structure
```
app/
  electron/
    main.js            # Electron entry point; starts the embedded server
    server.js          # Bootstrap for the Express + WS server
    app.js             # Express app + WebSocket + route mounting
    core/              # Settings manager, state helpers
    features/
      cnc/             # Controller, command queue, jogging, GRBL parsing, routes
      gcode/           # Upload/list/load/delete routes and job runner
      firmware/        # GrblHAL settings enumeration, import/export, submit
      settings/        # App/connection settings routes
      system/          # Health/status routes
  client/
    src/               # Vue 3 app (components, features, stores)
    dist/              # Built frontend assets (Vite)
  package.json         # Electron app scripts + builder config

.github/workflows/release-build.yml  # CI to produce multi‑platform artifacts on tags
.scripts/                            # Helper scripts used locally/for CI
```

## Prerequisites
- Node.js 20+
- npm 9+

macOS
- Xcode Command Line Tools for native modules

Windows
- Recommended: recent MSVC Build Tools (for native modules) if you encounter build issues

## Install Dependencies
```
cd app
npm run install:all   # installs in app/ and app/client/
```

## Development
Run the embedded server + Vite client with hot reload:
```
cd app
npm run dev:hot
```
- Frontend Vite dev server: `http://localhost:5174` (proxies `/api/*` → `8090`).
- Backend API/WebSocket server: `http://localhost:8090`.

Useful variants
- Electron window with dev build: `npm run dev`
- Kiosk mode: `npm run dev:kiosk`
- Headless server only: `npm run dev:headless` (browse to `http://localhost:8090`).

Notes
- The frontend uses relative URLs in production and dev proxying in development. No hard‑coded host/ports in UI code.

## Build and Run (local)
Production‑like desktop run (builds UI, launches Electron):
```
cd app
npm run start
```

Package installers/binaries using electron‑builder:
```
cd app
npm run dist       # builds client + packages for current OS
```

Artifacts are written to `app/dist-electron/`.

Helper scripts (optional)
- `./.scripts/build-local.sh` — convenience script to produce local artifacts per‑OS (runs on matching host OS only). Outputs under `releases/<platform-arch>/`.

Cross‑platform note
- Due to native modules (e.g., `serialport`), local packaging generally targets the host OS/arch.

## Release via GitHub Actions
Tagging a commit triggers CI to build artifacts for macOS (x64, arm64), Windows (x64), and Linux (x64) and create a GitHub Release.

Steps
```
git tag vX.Y.Z
git push origin vX.Y.Z
```

Workflow summary (`.github/workflows/release-build.yml`)
- Builds client and Electron app per OS/arch
- Uploads artifacts
- Creates a Release and attaches renamed assets

Optional local checks
- Validate workflow syntax: `actionlint .github/workflows/release-build.yml`
- Dry run `act` if you use it locally (Linux job only without additional configuration).

## Server/Client Ports
- Production (packaged/Electron): one configurable port (default `8090`) serves UI + API + WS.
- Dev (hot reload): Vite on `5174`, backend on `8090` with proxy.
- `serverPort` is persisted in `settings.json` and requires an app restart to apply.

## Data Locations
Created automatically on first run:
- macOS: `~/Library/Application Support/ncSender/`
- Windows: `%APPDATA%/ncSender/`
- Linux: `~/.config/ncSender/`

Subfolders/files
- `gcode-files/` for user uploads
- `settings.json` for app/connection settings
- `firmware.json` for cached firmware structure

## Key Modules
- CNC Controller: `app/electron/features/cnc/controller.js`
  - Serial over USB or TCP sockets
  - GRBL status parsing (`<...>`), `$G` modes, error/alarm handling
  - Command queue with real‑time commands and ACK propagation
- G‑code Job Runner: `app/electron/features/gcode/job-routes.js`
  - Line‑by‑line streaming, pause/resume/stop with safe timings
  - Progress provider hooks and server‑side ETA calculation
- Firmware (GrblHAL): `app/electron/features/firmware/routes.js`
  - Enumerates groups/settings via `$EG`, `$ES`, `$ESH`, reads `$$`, and supports submit

## Contributing
See `docs/CONTRIBUTING.md` for guidelines. Please run on your target OS and include logs and repro steps when filing bugs.

