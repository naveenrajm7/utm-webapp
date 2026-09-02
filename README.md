# UTM Web App

A Web UI for UTM, access UTM from anywhere within your browser.  
*Turn your Mac into private cloud.*

## Start 

Run the following command:

```sh
npm run dev
```

## What's inside?

This Turborepo includes the following:

### Apps and Packages

- `web`: a [Next.js](https://nextjs.org/) app - Main UI for UTM Web, including the
  per-VM serial console (`/terminal/<uuid>`) and VNC display (`/vnc/<uuid>`).
- `api`: an [Express](https://expressjs.com/) server - providing APIs to control UTM.

The `api` runs on port 3001 and must run on the Mac hosting UTM, since it drives
UTM through `osascript` and `screen`.


