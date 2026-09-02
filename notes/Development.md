

This is a monorepo


### To start

```bash
npm run dev
```

Serves `web` on 3000 and `api` on 3001. The serial console and VNC display are
routes inside `web` (`/terminal/<uuid>` and `/vnc/<uuid>`), both talking to the
API's WebSocket on 3001.


### To install module for an app

```
npm install @xterm/xterm --workspace=web

npm install @novnc/novnc --workspace=web 
```