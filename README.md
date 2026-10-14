# UTM Web App

A local browser UI for controlling UTM on the same Mac. The longer-term goal is a
single UTM backend that can also support remote access and automation.

## Start 

The api requires `UTM_API_KEY`. Generate a secret and export it before starting:

```sh
export UTM_API_KEY="$(openssl rand -hex 32)"
npm run dev
```

The web UI will ask for that same key once per browser tab (stored in
`sessionStorage`) and send it on every REST call and WebSocket.

The web UI uses authenticated `/v1` routes for VM inventory, details, start,
stop, and job status. Older unversioned routes remain for compatibility.
`GET /status` is the only unauthenticated route (liveness). The API binds to
`127.0.0.1:3001` by default, so remote browser access is a later milestone.

The local VM flow and integration history are in
[`notes/AgentHandoff.md`](notes/AgentHandoff.md). Sandbox and MCP integration
remain paused.

## Browser acceptance

Run `npm ci`, `npm run build`, then `npm run test:browser` to exercise the real
browser UI against a deterministic fake API. The suite owns localhost ports
3000 and 3001 for its run, uses headless Chrome, and never mutates UTM. See
[`notes/Phase4BrowserAcceptance.md`](notes/Phase4BrowserAcceptance.md) for
coverage, environment, and the separate live integration gate.


## What's inside?

This Turborepo includes the following:

### Apps and Packages

- `web`: a [Next.js](https://nextjs.org/) app - Main UI for UTM Web, including the
  per-VM serial console (`/terminal/<uuid>`) and VNC display (`/vnc/<uuid>`).
- `api`: an [Express](https://expressjs.com/) server - providing APIs to control UTM.

The `api` runs on port 3001 and must run on the Mac hosting UTM. It uses
`packages/utm-adapter` for `/v1` and legacy VM inventory, details, and power
control, as well as serial and VNC endpoint discovery. The API owns REST,
jobs, authentication, and WebSocket bridging; UTM-specific calls stay in the
adapter. Start and stop require a VM that supports those actions.
