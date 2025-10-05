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
4. Make the server accessible at `http://localhost:8090`

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

### Local Build & Testing

#### Prerequisites
- **Node.js 20+**: Required for building the application
- **GitHub CLI (`gh`)**: Required for downloading release artifacts
  ```bash
  brew install gh
  gh auth login
  ```
- **act**: For testing CI workflows locally (optional)
  ```bash
  brew install act
  ```
- **actionlint**: For validating workflow syntax (optional)
  ```bash
  brew install actionlint
  ```

#### Building Locally
```bash
# Build for current platform only (auto-detects OS)
./.scripts/build-local.sh --all

# Build for specific platform (only works on matching OS)
./.scripts/build-local.sh --macos-x64      # macOS only
./.scripts/build-local.sh --macos-arm64    # macOS only
./.scripts/build-local.sh --linux-x64      # Linux only
./.scripts/build-local.sh --windows-x64    # Windows only

# Artifacts will be in releases/[platform-arch]/
```

**Important:** Local builds are limited to your current OS due to native modules (serialport):
- On **macOS**: Can only build macOS (x64, arm64)
- On **Linux**: Can only build Linux (x64)
- On **Windows**: Can only build Windows (x64)
- **For multi-platform builds**, use GitHub Actions CI (see "Creating a Release" below)

#### Testing CI Workflow Locally
```bash
# Validate workflow syntax
actionlint .github/workflows/release-build.yml

# Dry run workflow locally (shows what would execute)
act push -e <(echo '{"ref": "refs/tags/v1.0.0"}') -n

# Run Linux build locally (requires Docker)
act -j linux push -e <(echo '{"ref": "refs/tags/v1.0.0"}')
```

#### Creating a Release
```bash
# Create and push a tag to trigger release workflow
git tag v1.0.0
git push origin v1.0.0

# Download built artifacts from GitHub Actions
./.scripts/download-latest-release.sh
```

The release workflow will:
1. Build for macOS (x64, arm64), Linux (x64), and Windows (x64)
2. Create a GitHub release with the tag name
3. Attach all build artifacts to the release

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

## 🌐 Port Architecture

ncSender uses a smart port architecture that works seamlessly in both development and production environments:

### Production (Electron App)
- **Single Port**: Everything served from one configurable port (default: 8090)
- **Client Auto-detection**: Frontend automatically uses the current URL's port for API/WebSocket calls
- **Configuration**: Server port can be changed in `settings.json` → `serverPort` field
- **URLs**: All API calls use relative URLs (`/api/settings`, `/api/status`, etc.)

### Development (Hot Reload)
- **Frontend**: Vite dev server runs on port 5174 for hot reload
- **Backend**: API/WebSocket server runs on port 8090 (development fallback)
- **Vite Proxy**: Automatically forwards `/api/*` requests from 5174 → 8090
- **Reason**: Separation needed for hot reload functionality

### API Configuration
The frontend uses relative URLs in all environments:
```javascript
// Works in both development and production
fetch('/api/settings')           // Development: 5174 → proxy → 8090
                                // Production: same origin (any port)
```

### Development Commands
```bash
# Start both frontend and backend with hot reload
npm run dev:hot

# Frontend only (requires backend running separately)
cd client && npm run dev

# Backend only
npm run server:dev
```

This architecture ensures that:
- Production builds work on any configurable port
- Development has full hot reload capabilities
- API calls automatically route to the correct backend
- No hardcoded URLs in the frontend code