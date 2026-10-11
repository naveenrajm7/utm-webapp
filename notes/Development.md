

This is a monorepo


### To start

The api refuses to listen unless `UTM_API_KEY` is set. Turbo forwards that
variable (`globalPassThroughEnv` in `turbo.json`). Copy `apps/api/.env.example`
and export it in your shell (the api does not load `.env` files on its own):

```bash
export UTM_API_KEY="$(openssl rand -hex 32)"
npm run dev
```

Serves `web` on 3000 and `api` on 3001. The serial console and VNC display are
routes inside `web` (`/terminal/<uuid>` and `/vnc/<uuid>`), both talking to the
API's WebSocket on 3001. Unlock the UI with the same key.

VM start and stop use `POST /v1/vms/<uuid>/start` and
`POST /v1/vms/<uuid>/stop`; both return a job ID for `GET /v1/jobs/<jobId>`.
The old `POST /start?uuid=` and `POST /stop?uuid=` routes share the same
adapter-backed job service. Authenticate REST with `Authorization: Bearer
<key>` or `X-API-Key`, and WebSockets with that header or `?token=`.



### To run the built version

```bash
npm run build
npm start --workspace=api
npm start --workspace=web
```

`npm start` runs the compiled output, so it needs a build first. UTM
process and JXA operations are packaged with `@repo/utm-adapter`; the API
build emits TypeScript only.


### To install module for an app

```
npm install @xterm/xterm --workspace=web

npm install @novnc/novnc --workspace=web 
```