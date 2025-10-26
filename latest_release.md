## What's Changed

### ✨ New Features
- Added Tool Length Sensor (TLS) support with visual indicators when not configured
- Added tool length check functionality for better precision
- Added Z-engagement parameter for improved tool change control
- Added option to hide auto-generated G-code commands for cleaner display
- Added manual tool change toolbar for better control
- New plugin architecture with category and priority support
- Added command processor for better G-code handling

### 🐛 Bug Fixes
- Fixed imperial unit conversion issues in return commands and 4-corner probing
- Fixed Tool Length Sensor (TLS) configuration and detection
- Fixed feed rate selection in jogging controls
- Fixed jog center button functionality
- Fixed layout and styling issues in control interface
- Fixed multi-line G-code command handling
- Fixed tool change detection and routing to plugins

### 🔧 Improvements
- Switched tool change notifications to WebSocket for real-time updates
- More organized and readable G-code output with trimming
- Simplified return to reference position commands
- Unified M6 (tool change) detection across the application
- Centralized same-tool-change detection to avoid unnecessary operations
- Removed backward compatibility for obsolete tool change methods
- Enhanced plugin system to control tool settings
