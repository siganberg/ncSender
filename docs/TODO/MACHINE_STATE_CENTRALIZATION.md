# Machine State Centralization Refactoring Plan

## Overview
Consolidate all machine state calculation into a single server-side property (`senderStatus`) that the header and all UI components will consume. This eliminates client-side logic for determining state and ensures consistency.

## Current State Analysis

**Current scattered state sources:**
1. `connected` - from controller connection
2. `machineState` - from GRBL status (idle/run/hold/alarm/etc.)
3. `isToolChanging` - server calculates this
5. `setupRequired` - client-side check for settings validity
6. `homed` - from GRBL status
7. `lastAlarmCode` - from settings/error events

**Current client-side calculations:**
- TopToolbar.vue lines 7-9: Complex priority logic
- App.vue line 7: setupRequired check
- Multiple components check `isHomed`, `isProbing`, `machineState` separately

## Proposed Solution

### New Server State Property

Add a single computed property `senderStatus` to serverState:

```typescript
senderStatus: 'setup-required' | 'connecting' | 'idle' | 'homing-required' |
               'running' | 'jogging' | 'probing' | 'tool-changing' |
               'alarm' | 'hold' | 'homing'
```

### Priority Order (Server-Side)
1. **Setup Required** - No connectionType in settings
2. **Connecting** - !connected (connection in progress)
3. **Alarm** - machineState === 'alarm' OR lastAlarmCode exists
4. **Tool Changing** - isToolChanging === true
6. **Homing** - machineState === 'home'
7. **Hold** - machineState === 'hold'
8. **Jogging** - machineState === 'jog'
9. **Running** - machineState === 'run'
10. **Homing Required** - connected && machineState === 'idle' && !homed
11. **Idle** - Default when connected
12. **Connecting** - Fallback when not connected

## Implementation Steps

### Phase 1: Server Changes (app/electron/app.js)

**1.1 Add senderStatus calculation function** (after line 91)
```javascript
const computesenderStatus = () => {
  // Check setup requirements
  const connectionType = getSetting('connectionType');
  if (!connectionType) {
    return 'setup-required';
  }

  const connected = serverState.machineState?.connected;
  const machineStatus = serverState.machineState?.status?.toLowerCase();
  const homed = serverState.machineState?.homed;
  const lastAlarmCode = getSetting('lastAlarmCode');

  // Not connected
  if (!connected) {
    return 'connecting';
  }

  // Alarm state (highest priority when connected)
  if (lastAlarmCode !== undefined && lastAlarmCode !== null) {
    return 'alarm';
  }
  if (machineStatus === 'alarm') {
    return 'alarm';
  }

  // Homing required (idle but not homed)
  if (machineStatus === 'idle' && homed === false) {
    return 'homing-required';
  }

  // Tool changing
  if (serverState.machineState?.isToolChanging === true) {
    return 'tool-changing';
  }

  // Probing

  // Homing in progress
  if (machineStatus === 'home') {
    return 'homing';
  }

  // Hold/Pause
  if (machineStatus === 'hold') {
    return 'hold';
  }

  // Jogging
  if (machineStatus === 'jog') {
    return 'jogging';
  }

  // Running
  if (machineStatus === 'run') {
    return 'running';
  }



  // Idle (connected and ready)
  if (machineStatus === 'idle') {
    return 'idle';
  }

  // Default fallback
  return 'connecting';
};
```

**1.2 Add senderStatus to serverState** (line 84-91)
```javascript
const serverState = {
  machineState: {
    connected: false,
    isToolChanging: false,
    isProbing: false
  },
  senderStatus: 'connecting', // NEW
  jobLoaded: null
};
```

**1.3 Update senderStatus on every state broadcast**

Add before each `broadcast('server-state-updated', serverState)` call:
```javascript
serverState.senderStatus = computesenderStatus();
broadcast('server-state-updated', serverState);
```

Locations to update:
- Line 339 (job progress close)
- Line 374 (new connection)
- Line 652 (tool changing)
- Line 730 (command result)
- Line 767 (workspace change)
- Line 801 (connection status)
- Line 867 (status report)
- Line 934 (stop command)
- Line 952 (pause command)
- Line 983 (resume command)
- Line 1028 (job complete)

Probe routes (app/electron/features/probe/routes.js):
- Line 23 (start probe)
- Line 59 (probe started)
- Line 69 (probe error)
- Line 92 (stop probe)
- Line 103 (stop error)

### Phase 2: Client Store Updates (app/client/src/composables/use-app-store.ts)

