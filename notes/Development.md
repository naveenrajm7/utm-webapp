

This is a monorepo


### To start

```bash
npm run dev
```

Serves `web` on 3000 and `api` on 3001. The serial console and VNC display are
routes inside `web` (`/terminal/<uuid>` and `/vnc/<uuid>`), both talking to the
API's WebSocket on 3001.


### To run the built version

```bash
npm run build
npm start --workspace=api
npm start --workspace=web
```

`npm start` runs the compiled output, so it needs a build first. The api build
copies `src/scripts/*.js` into `dist/scripts`, because the JXA scripts are
resolved relative to the running file and `tsc` only emits TypeScript.


### To install module for an app

```
npm install @xterm/xterm --workspace=web

npm install @novnc/novnc --workspace=web 
```