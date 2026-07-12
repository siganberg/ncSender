const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const http = require('http');

// Disable Chromium sandbox on Linux so child processes (server) can use sudo
// for updates. Without this, app.relaunch() loses --no-sandbox from the
// wrapper script and PR_SET_NO_NEW_PRIVS blocks sudo in the server process.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('use-angle', 'gles');
}

const SERVER_PORT = 8090;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const HEALTH_URL = `${SERVER_URL}/api/health`;

let mainWindow = null;
let serverProcess = null;
// Kiosk mode is signalled either by the `--kiosk` CLI flag OR by the
// `NCSENDER_KIOSK=1` env var. Prefer the env var on the Q6A kiosk so
// that Chromium's own `--kiosk` switch isn't applied — that switch
// forces the window fullscreen and visible before its first paint,
// which reintroduces a bright pre-render flash regardless of the
// BrowserWindow `show: false`.
let isKiosk = process.argv.includes('--kiosk') || process.env.NCSENDER_KIOSK === '1';

// ── Server lifecycle ────────────────────────────────────────────────────────

function getServerPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';

  if (app.isPackaged) {
    // Packaged: resources/server/NcSender.Server[.exe]
    return path.join(process.resourcesPath, 'server', `NcSender.Server${ext}`);
  }

  // Dev: use dotnet run
  return null;
}

function startServer() {
  const serverBin = getServerPath();

  if (serverBin) {
    // Packaged mode — run the binary directly via spawn (not execFile which has
    // a 1MB maxBuffer limit that can kill the child process)
    serverProcess = spawn(serverBin, [], {
      env: {
        ...process.env,
        ASPNETCORE_URLS: `http://localhost:${SERVER_PORT}`,
        NCSENDER_PACKAGED: '1',
      },
      stdio: 'ignore',
    });
  } else {
    // Dev mode — use dotnet run
    const serverProject = path.join(__dirname, '..', 'NcSender.Server');
    serverProcess = spawn('dotnet', ['run', '--project', serverProject], {
      env: {
        ...process.env,
        ASPNETCORE_URLS: `http://localhost:${SERVER_PORT}`,
      },
      stdio: 'ignore',
    });
  }

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err.message);
  });

  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    serverProcess = null;

    // Exit code 42 = update installed, relaunch the app
    if (code === 42) {
      app.relaunch();
      app.exit(0);
    }
  });
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Server startup timed out'));
      }

      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else {
          setTimeout(poll, 200);
        }
      });

      req.on('error', () => setTimeout(poll, 200));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(poll, 200);
      });
    }

    poll();
  });
}

function killServer() {
  if (!serverProcess) return;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', serverProcess.pid.toString(), '/f', '/t']);
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch {
    // already exited
  }

  serverProcess = null;
}

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  const winOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    // Don't show the window until Chromium has actually painted the
    // page — Electron's backgroundColor is unreliable on Linux and
    // shows white during the "compositor is up but no page yet"
    // window. `ready-to-show` fires after the renderer's first frame.
    show: false,
    backgroundColor: '#1a1a2e',
    // transparent + frame:false makes Chromium clear the WebContents
    // surface with alpha=0 instead of the default white — so whatever
    // is behind (swaybg's #1a1a2e Wayland background) shows through
    // during the tiny window between `show()` and the first React
    // frame landing. Eliminates the residual white flash that
    // `show: false + ready-to-show` alone leaves behind.
    transparent: true,
    frame: false,
    // Kiosk is deferred to the `ready-to-show` handler — `kiosk: true`
    // at construction forces the window fullscreen and visible before
    // Chromium has painted anything, which reintroduces the white
    // flash we're trying to prevent.
    kiosk: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  // Only set icon on Windows/Linux — macOS uses .icns from the .app bundle
  if (process.platform === 'win32') {
    winOptions.icon = path.join(__dirname, 'Assets', 'icon.ico');
  } else if (process.platform === 'linux') {
    winOptions.icon = path.join(__dirname, 'Assets', 'icons', '256x256.png');
  }

  mainWindow = new BrowserWindow(winOptions);
  // Maximize is deferred to the `ready-to-show` handler in the app
  // lifecycle block; calling it here would force the window to appear
  // and defeat the `show: false` flash-suppression.

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('app:quit', () => {
  app.quit();
});

ipcMain.handle('app:isKiosk', () => {
  return isKiosk;
});

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

function registerShortcuts() {
  // F11 — toggle fullscreen
  globalShortcut.register('F11', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  // F12 — toggle devtools
  globalShortcut.register('F12', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Ctrl+Alt+Q — quit kiosk mode
  globalShortcut.register('CommandOrControl+Alt+Q', () => {
    app.quit();
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerShortcuts();
  createWindow();

  // Server starts fast enough now (~1s from launch to /api/health OK on
  // the Q6A kiosk) that we can skip the intermediate loader page and
  // point Chromium at the app URL directly. If Chromium reaches the URL
  // before the server accepts connections it fires `did-fail-load`; we
  // retry every 200ms until it succeeds. The BrowserWindow background
  // is `#1a1a2e` so the pre-load window matches the app's ground —
  // no white flash, no visible spinner.
  const appUrl = `http://localhost:${SERVER_PORT}`;

  // `show: false` on the BrowserWindow means it doesn't appear until we
  // call `.show()`. Trigger that on `ready-to-show`, which fires after
  // the renderer has painted its first frame — no white flash.
  mainWindow.once('ready-to-show', () => {
    if (isKiosk) {
      mainWindow.setKiosk(true);
    } else {
      try {
        mainWindow.maximize();
      } catch {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { x, y, width, height } = primaryDisplay.workArea;
        mainWindow.setBounds({ x, y, width, height });
      }
    }
    mainWindow.show();
  });

  // Wait for the server to accept connections BEFORE calling loadURL —
  // an earlier version used `did-fail-load` + `setTimeout` retry, but
  // that let Chromium briefly render its network-error page (which is
  // white) before the retry succeeded, and `ready-to-show` fired with
  // that error page as content. Polling here means loadURL only ever
  // sees a live server.
  startServer();
  const http = require('http');
  const waitForServer = () => new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(`${appUrl}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        setTimeout(tryOnce, 100);
      });
      req.on('error', () => setTimeout(tryOnce, 100));
      req.setTimeout(1000, () => { req.destroy(); setTimeout(tryOnce, 100); });
    };
    tryOnce();
  });
  await waitForServer();
  mainWindow.loadURL(appUrl);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  killServer();
});
