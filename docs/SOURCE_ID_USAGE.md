# sourceId Usage Reference

## Overview

The `sourceId` is a metadata field passed with commands sent to the CNC controller. It identifies the origin or purpose of a command, enabling features like:

- Filtering what gets broadcast to WebSocket clients
- Tracking command origin in console/logs
- Enabling/disabling response caching
- Supporting plugin event filtering
- Conditionally showing/hiding commands in the UI

## sourceId Flow

```
User/System → Route Handler → controller.sendCommand(command, { meta: { sourceId: 'value' } }) → CNC Controller
```

The `sourceId` is included in the `meta` object when calling `cncController.sendCommand()`:

```javascript
await cncController.sendCommand('G0 X10', {
  meta: { sourceId: 'macro' }
});
```

## Complete sourceId Usage Table

| Feature/Module | File Path | sourceId Value | Line(s) | Context/Purpose | Command Type |
|----------------|-----------|----------------|---------|-----------------|--------------|
| **Controller - Initial Connection** | `app/electron/features/cnc/controller.js` | `'system'` | 70 | Request initial G-code modes ($G) on connection | `$G` |
| **Controller - Status Polling** | `app/electron/features/cnc/controller.js` | `'system'` | 336 | Periodic status polling (every 50ms) | `?` |
| **Controller - Soft Reset** | `app/electron/features/cnc/controller.js` | `'system'` | 437 | Auto soft-reset on connection to clear controller state | `\x18` |
| **Controller - User Status Check** | `app/electron/features/cnc/controller.js` | NOT `'system'` | 803-804 | User-triggered status command (cached, not sent to controller) | `?` (intercepted) |
| **G-code Job - Line Execution** | `app/electron/features/gcode/job-routes.js` | `'job'` (default) or custom | 146, 323 | Each G-code line sent during job execution | G-code commands |
| **G-code Job - Event Context** | `app/electron/features/gcode/job-routes.js` | `this.sourceId` | 200, 302, 353, 364, 373, 388 | Job context for plugin events (start, line, complete, stop) | Event metadata |
| **Job Manager - Status** | `app/electron/features/gcode/job-manager.js` | `this.currentJob.sourceId` or `'job'` | 132 | Job status broadcasts | Status metadata |
| **Macro Execution** | `app/electron/features/macro/routes.js` | `'macro'` | 112, 118, 124 | All macro commands (start comment, commands, end comment) | Macro commands |
| **Probe Operations** | `app/electron/features/probe/routes.js` | `'probing'` | 70 | Probing commands sent during probe operations | Probe G-code |
| **Tool Change** | `app/electron/features/tool/routes.js` | `'tool-change'` | 89 | Tool change workflow commands | M6 and related |
| **Firmware - Settings Query** | `app/electron/features/firmware/routes.js` | `'system'` | 271, 333, 494 | Firmware settings queries ($$, $I, etc.) | `$$`, `$I`, etc. |
| **Alarms - Query** | `app/electron/features/alarms/routes.js` | `'system'` | 83 | Query alarm codes ($EA) | `$EA` |
| **CNC Routes - User Commands** | `app/electron/features/cnc/routes.js` | Passed from client | 172 | User-sent commands via API (sourceId from request body) | Any user command |

## sourceId Types

### `'system'`

**Purpose**: Internal/system commands that should not be broadcast to clients or shown in the console.

**Used for**:
- Status polling (runs every 50ms) - `controller.js:336`
- Initial connection handshake commands - `controller.js:70`
- Soft reset on connection - `controller.js:437`
- Firmware queries - `firmware/routes.js:271, 333, 494`
- Alarm queries - `alarms/routes.js:83`

**Special behavior**:
- When `sourceId === 'system'`, the `?` (status) command is sent directly to the controller
- When `sourceId !== 'system'`, the `?` command is intercepted and returns cached status (line 803-804 in controller.js)

### `'job'`

**Purpose**: Exclusive identifier for G-code file job execution. Used only when running a G-code file as a job.

**Used for**:
- All G-code lines sent during file execution - `job-routes.js:146, 323`
- Job status and progress tracking - `job-manager.js:132`

