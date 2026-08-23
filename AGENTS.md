# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
UTM Web App — a browser UI to control [UTM](https://mac.getutm.app/) virtual machines on a Mac. Turborepo monorepo (npm workspaces). Three apps under `apps/`:

| App | Port | Framework | Dev command |
|-----|------|-----------|-------------|
| `web` | 3000 | Next.js 14 | `next dev -p 3000` |
| `api` | 3001 | Express + `ws` + `node-pty` | `nodemon` w/ `esbuild-register` |
| `terminal` | 3002 | Next.js 15 | `next dev -p 3002` |

Standard commands are in the root `package.json` / `turbo.json`: `npm run dev` (runs all three via Turbo), `npm run lint`, `npm run test`, `npm run build`.

### Platform requirement (most important gotcha)
The core features (list/start/stop VMs, VNC, serial console) are **macOS-only**. The `api` shells out to `osascript -l JavaScript` (JXA) against UTM.app and to `screen` for the serial PTY. On the Linux cloud VM these calls fail by design, e.g. `GET /list_vms` returns `{"error":"Failed to execute script"}`, and the `web` home page then throws `vms.map is not a function` in `VMList.tsx` because it renders the error object. This is expected on non-macOS hosts, not an environment/setup bug. Everything still builds/serves; only live VM data is inert. The `screen` utility (used only for the macOS serial console) is intentionally not installed here.

What DOES work on Linux for smoke-testing the stack:
- `GET http://localhost:3001/status` -> `{"ok":true}`
- `GET http://localhost:3001/message/<name>` -> `{"message":"hello <name>"}`
- `web` (3000) and `terminal` (3002) serve HTTP 200.

### Dev mode vs build (pre-existing issues — do NOT "fix" as setup)
Use **dev mode** (`npm run dev`); the `api` dev script uses `esbuild-register`, which strips types without type-checking, so it runs cleanly. The production `build` (`tsc` / `next build`) currently fails due to pre-existing repo issues that are unrelated to environment setup:
- `api`: missing `@types/ws` devDependency -> `tsc` implicit-any errors.
- `web`: `next build` type-checks and fails on the untyped dynamic import `@novnc/novnc/lib/rfb`.
- `terminal`: `next build` crashes during page-data collection.

Similarly, `npm run test` fails because the shared preset is `packages/jest-presets/node/jest-preset.ts` and Jest 29 only resolves preset files with `.json/.js/.cjs/.mjs` extensions (`Preset @repo/jest-presets/node not found`). `npm run lint` passes for `web`/`api`/`ui`/`logger`; `terminal`'s `next lint` fails with `context.getAncestors is not a function` (ESLint 9 vs bundled `@next/next` plugin). These are all pre-existing and should not be masked by changing setup.

### Frontend/api host wiring
`web/src/app/config.ts` derives the api host from the current browser host at `:3001` (and terminal at `:3002`). Override with `NEXT_PUBLIC_API_HOST`, `NEXT_PUBLIC_TERMINAL_HOST`, `NEXT_PUBLIC_API_WS_HOST`. The `docker-compose.yml` only defines `web`+`api` (not `terminal`) and needs a pre-existing external Docker network `app_network`; running `npm run dev` directly is simpler for development.
