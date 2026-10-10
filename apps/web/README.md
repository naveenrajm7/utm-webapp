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
