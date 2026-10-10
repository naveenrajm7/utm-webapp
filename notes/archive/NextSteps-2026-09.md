# Handoff: current state and next steps

> Historical September 2026 handoff. Several status and security claims below
> predate the API-key changes on `main` and UTM 5.0.6. Use the current
> `AGENTS.md` and `notes/AgentHandoff.md` for new work.

Written September 2026, against `main` @ `1f665c6`. Companion to
`notes/Roadmap.md` (on the `cursor/agent-platform-roadmap` branch) and to
`notes/MarketResearch.md` / `notes/AgentInfrastructure.md` (on the
`cursor/market-research-ai-agent-positioning-f26e` branch).

**Direction:** the near-term goal is a solid companion web app that anyone can
run alongside UTM and reach from anywhere. The agent/MCP platform in
`Roadmap.md` is still the destination, but it comes after the basics work.

---

## 1. What works today, and how it was verified

Two apps: `web` on 3000, `api` on 3001. The api must run on the Mac hosting
UTM, because it drives UTM through `osascript` (JXA) and `screen`.

| Capability | Endpoint / route | Verified |
|---|---|---|
| List VMs | `GET /list_vms` | 30 VMs against UTM 5.0.5 |
| VM details | `GET /vm_info?uuid=` | yes |
| Start / stop / status | `GET /start`, `/stop`, `/status_vm` | full cycle, two VMs |
| Serial console | `ws://api:3001?vmUUID=` | boot output **and** keystroke echo |
| VNC display | `ws://api:3001/vnc?vmUUID=` | full RFB handshake + 1280x800 framebuffer |
| Web UI | `/`, `/terminal/<uuid>`, `/vnc/<uuid>` | all 200 |

Serial and VNC were also confirmed working **simultaneously on the same VM**.
Across every connection, serial attach and clean-close counts stayed balanced
with no orphaned `screen` sessions.

Production build works: `npm run build`, then `npm start --workspace=api` and
`npm start --workspace=web`. `npm start` needs a build first. The api build
copies `src/scripts/*.js` into `dist/scripts`, because the JXA scripts are
resolved relative to the running file and `tsc` only emits TypeScript.

---

## 2. Corrections to `notes/Roadmap.md`

The roadmap is still broadly right. Four things have changed since it was
written, and the next agent should not trust those sections as-is.

**§4 "Missing type declarations" is done, but lint still fails.** `@types/ws`
is installed and `apps/web/src/types/novnc.d.ts` declares the noVNC module, so
`npm run build` passes. `npm run lint --workspace=api` still fails, but now for
an unrelated reason: eslint parses the TypeScript sources without a TypeScript
parser and reports `Parsing error: Unexpected token :` on every file.
`tsc --noEmit` passes cleanly. Fixing this means configuring
`@typescript-eslint/parser` in `@repo/eslint-config`, and should be expected to
surface a batch of genuine lint errors once the parser actually works.

**§2 "Where the code actually is" is out of date.** The separate `terminal`
app is gone; the serial console is a route inside `web`. Port 3002 no longer
exists.

**UTM exposes configuration editing, which the roadmap did not know about.**
From `sdef /Applications/UTM.app`:

```
update configuration  — Update the configuration of the VM. Must be stopped.
                        Direct param: the VM. Labelled param: `with`.
reload configuration  — Re-read the bundle from disk, discarding cached
                        in-memory config. Must be stopped.
update registry       — "Currently you can only change the shared directory"
```

This unblocks both the auto-enable-VNC work and the `configure` UI stub.
Caveat found the hard way: **UTM caches configuration in memory**, so editing
`config.plist` on disk does nothing until you call `reload configuration`.
That pairing (edit bundle, then reload) is a working technique.

**Apple Virtualization VMs cannot use the serial console.** Those VMs report
`serialPorts` as `unavailable`, so `/terminal/<uuid>` can never work for them.
The UI should detect this and say so rather than opening a dead console.

---

## 3. The two named follow-ups

### 3.1 eslint has no TypeScript parser (small, unblocks CI)

`apps/api`'s lint script is `tsc --noEmit && eslint "src/**/*.ts*"`. The `tsc`
half passes; eslint fails to parse TS syntax at all. Fix the shared
`@repo/eslint-config` to use `@typescript-eslint/parser`, then fix whatever
real warnings appear. Worth doing before adding CI, since CI would be red from
day one otherwise.

### 3.2 Auto-enable the VNC display (highest visible payoff)

Today VNC only works if the VM already has a `-vnc <host>:<n>` entry in its
extra QEMU arguments. Of 30 VMs, exactly two do. Everyone else gets:

```
VM has no VNC display; add a '-vnc 127.0.0.1:<n>' QEMU argument to its configuration
```

That message is correct and actionable, but it means VNC works out of the box
for nobody. With `update configuration` this is now solvable:

1. VM must be stopped (the command requires it).
2. Read `configuration().qemuAdditionalArguments`.
3. If no `-vnc` entry, pick a free display number `n` (port is `5900 + n`;
   check nothing is listening) and append `-vnc 127.0.0.1:<n>`.
4. Apply with `update configuration`, then start the VM.

Notes from the existing implementation: the parser is
`/^-vnc\s+(?:([^\s:]*):)?(\d+)/` in `apps/api/src/scripts/vm_control.js`, and
it already handles both `127.0.0.1:1` and bare `:1,websocket=15901`. An empty
host defaults to `127.0.0.1`. Prefer binding to `127.0.0.1` rather than all
interfaces, since the api bridges it anyway.

