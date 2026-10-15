import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

const selectedPort = (name) => {
  const value = process.env[name];
  if (value === undefined) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${name} must be a TCP port from 1 to 65535`);
  return port;
};

const availablePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const run = (command, args, env, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, cwd, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`${command} ended with ${signal}`));
    else resolve(code ?? 1);
  });
});

const buildWeb = (env) => run(process.execPath,
  ["../../node_modules/next/dist/bin/next", "build"], env, "apps/web");

const webPort = selectedPort("BROWSER_WEB_PORT") ?? await availablePort();
let apiPort = selectedPort("BROWSER_API_PORT") ?? await availablePort();
while (apiPort === webPort && !process.env.BROWSER_API_PORT) apiPort = await availablePort();
if (webPort === apiPort) throw new Error("Browser web and API ports must differ");

const env = {
  ...process.env,
  BROWSER_WEB_PORT: String(webPort),
  BROWSER_API_PORT: String(apiPort),
  NEXT_PUBLIC_API_HOST: `http://127.0.0.1:${apiPort}`,
};
console.log(`Browser acceptance: web 127.0.0.1:${webPort}, fake API 127.0.0.1:${apiPort}`);

const build = await buildWeb(env);
if (build !== 0) process.exit(build);
const legacy = await run(process.execPath, ["--test", "tests/browser/acceptance.test.mjs"], env);
if (legacy !== 0) process.exit(legacy);

if (existsSync("apps/api/src/productionRuntime.ts")) {
  const apiBuild = await run("npm", ["run", "build", "--workspace=api"], env);
  if (apiBuild !== 0) process.exit(apiBuild);
  const oneOriginEnv = { ...env, NEXT_PUBLIC_API_HOST: "" };
  const webBuild = await buildWeb(oneOriginEnv);
  if (webBuild !== 0) process.exit(webBuild);
  process.exitCode = await run(process.execPath, ["--test", "tests/browser/one-origin.test.mjs"], oneOriginEnv);
} else {
  console.log("Production one-origin suite awaits the runtime branch.");
}
