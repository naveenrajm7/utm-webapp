# UTM Web UI

This browser UI talks to the local API on the same Mac as UTM. It lists VMs,
shows their details, and starts or stops them through authenticated `/v1`
requests. Serial and VNC controls appear only when the API reports the
corresponding VM capability.

From the repository root, run `npm ci`, set `UTM_API_KEY` to a random local
secret, and run `npm run dev`. Open `http://localhost:3000` on that Mac and
enter the same API key. The API listens on `127.0.0.1:3001` by default.

The managed sandbox panel is parked until its backend service is integrated.
The `SandboxPanel` component and client helpers remain available for that
later milestone, but are not rendered in the current UI.

## Appearance

The UI follows UTM's macOS window: a full-height sidebar of virtual machines,
a unified toolbar, and a detail pane with a screen preview and a Details box.
Colors follow the viewer's light or dark system setting.

## Static preview for GitHub Pages

`npm run build:demo --workspace=web` builds the same source as a static site in
`apps/web/out`. In this mode the client answers `/v1` requests from an
in-browser simulation (`src/app/demo/`), skips the API key screen, and replaces
the VNC display and serial console with simulated ones. It never contacts a
UTM host. Set `NEXT_PUBLIC_BASE_PATH` to the path the site is served from, for
example `/utm-webapp` for a project page.

`.github/workflows/pages.yml` runs that build on every push to `main` that
touches the web app and deploys it to GitHub Pages. Enable it once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**. The
preview is then published at `https://<owner>.github.io/<repository>/`.
