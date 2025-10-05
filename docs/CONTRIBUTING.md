# Contributing Guide

Thanks for your interest in improving ncSender! This repository follows a Vertical (feature‑sliced) architecture and a Client–Server–Device (CSD) runtime model. Please follow these guidelines when opening a PR.

## Architecture Primer

- Organize code by feature, not type.
  - Client features: `app/client/src/features/<name>` with `Component.vue`, `api.ts`, `store.ts`.
  - Server features: `app/electron/features/<name>` with `routes.js` and any feature‑scoped providers.
- Communicate via WebSocket event bus.
  - Fire‑and‑forget commands; react to broadcast events like `cnc-command`, `cnc-command-result`, `server-state-updated`.
- Keep components thin; use feature API/store facades.
- Apply YAGNI: remove dead code; avoid premature generalization.

## Pull Request Checklist

- [ ] Place new code in the correct feature folder.
- [ ] Prefer feature APIs (`features/*/api.ts`) over direct use of the shared `lib/api.js` from components.
- [ ] Add or update a feature store facade only where needed (`features/*/store.ts`).
- [ ] Use the event bus pattern; do not add blocking request–reply flows.
- [ ] Update or add docs when introducing new events or flows.
- [ ] Keep changes minimal and cohesive; avoid sweeping unrelated refactors.

## Adding a Feature (Client)

1. Create `features/<name>/{Component.vue, api.ts, store.ts}`.
2. Wire the component into layout (`shell/RightPanel.vue` or main view).
3. Expose only the required state/actions in `store.ts`.
4. Wrap server calls in `api.ts`; prefer broadcasts for outcomes.

## Adding a Feature (Server)

1. Create `features/<name>/routes.js` and mount it in `app/electron/app.js`.
2. Broadcast on state changes (e.g., `server-state-updated`, `cnc-command-result`).
3. Keep device interactions behind controllers/managers colocated with the feature.

## Event Bus Reference (Common)

- `server-state-updated` – Server state snapshot
- `cnc-command` – Command queued/sent
- `cnc-command-result` – Result (success/error)
- `cnc-data` – Device data/status lines
- `gcode-updated` – G-code content changed
- `jog:*` – Jog lifecycle events

## Commit Style (suggested)

Use conventional commits where possible:

- `feat(<feature>): short summary`
- `fix(<feature>): short summary`
- `refactor(<area>): short summary`
- `docs(<area>): short summary`

## Docs and References

- Architecture: `docs/ARCHITECTURE.md`
