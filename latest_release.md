## What's Changed

### ✨ New Features
- Add Bluetooth Low Energy (BLE) pendant support for wireless CNC control
- Add WiFi configuration feature for pendant via Bluetooth
- Add WebSocket handlers for job control from pendant

### 🔧 Improvements
- Improve BLE pendant UI and auto-reconnect behavior
- Optimize BLE pendant reconnection and reduce network traffic
- Simplify WiFi configuration UI and add help tooltip
- Update pendant dialog with generic title and version display for BLE devices
- Preserve status changes in BLE queue replacement for more reliable updates
- Replace queued BLE state updates with newer ones for better responsiveness
- Updated application icon

### 🐛 Bug Fixes
- Fix server IP detection for newer Node.js versions
- Fix BLE job control and theme sync
- Fix import for settings module
