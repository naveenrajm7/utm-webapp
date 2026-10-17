import path from "node:path";
import { createRequire } from "node:module";
import type { RequestListener } from "node:http";
import type nextFactory from "next";
import { createLocalRuntime, type InjectableAdapter } from "./localRuntime";

export interface ProductionRuntimeOptions {
  /** Inject a web handler for fake backed acceptance without starting Next. */
  webHandler?: RequestListener;
  webDirectory?: string;
}

/** Next owns its build assets and dynamic console pages on the same HTTP listener. */
export const createProductionRuntime = async (
  adapter: InjectableAdapter,
  options: ProductionRuntimeOptions = {},
) => {
  const webDirectory = options.webDirectory || path.resolve(__dirname, "../../web");
  let webHandler = options.webHandler;
  if (!webHandler) {
    // Resolve Next from the web workspace, which owns the Next dependency.
    const webRequire = createRequire(path.join(webDirectory, "package.json"));
    const next = webRequire("next") as typeof nextFactory;
    const application = next({ dev: false, dir: webDirectory });
    await application.prepare();
    webHandler = application.getRequestHandler();
    const server = createLocalRuntime(adapter, { webHandler, singleOrigin: true });
    server.on("close", () => { void application.close(); });
    return server;
  }
  return createLocalRuntime(adapter, { webHandler, singleOrigin: true });
};
