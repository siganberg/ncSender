# ncSender - CNC Controller

## 🏗️ Development

### Project Structure
```
├── app/
│   ├── electron/              # Backend server and Electron main process
│   │   ├── main.js           # Electron app entry point
│   │   ├── server.js         # Express server with API & WebSocket
│   │   ├── cnc-controller.js # CNC communication logic
│   │   └── routes/           # API route modules
│   ├── client/               # Vue.js frontend application
│   │   ├── src/              # Vue source code
│   │   ├── dist/             # Built client files
│   │   └── package.json      # Client dependencies
│   └── package.json          # Main app configuration
```

### Installation

Install dependencies for both backend and frontend:
```bash
cd app
npm install
cd client && npm install
```

### Development Mode

Start the development environment:
```bash
cd app
npm run dev
```

This will:
1. Build the client UI with Vite
2. Start the Electron app with embedded server
3. Open the UI in the Electron window
4. Make the server accessible at `http://localhost:3001`

### Client Development

For frontend development with hot reload:
```bash
cd app/client
npm run dev:hot   # Starts Vite dev server on port 5174
```

Visit `http://localhost:5174` in your browser for the hot reload development server.

### Testing with Fake CNC Controller

For testing G-code job functionality without real hardware:
```bash
cd app
USE_FAKE_CNC=true npm run dev
```

This enables a simulated CNC controller that:
- Responds to all commands with success after 50ms delay
- Simulates machine states (Idle, Run, Hold)
- Handles pause/resume/stop commands properly
- Provides realistic status reports

### Building

Build the client for production:
```bash
cd app
npm run build
```

### Production

Run in production mode:
```bash
cd app
npm run start
```

## 📁 Data Storage

ncSender stores user data in platform-specific directories following OS conventions:

### macOS
- **G-code files**: `~/Library/Application Support/ncSender/gcode-files/`
- **Settings**: `~/Library/Application Support/ncSender/settings.json`
- **Command history**: `~/Library/Application Support/ncSender/command-history.json`

### Windows
- **G-code files**: `%APPDATA%/ncSender/gcode-files/`
- **Settings**: `%APPDATA%/ncSender/settings.json`
- **Command history**: `%APPDATA%/ncSender/command-history.json`

### Linux / Raspberry Pi
- **G-code files**: `~/.config/ncSender/gcode-files/`
- **Settings**: `~/.config/ncSender/settings.json`
- **Command history**: `~/.config/ncSender/command-history.json`

These directories are automatically created when the application first runs. Files stored here will persist between app updates and are easily accessible for backup purposes.