**2.1 Add senderStatus to serverState type** (line 36-53)
```typescript
const serverState = reactive({
  machineState: null as any,
  senderStatus: 'connecting' as string, // NEW
  jobLoaded: null as { /*...*/ } | null
});
```

**2.2 Remove client-side checks**
- Keep `isHomed`, `isProbing`, `isJobRunning` as they're used for non-display logic
- These are derived from server state, not client calculations

### Phase 3: TopToolbar Refactoring (app/client/src/shell/TopToolbar.vue)

**3.1 Simplify props** (line 57-65)
```typescript
const props = defineProps<{
  workspace: string;
  senderStatus: string; // NEW - single source of truth
  lastAlarmCode?: number | string;
  onShowSettings: () => void;
}>();
```

**3.2 Replace complex logic** (lines 78-103)
```typescript
const machineStateText = computed(() => {
  switch (props.senderStatus) {
    case 'setup-required': return 'Setup Required';
    case 'connecting': return 'Connecting...';
    case 'idle': return 'Idle';
    case 'homing-required': return 'Homing Required';
    case 'running': return 'Running';
    case 'jogging': return 'Jogging';
    case 'probing': return 'Probing';
    case 'tool-changing': return 'Tool Change';
    case 'alarm': return 'Alarm';
    case 'hold': return 'Hold';
    case 'homing': return 'Homing';
    default: return 'Connected';
  }
});
```

**3.3 Simplify CSS classes** (line 2-10)
```vue
<div class="toolbar" :class="`state--${props.senderStatus}`">
```

**3.4 Update alarm button** (line 73-76)
```typescript
const isAlarmState = computed(() => props.senderStatus === 'alarm');
```

### Phase 4: App.vue Simplification (app/client/src/App.vue)

**4.1 Update TopToolbar binding** (line 4-15)
```vue
<TopToolbar
  :workspace="workspace"
  :display-status="serverState.senderStatus"
  :last-alarm-code="lastAlarmCode"
  @toggle-theme="toggleTheme"
  @unlock="handleUnlock"
  @change-workspace="handleWorkspaceChange"
  :on-show-settings="openSettings"
/>
```

**4.2 Remove setupRequired calculation** (line 1322-1325)
```typescript
// Remove this check - server now handles it
// if (!isSettingsValid(initialSettings)) {
//   showSetupDialog.value = true;
// }

// NEW: React to server senderStatus
watch(() => serverState.senderStatus, (newStatus) => {
  if (newStatus === 'setup-required') {
    showSetupDialog.value = true;
    await loadSetupUsbPorts();
  }
});
```

**4.3 Remove GCodeVisualizer props** (line 22-24)
```vue
<!-- REMOVE these props -->
:connected="isConnected"
:machine-state="status.machineState"
:is-tool-changing="serverState.machineState?.isToolChanging"
<!-- Component can access via store if needed -->
```

### Phase 5: Component Cleanup

**5.1 Update components using state checks:**
- JogPanel.vue - Use store.senderStatus instead of checking individual states
- StatusPanel.vue - Use store.senderStatus
- GCodeVisualizer.vue - Use store.senderStatus for disabling controls

**5.2 Standardize disabled logic:**
```typescript
// OLD: Multiple checks
const isDisabled = !connected || machineState === 'alarm' || isProbing

// NEW: Single check
const isDisabled = computed(() =>
  ['setup-required', 'connecting', 'alarm'].includes(store.serverState.senderStatus)
);
```

## Benefits

1. **Single Source of Truth** - All state priority logic in one place
2. **No Client Calculations** - Clients display, don't calculate
3. **Consistent Across Clients** - All clients see identical state
4. **Easier Testing** - Test state logic server-side only
5. **Simpler Components** - Remove complex conditional logic
6. **Future-Proof** - Easy to add new states (e.g., "warming-up", "calibrating")

## Testing Plan

1. Test each state transition displays correctly
2. Test state priority (alarm overrides other states, etc.)
3. Test setup dialog appears when senderStatus === 'setup-required'
4. Test UI elements disable/enable based on senderStatus
5. Test all clients receive same senderStatus via WebSocket

## Rollback Strategy

If issues arise, revert commits in reverse order:
1. Revert component updates (Phase 5)
2. Revert App.vue changes (Phase 4)
3. Revert TopToolbar (Phase 3)
4. Revert store changes (Phase 2)
5. Revert server changes (Phase 1)

Each phase is independently committable for safe incremental deployment.

## Related Documentation

- See [MACHINE_STATES.md](../MACHINE_STATES.md) for current state values and display logic
- Reference [CONTRIBUTING.md](../CONTRIBUTING.md) for vertical slice architecture patterns
