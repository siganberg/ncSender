# Release Notes - v0.1.7

## New Features

### Motion Controls UX Improvements
- **Combined XY0 Button**: X0 and Y0 buttons now combined into single XY0 button by default
  - Double-click XY0 to expand into separate X0 and Y0 buttons
  - Long press XY0 (1.5s) to move machine to X0 Y0 position
  - Click outside X0/Y0 buttons to collapse back to XY0

- **Updated Home Button Behavior**: Improved interaction pattern for safer operation
  - Double-click Home to expand into HX, HY, HZ axis-specific buttons
  - Long press Home (1.5s) to execute full home command ($H)
  - Previously: single click to home, long press (750ms) to split

- **HX/HY/HZ Long Press Requirement**: Added safety requirement for axis home commands
  - Long press (1.5s) now required to execute individual axis home commands
  - Previously: single click execution

### grblHAL Compatibility
- **Door as Pause Setting**: Added toggle to use Door command instead of Feed Hold for pausing
  - When enabled, Pause button sends `\x84` (Door) instead of `!` (Feed Hold)
  - Door machine state automatically mapped to Hold sender status for UI consistency
  - Requires grblHAL Build 20250731 or newer
  - New reusable ToggleSwitch component added

## Improvements

### Connection Reliability
- **Enhanced Connection Detection**: Added status report validation before marking connection as established
  - Connection now waits up to 3 seconds for first status report to verify device is a valid CNC controller
  - Shows "verifying" status during validation phase
  - Automatically disconnects if device doesn't respond
  - Prevents false connections to non-CNC devices

- **GRBL Greeting Verification**: Changed connection verification to wait for GRBL greeting message
  - More reliable than status report for initial connection validation
  - Better detection of stale connections before retry attempts
  - Handles scenario where another device already has Telnet connection

- **Auto-Reconnection Improvements**: Enhanced reconnection logic for better reliability
  - Detects and disconnects stale connections before retry attempts
  - 1-second retry loop for faster reconnection
  - Improved connection attempt logging

### UI/UX Enhancements
- **Consistent Visual Feedback**: Standardized behavior across all motion control buttons
  - All buttons now fill horizontally (left to right) during long press
  - Red blinking border feedback on incomplete press (cancellation indicator)
  - All buttons use consistent 1.5s long-press threshold
  - Progress indicators provide clear visual feedback

- **Improved Connection Status Display**
  - Always shows "Connecting..." when WebSocket is disconnected
  - Prevents showing stale status when connection is lost
  - More accurate connection state representation

### Settings Management
- **Settings Dialog Refresh**: Settings dialog now reloads current values on open
  - Fetches fresh connection settings from backend every time
  - Ensures UI always displays current values from settings.json
  - Useful when settings.json is edited externally

- **Fixed Connection Type Loading**: Corrected nested settings access
  - Fixed connection type dropdown not selecting correct value
  - Properly accesses nested connection object properties

### Performance
- **Optimized Out-of-Bounds Calculation**: Only performed when machine is idle
  - Reduces CPU usage during active CNC operations
  - Improves performance during job execution

### Terminal
- **Cleaner Terminal History**: Empty messages no longer added to terminal
  - Filters out empty or whitespace-only messages
  - Reduces unnecessary WebSocket traffic
  - Better user experience with focused output

## Bug Fixes
- Fixed connection type not loading correctly from nested settings structure
- Fixed auto-reconnection when GRBL greeting is not received
- Fixed stale status display when WebSocket connection is lost
- Fixed empty lines appearing in terminal history

## Technical Changes
- Refactored connection settings structure for better organization
- Added reusable ToggleSwitch component for consistent UI
- Improved connection flow state management
- Enhanced error handling and cleanup on connection failures
- Added proper verification timeout handling

---

**Full Changelog**: [v0.1.6...v0.1.7](https://github.com/siganberg/ncSender/compare/v0.1.6...v0.1.7)
