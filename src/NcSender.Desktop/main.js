const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('use-angle', 'gles');
}

const SERVER_PORT = 8090;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const HEALTH_URL = `${SERVER_URL}/api/health`;
const SHUTDOWN_URL = `${SERVER_URL}/api/shutdown`;

let mainWindow = null;
let serverProcess = null;
let isKiosk = process.argv.includes('--kiosk');
let weStartedServer = false;

// ── Server lifecycle ────────────────────────────────────────────────────────

function getServerPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server', `NcSender.Server${ext}`);
  }
  return null;
}

function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

function startServerAsChild() {
  const serverBin = getServerPath();
  const serverEnv = {
    ...process.env,
    ASPNETCORE_URLS: `http://localhost:${SERVER_PORT}`,
    NCSENDER_PACKAGED: '1',
  };

  if (serverBin) {
    serverProcess = spawn(serverBin, [], { env: serverEnv, stdio: 'ignore' });
  } else {
    const serverProject = path.join(__dirname, '..', 'NcSender.Server');
    serverProcess = spawn('dotnet', ['run', '--project', serverProject], {
      env: { ...process.env, ASPNETCORE_URLS: `http://localhost:${SERVER_PORT}` },
      stdio: 'ignore',
    });
  }

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err.message);
  });

  serverProcess.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    serverProcess = null;
    if (code === 42) {
      app.relaunch();
      app.exit(0);
    }
  });

  weStartedServer = true;
}

function shutdownServer() {
  return new Promise((resolve) => {
    const req = http.request(SHUTDOWN_URL, { method: 'POST' }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', () => resolve());
    req.setTimeout(2000, () => { req.destroy(); resolve(); });
    req.end();
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
  } catch { /* already exited */ }
  serverProcess = null;
}

// Monitor server health — if server dies after being healthy (e.g., after update
// install with exit code 42), relaunch the app so launch.sh restarts the server.
let serverWasHealthy = false;
let isQuitting = false;

function startServerMonitor() {
  serverWasHealthy = true;
  const interval = setInterval(() => {
    if (isQuitting) { clearInterval(interval); return; }

    const req = http.get(HEALTH_URL, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 400) {
        onServerDied(interval);
      }
    });
    req.on('error', () => { onServerDied(interval); });
    req.setTimeout(2000, () => { req.destroy(); });
  }, 3000);
}

function onServerDied(interval) {
  if (!serverWasHealthy || isQuitting) return;
  serverWasHealthy = false;
  clearInterval(interval);
  console.log('Server died — relaunching app');
  app.relaunch();
  app.exit(0);
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

  mainWindow.on('closed', () => { mainWindow = null; });

  // When the smart loader redirects to the server URL, start health monitoring
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    if (url.startsWith(SERVER_URL) && !serverWasHealthy) {
      startServerMonitor();
    }
  });
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('app:quit', () => { app.quit(); });
ipcMain.handle('app:isKiosk', () => isKiosk);

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

function registerShortcuts() {
  globalShortcut.register('F11', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  globalShortcut.register('F12', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
  globalShortcut.register('CommandOrControl+Alt+Q', () => { app.quit(); });
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerShortcuts();
  createWindow();

  // Show a loading page that polls the server and redirects when ready.
  // On Linux, the server is pre-started by launch.sh before Electron to avoid
  // fork() page table copy overhead that causes 15-20s delays on cold boot.
  // On Windows/macOS, we start the server as a child process below.
  const loaderHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><style>
  body { margin: 0; background: #1a1a2e; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; }
  .container { text-align: center; }
  .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #7c5cbf; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .text { font-size: 14px; opacity: 0.7; }
</style></head>
<body><div class="container"><div class="spinner"></div><div class="text">Starting ncSender...</div></div>
<script>
  function poll() {
    fetch('http://localhost:${SERVER_PORT}/api/health')
      .then(r => { if (r.ok) window.location.href = 'http://localhost:${SERVER_PORT}'; else setTimeout(poll, 300); })
      .catch(() => setTimeout(poll, 300));
  }
  poll();
</script></body></html>`)}`;
  mainWindow.loadURL(loaderHtml);

  // Check if server is already running (started by launch.sh, systemd, or previous session)
  const alreadyRunning = await isServerRunning();

  if (!alreadyRunning) {
    startServerAsChild();
  }
});

app.on('window-all-closed', () => { app.quit(); });

app.on('will-quit', async (e) => {
  isQuitting = true;
  globalShortcut.unregisterAll();

  if (weStartedServer) {
    // We spawned the server as a child — kill it directly
    killServer();
  } else {
    // Server was started externally (launch.sh) — send shutdown via API
    e.preventDefault();
    await shutdownServer();
    app.exit(0);
  }
});
