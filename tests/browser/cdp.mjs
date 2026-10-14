import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

export class Browser {
  async start() {
    this.profile = await mkdtemp(join(tmpdir(), "utm-browser-acceptance-"));
    this.process = spawn(CHROME, [
      "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
      "--remote-debugging-port=0", `--user-data-dir=${this.profile}`, "about:blank",
    ], { stdio: "ignore" });
    const active = await until(async () => {
      const text = await readFile(join(this.profile, "DevToolsActivePort"), "utf8");
      return text.split("\n")[0];
    }, "Chrome DevTools port");
    const targets = await (await fetch(`http://127.0.0.1:${active}/json/list`)).json();
    const target = targets.find((item) => item.type === "page");
    if (!target) throw new Error("Chrome did not open a page target");
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.sequence = 0;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text + ": " + (result.result?.description || ""));
    return result.result?.value;
  }

  async navigate(path = "/") {
    await this.send("Page.navigate", { url: `http://localhost:3000${path}` });
    await until(() => this.evaluate("document.readyState === 'complete'"), "page load");
  }

  async click(selector) {
    const expression = `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing ${selector}'); node.click(); return true; })()`;
    await this.evaluate(expression);
  }

  async fill(selector, value) {
    await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error('Missing ${selector}');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }

  text(selector) {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent || ''`);
  }

  exists(selector) {
    return this.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  }

  async close() {
    this.socket?.close();
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      const exited = new Promise((resolve) => this.process.once("exit", resolve));
      this.process.kill("SIGTERM");
      await Promise.race([exited, delay(5000)]);
      if (this.process.exitCode === null && this.process.signalCode === null) {
        this.process.kill("SIGKILL");
        await exited;
      }
    }
    if (this.profile) await rm(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
