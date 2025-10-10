# Machine States and Status Display

This document provides a comprehensive reference for all possible machine states and their display logic in ncSender.

## Overview

Machine states are parsed from GRBL status reports and displayed in the top toolbar. Each state has unique visual styling including text color, border color, and optional pulse animations.

## Status Parsing

**Source**: app/electron/features/cnc/controller.js:164

```javascript
newStatus.status = parts[0].split(':')[0];
```

Status is extracted from GRBL status reports in format: `<Status|...>` where the status value is the first part before the colon.

## Server Aggregation

**Source**: app/electron/app.js:109

```javascript
const updateSenderStatus = () => {
  const nextStatus = computeSenderStatus();
  if (serverState.senderStatus !== nextStatus) {
    serverState.senderStatus = nextStatus;
    return true;
  }
  return false;
};
```

The server derives a single `senderStatus` value that combines connection readiness, GRBL machine state, probing, and tool change flags. All clients consume this property instead of recomputing priorities locally, ensuring a consistent display across the application.

## Complete Status List

### Idle
- **Display Text**: "Idle"
- **Color**: Default text color (white/themed)
- **Border**: White with subtle glow
- **Animation**: None
- **Condition**: Machine is connected and in idle state
- **Source**: TopToolbar.vue:90

### Idle (Special Case)
- **Display Text**: "Homing Required"
- **Color**: Teal accent (#1abc9c)
- **Border**: Teal with pulse animation (2s cycle)
- **Animation**: Pulsing glow
- **Condition**: `machineState === 'idle'` AND `!isHomed`
- **Source**: TopToolbar.vue:87
- **Notes**: This is a computed state shown when machine needs homing before operation

### Run
- **Display Text**: "Running"
- **Color**: Green (#28a745)
- **Border**: Green with pulse animation (2.5s cycle)
- **Animation**: Pulsing glow
- **Condition**: Machine is running a job
- **Source**: TopToolbar.vue:91, :264-267

### Hold
- **Display Text**: "Hold"
- **Color**: Yellow (#ffc107)
- **Border**: Yellow with pulse animation (2.5s cycle)
- **Animation**: Pulsing glow
- **Condition**: Machine is in hold/pause state
- **Source**: TopToolbar.vue:92, :269-272

### Jog
- **Display Text**: "Jogging"
- **Color**: Green (#28a745)
- **Border**: Green with pulse animation (2.5s cycle)
- **Animation**: Pulsing glow
- **Condition**: Machine is in jogging mode
- **Source**: TopToolbar.vue:93, :274-277
- **Notes**: Not included in TypeScript type definition but handled in display logic

### Alarm
- **Display Text**: "Alarm"
- **Color**: Red (#dc3545)
- **Border**: Red with fast pulse animation (1s cycle)
- **Animation**: Fast pulsing glow (urgent)
- **Condition**: `machineState === 'alarm'` OR `lastAlarmCode` is set
- **Source**: TopToolbar.vue:73-76, :279-282
- **Special**: Shows unlock button when in this state
- **Related**: See GRBL Error Codes section below

### Door
- **Display Text**: "Door Open"
- **Color**: Orange (#fd7e14)
- **Border**: Orange with pulse animation (2.5s cycle)
- **Animation**: Pulsing glow
- **Condition**: Safety door is open
- **Source**: TopToolbar.vue:95, :284-287

### Check
- **Display Text**: "Check"
- **Color**: Teal (#20c997)
- **Border**: Teal with subtle glow
- **Animation**: None
- **Condition**: G-code check mode active
- **Source**: TopToolbar.vue:96, :289-292

### Home
- **Display Text**: "Homing"
- **Color**: Blue (#007bff)
- **Border**: Blue with pulse animation (2.5s cycle)
- **Animation**: Pulsing glow
- **Condition**: Homing cycle in progress
- **Source**: TopToolbar.vue:97, :294-297

### Sleep
- **Display Text**: "Sleep"
- **Color**: Gray (#6c757d)
- **Border**: Gray with subtle glow
- **Animation**: None
- **Condition**: Machine is in sleep mode
- **Source**: TopToolbar.vue:98, :299-302

### Tool
- **Display Text**: "Tool Change"
- **Color**: Magenta (#c912a8)
- **Border**: Magenta with pulse animation (2.5s cycle)
- **Animation**: Pulsing glow
- **Condition**: Tool change in progress (`senderStatus === 'tool-changing'`)
- **Source**: TopToolbar.vue:65-99

### Offline
- **Display Text**: "Connecting..."
- **Color**: Gray (#6c757d)
- **Border**: Gray with subtle glow
- **Animation**: None
- **Condition**: Explicitly offline state
- **Source**: TopToolbar.vue:100, :259-262

### Setup Required (Special Case)
- **Display Text**: "Setup Required"
- **Color**: Gray (#6c757d)
- **Border**: Gray with subtle glow
- **Animation**: None
- **Condition**: `setupRequired === true`
- **Source**: TopToolbar.vue:79, :314-317
- **Notes**: Shown when initial CNC setup is incomplete

### Connecting
- **Display Text**: "Connecting..."
- **Color**: Teal accent (#1abc9c) with text pulse
- **Border**: Teal with pulse animation (1.6s cycle)
- **Animation**: Pulsing glow + text opacity pulse
- **Condition**: `!connected` (connection in progress)
- **Source**: TopToolbar.vue:80, :319-323

### Unknown/Default
- **Display Text**: "Connected"
- **Color**: Gray (#6c757d)
- **Border**: Gray with subtle glow
- **Animation**: None
- **Condition**: No machine state or unknown state
- **Source**: TopToolbar.vue:101, :309-312

## TypeScript Type Definition

**Source**: TopToolbar.vue:51

```typescript
senderStatus?: 'setup-required' |
               'connecting' |
               'idle' |
               'homing-required' |
               'running' |
               'jogging' |
               'probing' |
               'tool-changing' |
               'alarm' |
               'hold' |
               'homing' |
               'door' |
               'check' |
               'sleep'
```

**Note**: `senderStatus` is computed server-side and already accounts for tool-change and probing flags, so components do not need to combine multiple booleans when determining the active state.

## Unlock Button

**Condition**: Shows when `lastAlarmCode !== null/undefined` OR `machineState === 'alarm'`

**Location**: Center of toolbar next to status text

**Action**: Clicking emits 'unlock' event which typically sends `$X` command to clear alarm

**Source**: TopToolbar.vue:30, :73-76

## GRBL Error Codes

The system tracks 38 different GRBL error codes that can trigger alarm states:

**Source**: app/electron/features/cnc/grbl-errors.js

Error codes range from:
- **1**: G-code word parsing errors
- **5**: Homing cycle failures
- **9**: Commands locked during alarm/jog
- **13**: Safety door detection
- **20-38**: G-code command validation errors

These error codes are displayed alongside alarm states to help diagnose issues.

## Border Glow Animations

Each status has a unique visual presentation:

### Fast Pulse (1s cycle)
- `alarm` - Red border (conveys urgency)

### Medium Pulse (1.6-2s cycle)
- `connecting` - Teal border
- `homing-required` - Teal border

### Slow Pulse (2.5s cycle)
- `run` - Green border
- `jog` - Green border
- `hold` - Yellow border
- `door` - Orange border
- `home` - Blue border
- `tool` - Magenta border

### No Animation
- `idle` - White border
- `check` - Teal border (no pulse)
- `sleep` - Gray border
- `offline` - Gray border
- `unknown` - Gray border

## State Priority Logic

The display logic follows this priority order (TopToolbar.vue:2-9):

1. **Setup Required** - Overrides all other states
2. **Tool Change** - Shows if `senderStatus === 'tool-changing'`
3. **Homing Required** - Shows if `idle` AND `!isHomed`
4. **Machine State** - Shows actual GRBL state if connected
5. **Connecting** - Shows if `!connected`

## Usage in Components

### TopToolbar Component
The main display component for machine states.

**Props**:
```typescript
{
  workspace: string;
  senderStatus: string;
  lastAlarmCode?: number | string;
  onShowSettings: () => void;
}
```

### StatusPanel Component
Uses `isHoming` computed to check for homing state:

**Source**: StatusPanel.vue:146
```javascript
const isHoming = computed(() => (store.senderStatus.value || '').toLowerCase() === 'homing');
```

### JogPanel Component
Disables motion controls during homing:

**Source**: JogPanel.vue:332
```javascript
const isHoming = computed(() => (store.senderStatus.value || '').toLowerCase() === 'homing');
```

## State-Based UI Behavior

Different UI elements are disabled/enabled based on machine state:

- **Jogging**: Disabled when `!isHomed` or the machine is probing or `machineState === 'home'`
- **Workspace Selector**: Disabled when `!connected` or `isJobRunning`
- **Settings Button**: Disabled when `isJobRunning`
- **Motion Controls**: Disabled when not homed or during probing

## Future Considerations

When simplifying these states, consider:

1. **Consolidation**: Some states like `connecting` and `offline` could potentially be merged
2. **Type Safety**: Add `jog` to TypeScript type definition or remove from display logic
3. **Animation Consistency**: Standardize pulse timing across similar urgency levels
4. **State Hierarchy**: Document and enforce the priority order more explicitly
5. **Error Handling**: Consider separate visual treatment for different alarm severities