Pair this with embedding the display inline in `VMInfo`, which currently
renders the literal string "Screen Placeholder" where the VM screen belongs.

---

## 4. Recommended order after those two

Reconciles the companion-app priority with `Roadmap.md`'s Milestone A.

**First, because it is overdue rather than merely next:**

1. **Authentication.** There is none, and the api binds all interfaces. Anyone
   who can reach port 3001 can stop VMs, open a serial console, or view a
   screen. Enforce across REST **and** both WebSocket paths.
   (`Roadmap.md` Step 4.)
2. **Move mutations off `GET`.** `/start`, `/stop` and `/status_vm` are `GET`,
   so a link prefetcher or crawler can stop a running VM. Do it alongside auth
   while the surface is small.

**Then the things that make the UI honest:**

3. **Live status.** `VMList` fetches once on mount and never again, so a VM
   started from the UI still reads "stopped" until reload. The api already has
   a WebSocket server to push over.
4. **Inline VM screen** in `VMInfo`, with serial as a tab beside it, replacing
   the placeholder and the pop-out windows. Depends on 3.2.
5. **Finish the lifecycle.** `delete`, `clone` and `configure` in
   `VMActionControls` are still `console.log` stubs; the `+` button and
   "Create a New Virtual Machine" have no handlers at all. UTM provides
   `duplicate`, `delete` and `update configuration`.
   (`Roadmap.md` Steps 2, 3, 7.)

**Then usability at scale:**

6. **Search and filter.** 30 VMs in a flat unsorted list is already the slowest
   part of using this.
7. **Responsive layout and touch.** The sidebar is a fixed 300px with a
   mouse-only resizer inside `height: calc(100vh - 60px)`. On a phone — the
   "access from anywhere" case — it does not work. Touch input for VNC and the
   terminal belongs here.
8. **Loading, error and empty states.** Failed fetches only reach
   `console.error`, so users get "Loading..." forever. "UTM isn't running"
   deserves its own message.

**Only then the agent platform** — `Roadmap.md` Step 0 (prove `execute`
works), Step 1 (`run_command`), Step 5 (audit log), Step 6 (MCP server). None
of that analysis has been invalidated except as noted in §2.

---

## 5. Test environment notes

Things that cost time to discover.

- **Keep the Mac awake.** It sleeps after a minute idle, which kills SSH
  sessions and VMs. `caffeinate -dimsu` via launchctl survives session drops.
- **Good serial test VM:** `alpine-3-aarch64-...` (`DB513A4B-...`). Boots in
  seconds under the hypervisor, console on `/dev/ttyAMA0`, prints a login
  prompt and echoes keystrokes. No display, so no VNC.
- **Good VNC test VM:** `DebTest` (`684165A9-...`). Has `virtio-ramfb`,
  `-vnc :1,websocket=15901`, a serial port, and `Hypervisor: true`.
- **DebTest will not start as it stands.** It has a VirtFS shared folder
  pointing at `/Users/naveenrajm/Developer/saas/bin`, and UTM can no longer
  open it (`Operation not permitted` — a security-scoped bookmark invalidated
  by the 5.0.5 upgrade). Either re-select that folder in UTM's settings, or
  temporarily set `Sharing.DirectoryShareMode` to `None` in the bundle's
  `config.plist` and call `reload configuration`. **Back up the plist and
  restore it afterwards** — it is currently back to its original `VirtFS`.
- **`vagrant_test_default_...` does not boot.** It burns 100% of a core
  indefinitely on an M2 and never reaches sshd, so it is running without the
  hypervisor or looping in boot. Do not use it as a test target.
- **Verifying serial without credentials:** connect to
  `ws://localhost:3001?vmUUID=<uuid>`, nudge with `\r` every few seconds until
  a login prompt appears (bytes sent before `screen` attaches are lost), then
  type a marker string and confirm the guest echoes it back. That proves both
  directions without handling passwords.
- **Verifying VNC:** a small RFB client over `ws://localhost:3001/vnc?vmUUID=`
  — handshake, `SetPixelFormat` to 32bpp true colour, `SetEncodings` to Raw,
  then a non-incremental `FramebufferUpdateRequest` — yields a decodable frame
  you can write out as PPM and convert with `sips`.

---

## 6. Known-bad, not yet addressed

- **No authentication anywhere** (see §4).
- **`docker-compose.yml` is misleading.** It builds `web` and `api` as
  containers, but the api can never run in one: it needs `osascript`, `screen`
  and UTM on the host macOS. It should be deleted or rewritten to containerise
  only `web`.
- **Test coverage is two routes** (`/status` and a scaffolding
  `/message/:name`). Every step above should land with a test; the JXA layer
  can be faked at the `runJxa` boundary.
- **`/message/:name` is Turborepo scaffolding**, not product. Delete it.
- **Dead UI affordances:** the "Server" button in `WelcomeScreen` is
  `href="#"`, and `VMList` has an unused `uuid` parameter that trips a lint
  warning.

---

## 7. Open questions carried over from `Roadmap.md`

1. Does a stock vagrant/Ubuntu ARM64 image include `qemu-guest-agent`, or must
   images be built for it?
2. Is `execute` synchronous enough, or does `get result` need polling?
3. Long-running commands: block, or return a handle the agent polls?
4. Can the QEMU monitor give real snapshots? UTM's dictionary has no snapshot
   command, so `suspend` and `duplicate` are all that is scriptable today.
