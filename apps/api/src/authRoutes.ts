import { isAuthorizedRequest } from "./auth";
import { Router, json, type Request } from "express";
import { AdminAuth, AuthError, SESSION_COOKIE, SESSION_TTL_MS } from "./adminAuth";
import { isAllowedWebOrigin, isSameOriginWebSocket } from "./webOrigin";

export const trustedHost = (req: Request) => {
  try {
    const url = new URL(`http://${req.headers.host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      Number(url.port || 80) === req.socket.localPort;
  } catch { return false; }
};
export const trustedOrigin = (req: Request, singleOrigin: boolean) =>
  singleOrigin ? isSameOriginWebSocket(req) : isAllowedWebOrigin(req.headers.origin);

export const createAuthRouter = (auth: AdminAuth | undefined, singleOrigin: boolean) => {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use((req, res, next) => {
    if (!trustedHost(req)) return res.status(403).json({ error: { message: "Invalid host." } });
    if (req.method !== "GET" && (!trustedOrigin(req, singleOrigin) || req.get("X-UTM-Request") !== "1"))
      return res.status(403).json({ error: { message: "Invalid request origin." } });
    return next();
  });
  router.use(json({ limit: "4kb" }));
  // Installer health credential proves service identity; it never grants VM access in session mode.
  router.get("/installation", (req, res) => {
    if (!isAuthorizedRequest(req)) return res.sendStatus(401);
    return res.json({ service: "utm-web", ready: true });
  });
  router.get("/status", (req, res) => {
    if (!auth) return res.json({ mode: "api-key" });
    const session = auth.session(req);
    return res.json({ mode: "session", setupRequired: !auth.configured,
      authenticated: Boolean(session), username: session?.username, csrf: session?.csrf });
  });
  router.post("/:action", async (req, res) => {
    if (!auth) return res.status(404).json({ error: { message: "Session authentication is disabled." } });
    try {
      if (req.params.action === "setup") {
        await auth.setup(req.body?.username, req.body?.password, req.body?.setupCode);
        return res.status(201).json({ ok: true });
      }
      if (req.params.action === "login") {
        const { token, session } = await auth.login(req.body?.username, req.body?.password);
        res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/",
          maxAge: SESSION_TTL_MS, secure: req.secure });
        return res.json({ username: session.username, csrf: session.csrf });
      }
      if (req.params.action === "logout") {
        const session = auth.session(req);
        if (!session) return res.status(401).json({ error: { message: "Please log in." } });
        if (req.get("X-UTM-CSRF") !== session.csrf)
          return res.status(403).json({ error: { message: "Invalid session request." } });
        auth.logout(session);
        res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", path: "/", secure: req.secure });
        return res.json({ ok: true });
      }
      return res.sendStatus(404);
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.status === 429) res.set("Retry-After", "60");
        return res.status(error.status).json({ error: { message: error.message } });
      }
      return res.status(500).json({ error: { message: "Authentication is temporarily unavailable." } });
    }
  });
  return router;
};
