import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import path from 'node:path';
import url from 'node:url';
import { createServer } from './server.js';
import { initializeUpdateManager, scheduleInitialUpdateCheck } from './update-manager.js';

const isDev = process.env.NODE_ENV === 'development';
const isKiosk = process.argv.includes('--kiosk');
const isServerOnly = process.argv.includes('--server-only') || process.argv.includes('--headless');

let mainWindow = null;
let server = null;
let initialUpdateCheckScheduled = false;
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  try {
    console.log('Starting embedded server...');
    server = await createServer();
    console.log(`Server running on http://localhost:${server.port}`);
    console.log(`Remote access available at http://[your-ip]:${server.port}`);
    return server.port;
  } catch (error) {
    console.error('Failed to start server:', error);
    throw error;
  }
}

async function createWindow() {
  // Start the embedded server first
  const serverPort = await startServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111720' : '#F7F9FC',
    autoHideMenuBar: true,
    show: false,
    kiosk: isKiosk,
    fullscreen: isKiosk,
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Wait until content is ready before maximizing
  mainWindow.once('ready-to-show', () => {
    if (!isKiosk) {
      try {
        mainWindow.maximize();
        mainWindow.show();
      } catch (e) {
        console.warn('Maximize failed:', e);
        const primaryDisplay = screen.getPrimaryDisplay();
        const { x, y, width, height } = primaryDisplay.workArea;
        mainWindow.setBounds({ x, y, width, height });
        mainWindow.show();
      }
    } else {
      mainWindow.show();
    }
  });

  // Load the UI from the embedded server
  const appUrl = `http://localhost:${serverPort}`;

  try {
    await mainWindow.loadURL(appUrl);
    console.log(`Electron app loaded: ${appUrl}`);

    // if (isDev) {
    //   mainWindow.webContents.openDevTools({ mode: 'detach' });
    // }
  } catch (error) {
    console.error('Failed to load app URL:', error);
    // Fallback to loading a basic error page
    mainWindow.loadURL('data:text/html,<h1>Server starting...</h1><p>Please wait...</p>');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  initializeUpdateManager(mainWindow);
  if (!initialUpdateCheckScheduled) {
    initialUpdateCheckScheduled = true;
    scheduleInitialUpdateCheck();
  }

  // Handle fullscreen toggle
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Press F11 to toggle fullscreen (without kiosk mode)
    if (input.key === 'F11' && input.type === 'keyDown') {
      const isFullScreen = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!isFullScreen);
    }
    // Press F12 to toggle DevTools (for debugging production builds)
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
    // Press Ctrl+Alt+Q to quit in kiosk mode
    if (input.key === 'q' && input.control && input.alt && input.type === 'keyDown') {
      app.quit();
    }
  });
}

app.whenReady().then(() => {
  if (isServerOnly) {
    console.log('Running in server-only mode (headless)');
    startServer().then((port) => {
      console.log(`Server is running on http://localhost:${port}`);
      console.log('Access the UI from any browser on your network');
      console.log('Press Ctrl+C to stop the server');
    }).catch((error) => {
      console.error('Failed to start server:', error);
      app.quit();
    });
  } else {
    initializeUpdateManager(null);
    createWindow();
  }
});

app.on('window-all-closed', () => {
  // In server-only mode, don't quit when windows are closed (there are none)
  // For regular mode, quit on all platforms to ensure the server is properly shut down
  if (!isServerOnly) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    initializeUpdateManager(mainWindow);
  }
});

app.on('before-quit', () => {
  if (server && server.close) {
    console.log('Shutting down embedded server...');
    server.close();
  }
});
