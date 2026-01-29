# ncSender – Sender-Side Macro Library & M98 Invocation Support

## Overview
Enhance ncSender’s macro system to:
- Store each macro as an individual `.macro` file
- Allow macros to be invoked from the terminal (MDI) or from within user G-code programs
- Use CNC-standard `M98 Pxxxx` syntax
- Expand macros sender-side and stream the resulting G-code to the controller

Macros are **not** sent to the controller as subprograms.
They are resolved, expanded, and streamed by ncSender.

---

## Macro Storage

### Directory
```
{app_data}/macros/
```

### File Naming
- Each macro is stored as a single file
- File name MUST be numeric and match the macro ID:
```
9001.macro
9002.macro
...
```
- Existing Program and description should be map to the Header comment.

### Reserved Range
- Sender macros must use IDs:
```
9001–9999
```
- Macros below `9000` are not allowed and may generate warnings
- `9000` is skipped to avoid controller-specific edge cases
- System should be able to auto-assign available id for the macros when creating a new one.

---

## Macro File Format

### Header (G-code comments)
Headers are optional but recommended and use standard G-code comment syntax.

Example:
```gcode
( PROGRAM: SAVE_CURRENT_JOB )
( DESC: Saves current program and tool state )
```

### Body
- Plain G-code
- May include comments
- May include `M98 Pxxxx` calls to other sender macros

Example:
```gcode
G10 L20 P1 X0 Y0 Z0
M98 P9002
```

---

## Macro Invocation

### Terminal (MDI)
```gcode
M98 P9001
```

### Inside User Program
```gcode
M3 S10000
M98 P9001
G0 X0 Y0
```

### Sender Behavior
1. Intercept `M98`
2. Parse `Pxxxx`
3. Locate `{app_data}/macros/xxxx.macro`
4. Load macro content
5. Expand macro inline
6. Stream expanded G-code to controller
7. Do **not** forward the original `M98` command

Terminal and program execution use the **same execution path**.

---

## Nested Macro Support

- Macros may call other sender macros using `M98 Pxxxx`
- Nested expansion must be supported

Example:
```gcode
M98 P9001
```

Where `9001.macro` contains:
```gcode
M98 P9002
```

---

## Cycle & Safety Guards

### Call Stack Tracking
- Maintain a macro call stack during expansion
- Detect recursive calls

Example error:
```
Macro recursion detected:
9001 → 9002 → 9001
```

### Maximum Call Depth
- Enforce a maximum macro depth
- Default: 16 levels
- Abort execution with clear error if exceeded

---

## Error Handling

Errors should abort macro execution and notify the user:
- Macro file not found
- Invalid macro number
- Recursion detected
- Max depth exceeded

Errors should **not** partially stream macros.

---

## Non-Goals (Out of Scope)
- Controller-side subprograms (`Oxxxx`)
- Forwarding `M98` to controller
- Non-numeric macro identifiers
- Macro persistence outside `{app_data}/macros`

---

## Future Considerations (Not Required for Initial Implementation)
- Parameter passing (`M98 P9001 Q1`)
- Macro listing command
- Macro UI editor enhancements
- Macro permissions / protection