**Customizable**: Can be overridden via options when starting a job:
```javascript
await jobManager.startJob(filePath, filename, controller, broadcast, {
  sourceId: 'custom-source'
});
```

### `'macro'`

**Purpose**: Identifies commands originating from macro execution.

**Used for**:
- Macro start comment - `macro/routes.js:112`
- All macro commands - `macro/routes.js:118`
- Macro end comment - `macro/routes.js:124`

### `'probing'`

**Purpose**: Identifies commands from probing operations.

**Used for**:
- Probe commands during probing workflows - `probe/routes.js:70`

**Associated metadata**:
```javascript
meta: {
  sourceId: 'probing',
  probeOperation: options.probingAxis
}
```

### `'tool-change'`

**Purpose**: Identifies commands from tool change workflows.

**Used for**:
- Tool change operations and related commands - `tool/routes.js:89`

**Associated metadata**:
```javascript
meta: {
  sourceId: 'tool-change',
  toolNumber: parsedTool,
  originalWorkPosition: { x, y }
}
```

### Client-provided (Dynamic)

**Purpose**: Custom sourceId values passed from the client/UI.

**Used for**:
- User commands sent via `/api/cnc/send-command`
- The sourceId is included in the request body and passed through to the controller

**Example API call**:
```javascript
fetch('/api/cnc/send-command', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    command: 'G0 X10',
    meta: { sourceId: 'custom-ui-element' }
  })
});
```

## Implementation Details

### Where sourceId is Set

The sourceId is set in the `meta` object when calling `sendCommand()`:

```javascript
await cncController.sendCommand(command, {
  commandId: 'optional-id',
  displayCommand: 'Optional display text',
  meta: {
    sourceId: 'identifier',
    // ... other metadata
  }
});
```

### Where sourceId is Used

1. **Controller Status Check** (`controller.js:803-804`):
   ```javascript
   // Intercept user ? command - return cached status instead of sending to controller
   // But allow polling (sourceId: 'system') to go through
   if (cleanCommand === '?' && normalizedMeta?.sourceId !== 'system') {
     // Return cached status
   }
   ```

2. **Event Emission** (`controller.js:83-84, 99-100`):
   ```javascript
   const sourceId = this.activeCommand?.meta?.sourceId || null;
   this.emit('data', trimmedData, sourceId);
   ```

3. **Plugin Events** (`job-routes.js:200-202, 300-303`):
   ```javascript
   const jobContext = {
     filename: this.filename,
     filePath: this.filePath,
     sourceId: this.sourceId
   };
   await this.eventBus.emitChain('onBeforeJobStart', content, jobContext);
   ```

4. **Broadcast Filtering** (`cnc/routes.js:172-177`):
   ```javascript
   if (commandValue === '?' && metaPayload.sourceId !== 'system') {
     const rawData = cncController.getRawData();
     if (rawData && typeof broadcast === 'function') {
       broadcast('cnc-data', rawData);
     }
   }
   ```

## Developer Guidelines

### When to Use `'system'`

Use `'system'` for system/internal commands that should NOT be broadcast to clients:
- Internal polling/status checks
- System initialization commands
- Commands that should not appear in the user console
- High-frequency commands that would spam the UI

### When to Use Feature-Specific IDs

Use feature-specific IDs (`'macro'`, `'probing'`, `'tool-change'`, etc.) for:
- Grouping related commands
- Filtering in the console/logs
- Plugin event handling
- Identifying command origin in error handling

### When to Allow Custom IDs

Allow custom sourceIds for:
- User-initiated commands
- Plugin-generated commands
- Custom workflows that need tracking

## Related Files

- `app/electron/features/cnc/controller.js` - Main controller implementation
- `app/electron/features/gcode/job-routes.js` - G-code job execution
- `app/electron/features/gcode/job-manager.js` - Job management
- `app/electron/features/macro/routes.js` - Macro execution
- `app/electron/features/probe/routes.js` - Probing operations
- `app/electron/features/tool/routes.js` - Tool change operations
- `app/electron/features/firmware/routes.js` - Firmware queries
- `app/electron/features/alarms/routes.js` - Alarm queries
- `app/electron/features/cnc/routes.js` - CNC API routes
- `app/client/src/composables/use-app-store.ts` - Client-side command handling
