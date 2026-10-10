# UTM Web agent instructions

## Product and current code

This repository is a local Mac control plane for UTM. The immediate goal is one UTM adapter behind the REST and WebSocket API, used by the browser UI. Read notes/AgentHandoff.md before implementing the next milestone.

The npm-workspace monorepo currently has two running apps and one UTM package:

| Path | Role |
| --- | --- |
| apps/web | Next.js 14 browser UI on port 3000 |
| apps/api | Express REST and WebSocket API on port 3001 |
| packages/utm-adapter | Injectable UTM process and JXA boundary |

The merged main branch has authenticated /v1 VM inventory, details, start and stop jobs, and a browser UI that consumes those routes. The adapter also defines clone, configure, delete, and guest execution methods, but those methods are not exposed as live direct-VM REST routes or validated on a disposable VM. Legacy REST controllers and console target discovery still invoke separate JXA scripts. Sandbox routes exist as interfaces but return service_unavailable in the running API; the MCP and sandbox implementations are on separate branches. Their integration is paused.

## Local development and verification

On the Mac running UTM, set UTM_API_KEY to a random secret and run npm run dev. The API listens on 127.0.0.1:3001 by default. The web app is intended for use on the same Mac during this milestone.

At the 2026-10-10 review, adapter and API builds, the web build, and lint for all three passed. Tests passed: 9 adapter, 19 API, and 3 web. API Supertest tests require permission to bind a local socket; an EPERM from a restricted sandbox is not a code failure. Read-only adapter inventory and one QEMU VM detail request succeeded against UTM 5.0.6 on this Mac. Live power, console, clone, configure, delete, and guest execution remain unverified. No personal VM may be used for destructive or experimental checks.

## Current work boundaries

- Start every new lane from current main in a new branch and worktree. The prior adapter, API, and UI branches have already been merged. Do not reuse them for the next wave.
- The active milestone is local VM control and the web app. Sandbox orchestration, guest execution, MCP, packaging, and remote access are paused.
- Follow the interface and file ownership in notes/AgentHandoff.md. Coordinate changes to shared types before changing them. The integration owner resolves package-lock.json conflicts.
- Run read-only checks against existing VMs. Start, stop, clone, configure, delete, and console tests require a named disposable test VM or clone. If none is supplied, use fakes and report the live validation gap.
- Do not expose a capability in the API or UI merely because a method exists in code. Verify that the installed UTM build and VM backend support it.
