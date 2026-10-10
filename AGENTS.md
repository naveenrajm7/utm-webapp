# UTM Web agent instructions

## Product and current code

This repository is a local Mac control plane for UTM virtual machines. The intended design is one backend used by the browser UI and a thin MCP client. The current code is a prototype, not that final architecture. Read `notes/AgentHandoff.md` before starting implementation work.

The npm-workspace monorepo currently has two apps:

| App | Port | Current implementation |
| --- | --- | --- |
| `apps/web` | 3000 | Next.js 14 browser UI, including serial and VNC routes |
| `apps/api` | 3001 | Express REST and WebSocket API, JXA scripts, `screen` serial bridge |

There is no `apps/terminal` app. VM control currently lives in individual controllers and scripts under `apps/api/src`. The API key protects the existing REST and WebSocket routes; the UI holds it in `sessionStorage` and uses a query parameter for WebSockets. The API does not yet have VM creation, clone, delete, guest execution, snapshots, sandbox orchestration, or MCP endpoints.

## Local development

On the Mac that runs UTM, set `UTM_API_KEY` to a random secret and run `npm run dev`. The API requires that variable at startup. `npm run build --workspace=api` and `npm run build --workspace=web` passed on the refreshed `main` branch during the October 2026 handoff. `npm run test --workspace=api -- --runInBand` passed all eight tests when localhost socket binding was permitted. A sandbox that denies socket binding makes the Supertest suite fail with `EPERM`; rerun it in an environment that permits localhost sockets before treating that as a code failure.

UTM operations are macOS-only and require access to the user's UTM GUI session. Linux can build and test mocked service logic but cannot validate live VM operations. The API's Dockerfile is not a way to control UTM from a Linux container. On this Mac, UTM 5.0.6 beta is installed; snapshot availability varies by UTM version, VM backend, and macOS version. Detect capabilities instead of assuming support.

## Agent work boundaries

- Each agent works in its own Git worktree and branch. File ownership, the local API contract, acceptance checks, and merge order are in `notes/AgentHandoff.md`.
- Do not edit another agent's owned paths without coordinating with the integration owner. Leave root `package-lock.json` conflict resolution to integration.
- Do not run clone, delete, reset, snapshot restore, or experimental configuration changes on a user's existing VM. Use a named disposable test template and clones of it. Mock these operations when a safe test VM is unavailable.
- Keep the existing UI branch `codex/web-ui-wip` intact. Its local commit preserves previously uncommitted UI work. That branch also carries `notes/archive/NextSteps-2026-09.md`, a historical note with outdated status claims.
- For the current milestone, make the system work locally on one Mac. DMG packaging, public internet access, multi-host coordination, and a complete VM creation wizard are later work.
