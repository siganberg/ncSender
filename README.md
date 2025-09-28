# ncSender - CNC Controller

A unified Electron application for CNC control with embedded server and remote access capabilities.

## 🚀 Features

- **🖥️ Unified Electron App** - Single executable for cross-platform deployment
- **🌐 Embedded Server** - HTTP API + WebSocket server on port 3001
- **📱 Local UI** - Vue.js interface displayed in Electron window
- **🌍 Remote Access** - Multiple browsers can connect from other devices
- **🔒 Kiosk Mode** - Perfect for dedicated terminals and kiosks
- **⚡ Real-time Updates** - WebSocket communication for live CNC status
- **🔌 Serial Port Management** - Direct CNC controller communication

## 🎯 Architecture

This is a **unified Electron application** that:
1. **Runs an embedded Express server** with HTTP API and WebSocket
2. **Displays the UI locally** in the Electron window
3. **Serves the same UI remotely** to browsers on other devices
4. **Manages CNC controller** via serial port communication
5. **Broadcasts real-time updates** to all connected clients

## 📦 Installation

### Install Dependencies
```bash
npm install
cd client && npm install
```

Or use the convenience script:
```bash
npm run install:all
```

## 🚀 Quick Start

### Development Mode
```bash
npm run dev
```
This will:
1. Build the client UI
2. Start the Electron app with embedded server
3. Open the UI in the Electron window
4. Make the server accessible at `http://localhost:3001`

### Kiosk Mode (Development)
```bash
npm run dev:kiosk
```
Starts in fullscreen kiosk mode for testing.

### Production
```bash
npm run start         # Normal mode
npm run start:kiosk   # Kiosk mode
```

## 📦 Building & Packaging

### Build for Distribution
```bash
npm run build   # Builds client UI
```

### Package Application
```bash
npm run pack    # Package for current platform (unpacked)
npm run dist    # Create installer for current platform
```

Builds will be created in `dist-electron/` directory.

## 🎮 Usage

### Local Access
- The Electron app displays the UI locally
- Full CNC control interface in the window

### Remote Access
1. **Find your IP address** (e.g., `192.168.1.100`)
2. **Connect from browsers** on other devices: `http://[your-ip]:3001`
3. **Multiple clients** can connect simultaneously
4. **All clients receive real-time updates**

### Keyboard Controls
- **F11** - Toggle fullscreen/kiosk mode
- **Ctrl+Alt+Q** - Quit in kiosk mode

## 🌐 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health check |
| `/api/serial-ports` | GET | List available serial ports |
| `/api/connect` | POST | Connect to CNC controller |
| `/api/disconnect` | POST | Disconnect from CNC controller |
| `/api/status` | GET | Get connection status |
| `/api/send-command` | POST | Send G-code command |

## 📡 WebSocket Events

| Event | Description |
|-------|-------------|
| `cnc-status` | Connection status updates |
| `cnc-data` | Raw data from CNC controller |
| `cnc-status-report` | CNC status reports |
| `cnc-system-message` | System messages |
| `cnc-response` | Command responses |

## 🏗️ Development

### Project Structure
```
├── electron/              # Electron main process
│   ├── main.js           # App entry point with embedded server
│   ├── server.js         # Express server with API & WebSocket
│   └── CNCController.js  # CNC communication logic
├── client/               # Vue.js client application
│   ├── src/              # Vue source code
│   ├── dist/             # Built client files (served by server)
│   └── package.json      # Client dependencies
├── dist-electron/        # Built Electron packages
└── package.json          # Main app configuration
```

### Client Development
If you need to work on the client UI with hot reload:
```bash
cd client
npm run dev   # Starts Vite dev server on port 5174
```

## 🚀 Deployment Scenarios

### 1. Kiosk/Terminal Mode
```bash
npm run start:kiosk
```
- Fullscreen application
- No browser chrome
- Perfect for dedicated CNC terminals

### 2. Server + Remote Clients
```bash
npm run start
```
- Electron app runs on main machine
- Remote operators connect via browsers
- All clients see real-time updates

### 3. Standalone Machine
```bash
npm run start
```
- Single machine operation
- Local Electron interface
- No network required

## 🔧 Configuration

### Port Configuration
The server runs on port `3001` by default. To change:
```bash
PORT=8080 npm run start
```

### Kiosk Mode
Add kiosk mode to any command:
```bash
npm run start -- --kiosk
```

## 📱 Platform Support

- **Windows** - `.exe` installer
- **macOS** - `.dmg` package
- **Linux** - `.AppImage` or `.deb` package

Use `npm run dist` to build for your current platform.

## 🎯 Perfect For

- **Manufacturing environments** with multiple operators
- **Educational settings** with shared CNC access
- **Remote monitoring** of CNC operations
- **Kiosk deployments** in workshops
- **Cross-platform CNC control** solutions