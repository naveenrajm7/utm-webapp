# UTM Web App

A Web UI for UTM, access UTM from anywhere within your browser.  
*Turn your Mac into private cloud.*

## Start 

The api requires `UTM_API_KEY`. Generate a secret and export it before starting:

```sh
export UTM_API_KEY="$(openssl rand -hex 32)"
npm run dev
```

The web UI will ask for that same key once per browser tab (stored in
`sessionStorage`) and send it on every REST call and WebSocket.

Start and stop are `POST /start` and `POST /stop`. `GET /status` is the only
unauthenticated route (liveness).


## What's inside?

This Turborepo includes the following:

### Apps and Packages

- `web`: a [Next.js](https://nextjs.org/) app - Main UI for UTM Web, including the
  per-VM serial console (`/terminal/<uuid>`) and VNC display (`/vnc/<uuid>`).
- `api`: an [Express](https://expressjs.com/) server - providing APIs to control UTM.

The `api` runs on port 3001 and must run on the Mac hosting UTM, since it drives
UTM through `osascript` and `screen`.


