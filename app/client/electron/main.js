import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import url from 'node:url';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = url.pathToFileURL(
      path.join(app.getAppPath(), 'dist', 'index.html')
    ).toString();
    await mainWindow.loadURL(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});