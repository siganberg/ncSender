# Imperial Unit Support Plan

This document captures the application-wide updates required to add an imperial (inch) units mode to ncSender while keeping metric (millimeter) as the default. It groups the work into feature areas so it can be implemented incrementally without regressing existing metric behavior.

## Goals

- Provide a settings toggle that lets users choose between metric and imperial units.
- Ensure every user-facing measurement, label, and control respects the active unit system.
- Keep the internal GRBL/controller interactions consistent, preserving the current metric workflows where required (e.g., probing).
- Minimize duplication by centralizing unit conversion and formatting logic.

## Settings and Persistence

- Extend the Electron settings defaults (`app/electron/core/settings-manager.js`) with a `unitsPreference` key (`"metric"` | `"imperial"`).
- Update settings routes (`app/electron/features/settings/routes.js`) to accept, validate, and persist the new field.
- Add a toggle in the App settings dialog (`app/client/src/App.vue`) using `ToggleSwitch`, persisting changes through `updateSettings`.
- Extend the client settings store (`app/client/src/lib/settings-store.js`) and `use-app-store.ts` to expose the active units across the UI.
- Handle migrations: fall back to `metric` when the field is missing; avoid breaking existing settings files.
- Jogging should start

## Shared Unit Utilities

- Create a helper module (e.g., `app/client/src/lib/units.ts`) that provides:
  - Converters between mm ↔ in and mm/min ↔ in/min.
  - Formatting helpers for coordinates, distances, feed rates, and axis labels.
  - Utilities to map the unit preference to G-code modal commands (G20/G21) where needed.
- Ensure helpers default to metric when the preference is unknown.

## Jogging Experience

- Update Jog controls (`features/jog/JogPanel.vue` and `JogControls.vue`) to:
  - Display step-size chips in the chosen units and adjust defaults accordingly (e.g., 0.1 mm vs 0.004 in).
  - Use "$J G20 .."" sending jog command to inform the controller that unit is imperial (no conversion needed).
  - Validate feed rate inputs against unit-aware limits and display errors using the correct suffix (mm/min or in/min).


## Status and Console Panels

- Update `StatusPanel.vue` and related console displays so that:
  - Coordinate readouts, overrides, and feed displays reflect the selected unit system.
  - Labels update automatically (e.g., `mm` → `in`, `mm/min` → `in/min`).
  - Formatting precision adapts (e.g., four decimal places for inches vs three for millimeters).
- Ensure console logs or command previews that show generated G-code either stay in controller units (with annotation) or offer a converted tooltip.

## Toolpath Visualizer

- Keep the internal geometry in millimeters, but adjust the UI layers:
  - Grid spacing, axis rulers, axis labels, and dimension annotations should render using the selected units (e.g., keep 10 mm spacing in metric, switch to 0.5 in spacing in imperial).
  - Auto-fit, bounding boxes, and out-of-bounds warnings should derive from converted values when presented to the user.
  - Legend descriptions (e.g., “Rapid (G0)”) should clarify the unit context if numeric values are shown.
- Store and restore view preferences in settings without breaking existing data.

## Machine Dimensions and Metadata

- `use-app-store.ts` currently stores machine dimensions in mm; add computed getters that convert to inches for UI consumers.
- Verify all consumers (RightPanel, tooltips, parking commands) adopt the helpers instead of duplicating conversions.
- Ensure safe parking sequences and workspace-change commands emit metric moves while showing imperial equivalents in the UI.

## G-code Analysis and Runtime Estimates

- Update `app/electron/features/gcode/gcode-preanalyzer.js` to track when a file switches between G20/G21 and report distances/feed rates using the appropriate units for display.
- When presenting estimated runtimes or per-line statistics in the UI, convert values to match the user preference.

## Probing Flows

- Probing routines (`app/electron/features/probe/*`) already preserve the previous unit modal; confirm they still restore the user preference after probes end.
- Update probe dialog copy, validation messages, and numeric inputs to show unit-dependent ranges and suffixes while leaving the transmitted commands metric internally.

## Testing Checklist

- Unit toggle persists across app restarts and synchronizes across multiple windows.
- Jogging (step, continuous, diagonal) behaves correctly in both unit modes; verify the raw commands remain valid.
- Visualizer grid and axis labels update immediately when toggling units; auto-fit still functions.
- Status panel coordinates and feed rates match physical machine reports when switching units mid-session.
- Probe workflows restore the unit mode correctly after completion.
- G-code analyzer outputs reasonable estimates for both G20 and G21 files.

## Documentation and Follow-up

- Update user-facing docs (README, release notes) to describe the new toggle and unit behavior.
- Consider future enhancements:
  - Per-file unit detection warnings when the preference and G-code modal differ.
  - Allow users to opt into sending jog commands in imperial by switching the controller modal before jogging.
  - Surface controller unit mode in the status bar for clarity.

---

Use this plan as the backlog for implementing imperial support. Each bullet can be turned into a tracked task or issue when scheduling the work.
