# Native UTM visual reference and web rework

Captured from the installed **UTM 5.0.8** on macOS on 2026-11-06. The
native library window was resized to 1200 × 850 for comparison with the
browser at the same size. App preferences use their native window size;
the Apple settings and later wizard captures contain only the sheet.

## Compare

| Native UTM | Shared web/demo UI |
| --- | --- |
| [Library](native/01-library-dark.png) | [Library](web/02-library-dark.png) |
| [Information settings](native/03-settings-information.png) | [Information settings](web/03-settings-information-dark.png) |
| [System settings](native/04-settings-system.png) | [System settings](web/04-settings-system-dark.png) |
| [Clone](native/13-clone-dialog.png) | [Clone](web/05-clone-dark.png) |
| [Delete](native/14-delete-dialog.png) | [Delete](web/06-delete-dark.png) |

Additional browser captures cover welcome, stopped serial, light appearance,
and a 390 × 844 viewport with the sidebar and settings sheet open.

## Native survey: 41 screenshots

| Files in `native/` | Screens inspected |
| --- | --- |
| 01–02 | Library details and snapshots |
| 03–12 | QEMU Information, System, QEMU, Arguments, Input, Sharing, Serial, Network, Port Forward, VirtIO drive |
| 13–14 | Clone and delete confirmation dialogs, both cancelled |
| 15–20 | Creation start, OS selection, and Linux/Windows/macOS/Other entry pages |
| 21–27 | Application, Display, Sound, Input, Network, File, Server preferences |
| 28–31 | Graphical QEMU Display, Sound, USB drive, NVMe drive |
| 32–36 | Apple System, Boot, Virtualization, Sharing, Display |
| 37–41 | Creation Hardware, Boot, Storage, Shared Directory, Summary; cancelled before Save |

The main QEMU survey used the designated disposable source
`vagrant_test_default_1744595654130_77151`. Graphical QEMU and Apple settings
were inspected read-only. No settings were saved, no snapshot was taken or
restored, no VM was created, cloned, deleted, started, or stopped, and no guest
console was attached. This is a visual inspection, not new live mutation or
console acceptance. Running guest windows, file pickers, and every possible
device/architecture combination are outside this survey.

## Shared implementation

Both the authenticated app and static demo render `VMManager`, `VMList`,
`VMInfo`, `VMManagementControls`, and the same `globals.css`. The simulation
still only replaces the API/console boundary. There is no duplicate demo UI.

The rework follows the native sidebar width, row spacing, unframed OS icons,
compact toolbar, neutral preview/play control, details below the preview,
right-aligned values, and two-pane settings sheet. Settings retain only the
existing supported name, memory, and CPU fields. Native snapshots, creation,
device editing, server preferences, move, and share were reference material;
they have not been exposed as working web features.

Search remains available at the bottom of the sidebar. Web authentication,
the demo indicator, supported display/serial tabs, status information, and the
exact-name delete guard remain available. A browser cannot reproduce native
window materials and SF Symbols exactly. Light appearance follows the shared
system-style palette; the native reference session was in dark appearance.

The original UTM OS artwork and converted application icon are in
`apps/web/public/utm-icons/`, with source attribution and the upstream license.
Asset URLs include the build's base path for GitHub Pages.

## Verification and preview

The following passed after the functional changes:

```sh
npm run build
npm run lint
npm test
npm run test:browser
NEXT_PUBLIC_BASE_PATH=/utm-webapp npm run build:demo --workspace=web
npm run review:ui
```

Unit tests: 112 passed (API 57, web 32, adapter 22, logger 1). Browser
acceptance: 9 fake-API results including the parent, one production
single-origin case, and one administrator-authentication case. The settings
acceptance now navigates to System before editing hardware.

`review:ui` serves the exported demo on loopback port 3108, uses an isolated
headless Chrome profile, and saves 12 screenshots in `web/`. It checks icon
loading under `/utm-webapp/`, light/dark and desktop/mobile layouts, sidebar
collapse, settings navigation, Escape and focus restoration, and exact-name
delete confirmation. It never contacts the real API or UTM. It produces
review artifacts, not an automated pixel-equality claim.

Run the export build before this command, and do not run a live Next build
against the same `.next` directory while the export is being reviewed.
`CHROME_PATH` and `BROWSER_WEB_PORT` can override the local defaults.

To keep the static demo open for manual review after building:

```sh
npm run review:ui -- --serve
```

Open <http://127.0.0.1:3108/utm-webapp/>. Stop with Ctrl-C. No live API or
personal VMs are involved. Native screenshots are local review artifacts and
contain VM names; review them before any public publication.
