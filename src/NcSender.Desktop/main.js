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
let isKiosk = process.argv.includes('--kiosk');

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
    show: true,
    backgroundColor: '#1a1a2e',
    kiosk: isKiosk,
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

  if (!isKiosk) {
    try {
      mainWindow.maximize();
    } catch {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width, height } = primaryDisplay.workArea;
      mainWindow.setBounds({ x, y, width, height });
    }
  }

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

  // Show a loading page that polls the server and redirects when ready.
  // This shows the window immediately instead of a blank screen for 15+ seconds.
  // Read the SVG logo and encode it for embedding in the loader page
  const fs = require('fs');
  let logoSrc = '';
  try {
    const svgPath = path.join(__dirname, 'Assets', 'ncsender-light.svg');
    const svgData = fs.readFileSync(svgPath);
    logoSrc = `data:image/svg+xml;base64,${svgData.toString('base64')}`;
  } catch { /* fall back to text */ }

  const loaderHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><style>
  body { margin: 0; background: #1a1a2e; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; }
  .container { text-align: center; }
  .logo { width: 120px; height: auto; animation: pulse 2s ease-in-out infinite; margin-bottom: 16px; }
  @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  .text { font-size: 18px; opacity: 0.5; }
</style></head>
<body><div class="container">${logoSrc ? `<img class="logo" src="${logoSrc}" alt="ncSender" />` : '<div style="font-size:28px;font-weight:700;animation:pulse 2s ease-in-out infinite;margin-bottom:16px;">ncSender</div>'}<div class="text">Starting...</div></div>
<script>
  function poll() {
    fetch('http://localhost:${SERVER_PORT}/api/health')
      .then(r => { if (r.ok) window.location.href = 'http://localhost:${SERVER_PORT}'; else setTimeout(poll, 300); })
      .catch(() => setTimeout(poll, 300));
  }
  poll();
</script></body></html>`)}`;
  mainWindow.loadURL(loaderHtml);

  startServer();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  killServer();
});
