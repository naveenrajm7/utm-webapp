import { json, urlencoded } from "body-parser";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import morgan from "morgan";
import cors from "cors";
import { isAuthorizedRequest, requireApiKey } from "./auth";
import routes from "./routes";
import { createV1Router } from "./v1/routes";
import type { ApiPorts } from "./v1/ports";

export const createServer = (ports: Partial<ApiPorts> = {}): Express => {
  const app = express();
  app
    .disable("x-powered-by")
    .use(morgan("dev"))
    .use(cors())
    .use("/v1", (req, res, next) => {
      if (!isAuthorizedRequest(req)) {
        return res
          .status(401)
          .json({ error: { code: "unauthorized", message: "Unauthorized" } });
      }
      return next();
    })
    .use(urlencoded({ extended: true }))
    .use(json())
    .use((error: unknown, req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/v1/") || req.path === "/v1") {
        return res
          .status(400)
          .json({
            error: { code: "invalid_input", message: "Invalid request body" },
          });
      }
      return next(error);
    })
    .get("/status", (_, res) => {
      return res.json({ ok: true });
    })
    .use("/v1", createV1Router(ports))
    .use(requireApiKey)
    .get("/message/:name", (req, res) => {
      return res.json({ message: `hello ${req.params.name}` });
    })
    .use(routes);

  return app;
};
