# ncSender UI/UX Design

## Goals
- Deliver a modern, touch-friendly CNC sender interface that scales from desktop to tablet form factors
- Provide consistent experience across Windows, macOS, Linux, and Raspberry Pi (Electron + Vue)
- Support light/dark themes with a single accent color and gradient accents
- Organize key CNC controls (visualization, jogging, status, console) into an intuitive layout with clear hierarchy

## Audience & Usage Context
- Makers and CNC operators using devices with touchscreens or traditional pointers
- Sessions typically involve loading g-code, validating toolpaths, jogging axes, monitoring machine status, and reacting to console output
- Needs to function well in shop environments with varying lighting (reinforces light/dark theme support)

## Information Architecture
- **Workspace Shell**: Primary window with collapsible side panels to adapt to screen widths
- **Top-Level Sections**
  - Toolpath Visualization area with viewport controls (Top, Side, 3D) and overlays for status information
  - Jogging Controls for X/Y/Z and optional 4th axis (A) grouped with feed/spindle overrides
  - Status Panel showing machine coordinates (machine vs work offset), active modal states (G54, etc.), alarms
  - Console Output with filter/timestamp controls and quick command input
  - Secondary utility drawers for file management, macros, probing (future additions)
- **Persistent Utility Bar**: Houses connection status, emergency stop, theme toggle, and settings access

## Layout & Navigation
- **Window Structure**: Two-column flex layout with resizable boundaries; left column dedicated to toolpath visualization, right column stacked panels (Jog, Status, Console)
- **Responsive Behavior**:
  - ≥1280px: All panels visible; console collapses to bottom drawer with adjustable height
  - 960–1279px: Status panel collapses into tabs above console; jog controls expand to full-width row below visualization
  - <960px / Tablet: Switch to stacked layout with visualization on top, followed by jog controls, status cards, console accordion
- **Navigation Controls**:
  - Toolbar (top) with primary actions: `Connect`, `Start`, `Pause`, `Stop`, `Emergency Stop`
  - Breadcrumb/status indicator for current workspace (G54/G55, Auto/Manual, etc.)
  - Overlay toggle buttons anchored on visualization for viewport changes (Top/Side/Front/3D) and shading modes
- **Modal & Dialog Patterns**: Use side-sheet overlays for settings and job preparation; employ modal dialogs only for critical confirmations (e.g., emergency stop, job cancel)

## Component Hierarchy (Vue Proposal)
- `AppShell`
  - `TopToolbar`
  - `MainLayout`
    - `ToolpathViewport`
      - `ViewportControls`
      - `LayerLegend` (future)
    - `RightPanel`
      - `JogPanel`
        - `AxisControl` (per axis X/Y/Z/A)
        - `FeedOverride`
        - `SpindleOverride`
      - `StatusPanel`
        - `MachineCoords`
        - `WorkOffsetCards`
        - `AlarmIndicator`
      - `ConsolePanel`
        - `ConsoleOutput`
        - `CommandInput`
  - `UtilityBar`
    - `ConnectionStatus`
    - `ThemeToggle`
    - `SettingsShortcut`
- Provide slots/hooks for plugin extensions (e.g., probing, macros)

## Key Screens / States
1. **Idle / Disconnected**: Prominent `Connect Machine` CTA, disabled run controls, sample preview placeholder
2. **File Loaded / Ready**: Toolpath rendered, jogging enabled, status panel shows offsets, console streaming live messages
3. **Active Job**: Run-time overlay with progress, estimated time remaining, live command feed, `Pause`/`Stop` controls highlighted
4. **Alarm / Fault**: Red accent for emergency state, console pinned to top with relevant message, quick action buttons (Reset/Unlock)

## Theming Guidelines
- **Base Palette**: Neutral grays for backgrounds, single accent (e.g., teal `#1ABC9C`) applied to active controls, gradients used sparingly (accent-to-transparent on primary CTA buttons)
- **Light Theme**:
  - Background: `#F7F9FC`
  - Surface panels: `#FFFFFF` with subtle shadow (`0 2px 12px rgba(20, 20, 20, 0.08)`)
  - Typography: `#1E2A32` primary, `#5E6B75` secondary
- **Dark Theme**:
  - Background: `#111720`
  - Surface panels: `#1A222E` with stroke `rgba(255, 255, 255, 0.04)`
  - Typography: `#E6ECF2` primary, `#93A2B4` secondary
- **Touch Targets**: Minimum 44px height/width; use 16px padding for interactive rows and 24px spacing between groups
- **Iconography**: Line icons with 2px stroke, paired with labels when feasible (especially for touch interactions)

## Interaction Patterns
- **Toolpath Viewport**:
  - Pinch/scroll to zoom, two-finger drag/pan, single-finger rotate in 3D mode
  - On desktop: mouse wheel zoom, right-click drag rotate, shift+drag pan
  - Overlay control ring for quick camera presets (Top, Front, Isometric)
- **Jogging**:
  - Large arrow buttons with press-and-hold repetition; include step size selector (0.1 / 1 / 10 mm)
  - Provide keyboard shortcuts discovery tooltip (`WASD`, `QE`, `R/F`)
- **Status Panel**:
  - Distinguish machine vs work coordinates via color-coded badges; toggle to switch between absolute/incremental views
  - Display active work offset (G54 etc.) with quick-change dropdown
- **Console**:
  - Scrollback with sticky input at bottom; command history accessible via swipe-up gesture or keyboard arrow keys
  - Highlight errors/warnings with accent border; allow filtering by log level
- **Theme & Settings**:
  - Theme toggle in utility bar; persist preference using local storage
  - Settings presented in right-side drawer with segmented controls (Connection, Machine, UI)

## Implementation Notes & Next Steps
- Establish Vue 3 + Vite + Electron project scaffold; integrate Tailwind or UnoCSS for rapid theming
- Define shared design tokens (colors, spacing, typography) via CSS variables for theme switching
- Build core layout components first (`AppShell`, `MainLayout`, `ToolpathViewport` placeholder) before integrating CNC-specific logic
- Create mock data for toolpath visualization and status panels to validate layout responsiveness
- Plan for future extensibility (macro panel, probing wizard) by reserving slots within right panel and toolbar
- Conduct usability testing on touch-enabled devices once initial prototype is interactive (focus on jog controls and viewport gestures)

