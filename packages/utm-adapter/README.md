# UTM adapter

`UtmPort` is the boundary for VM inventory, capability detection, clone, configuration, power control, deletion, and guest execution. Inject `UtmAdapter` into the API or sandbox service, or supply a fake `UtmPort` in tests. The adapter launches processes with argument arrays and no shell, validates VM UUIDs and guest arguments, and applies time and output limits. Failures have a stable `UtmError.code` and `operation`.

The adapter uses UTM's fixed scripting interface for structured inventory and configuration. It tries `utmctl version` once per adapter instance; if the command is available it uses `utmctl` for clone, power, delete, and guest execution. If the command is unavailable, fixed JXA actions provide those operations. A QEMU VM may advertise a guest execution path while its guest agent is absent; executing then returns a typed `unsupported` error. `network: "offline"` removes every NIC; `network: "shared"` replaces inherited NICs with one new shared/NAT NIC. Both require a stopped VM. Callers should only allow deletion of clones they own; this port has no ownership database.

## Mac smoke-test report (2026-10-10)

- Installed UTM version: 5.0.6, read from `/Applications/UTM.app/Contents/Info.plist`.
- `utmctl --help` exited 134 with no output in this execution environment. This is a CLI launch failure, not a successful UTM operation. The adapter's JXA fallback is covered by fake tests.
- No named disposable VM was provided or identified, so no live VM inventory, clone, configuration, start, stop, deletion, or guest execution was run. These calls still need Mac GUI-session validation with a named disposable template and its clone. In particular, verify JXA `duplicate`, `updateConfiguration` network presets, and guest agent output on the installed UTM build.

Run `npm run build --workspace=@repo/utm-adapter`, `npm run lint --workspace=@repo/utm-adapter`, and `npm run test --workspace=@repo/utm-adapter`. The integration owner will update the root `package-lock.json` when merging packages.
