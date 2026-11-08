import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
process.env.BROWSER_WEB_PORT ||= "3108";
const port = Number(process.env.BROWSER_WEB_PORT);
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const { Browser, until } = await import("./cdp.mjs");
const exportRoot = `${root}/apps/web/out`;
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith("/utm-webapp/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const relative = pathname.slice("/utm-webapp/".length);
    const file = resolve(
      exportRoot,
      relative + (pathname.endsWith("/") ? "index.html" : ""),
    );
    if (!file.startsWith(exportRoot + "/")) throw Error("Invalid path");
    const mime =
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      }[extname(file)] || "application/octet-stream";
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": mime });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const browser = new Browser();
const output = `${root}/notes/ui-reference/web`;
const clickText = async (text) =>
  browser.evaluate(
    `(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click()})()`,
  );
const screenshot = async (name) => {
  await new Promise((r) => setTimeout(r, 250));
  const result = await browser.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(`${output}/${name}.png`, Buffer.from(result.data, "base64"));
};
try {
  await mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  if (process.argv.includes("--serve")) {
    console.log(`UTM UI preview: http://127.0.0.1:${port}/utm-webapp/`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    process.exitCode = 0;
  } else {
    await browser.start();
    await browser.send("Network.enable");
    browser.socket.addEventListener("message", (event) => {
      const m = JSON.parse(event.data);
      if (
        m.method === "Runtime.exceptionThrown" ||
        m.method === "Network.loadingFailed" ||
        m.method === "Runtime.consoleAPICalled"
      )
        console.log(m.method, JSON.stringify(m.params));
      if (
        m.method === "Network.responseReceived" &&
        m.params.response.status >= 400 &&
        !m.params.response.url.endsWith("/favicon.ico")
      )
        console.log("HTTP", m.params.response.status, m.params.response.url);
    });
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await browser.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await browser.navigate("/utm-webapp/");
    await until(() => browser.exists(".vm-row-main"), "demo inventory");
    await until(
      () =>
        browser.evaluate(
          '[...document.querySelectorAll(".vm-icon img, .app-icon img")].every(i=>i.complete&&i.naturalWidth>0)',
        ),
      "native icons loaded under Pages base path",
    );
    await screenshot("01-welcome-dark");
    await browser.click('.vm-row-main[title="Debian 12 Template"]');
    await until(
      async () => (await browser.text(".vm-spec")).includes("2 GB"),
      "detail readback",
    );
    await screenshot("02-library-dark");
    await clickText("Settings");
    await until(() => browser.exists("[role=dialog]"), "settings sheet");
    assert.equal(
      await browser.evaluate(
        'document.activeElement === document.querySelector("[role=dialog] input")',
      ),
      true,
    );
    await screenshot("03-settings-information-dark");
    await clickText("System");
    assert.equal(
      await browser.evaluate(
        `document.querySelector('input[min="128"]').getBoundingClientRect().width>0`,
      ),
      true,
    );
    await screenshot("04-settings-system-dark");
    await browser.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await until(
      async () => !(await browser.exists("[role=dialog]")),
      "Escape closes sheet",
    );
    assert.equal(
      await browser.evaluate("document.activeElement.title"),
      "Settings",
    );
    await clickText("Clone");
    await screenshot("05-clone-dark");
    await clickText("Cancel");
    await clickText("Delete");
    assert.equal(
      await browser.evaluate(
        'document.querySelector("[role=dialog] button[type=submit]").disabled',
      ),
      true,
    );
    await browser.fill("[role=dialog] input", "Debian 12 Template");
    assert.equal(
      await browser.evaluate(
        'document.querySelector("[role=dialog] button[type=submit]").disabled',
      ),
      false,
    );
    await screenshot("06-delete-dark");
    await clickText("Cancel");
    await browser.click(".sidebar-toggle");
    assert.equal(
      await browser.evaluate('document.querySelector(".sidebar").hidden'),
      true,
    );
    await browser.click(".sidebar-toggle");
    await clickText("Serial");
    await screenshot("07-serial-stopped-dark");
    await clickText("Details");
    await browser.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await screenshot("08-library-light");
    await clickText("Settings");
    await screenshot("09-settings-light");
    await clickText("Cancel");
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await screenshot("10-mobile-light");
    assert.equal(
      await browser.evaluate("document.documentElement.scrollWidth<=390"),
      true,
    );
    await browser.click(".sidebar-toggle");
    await screenshot("11-mobile-sidebar-light");
    await browser.click('.vm-row-main[title="Windows 11 ARM"]');
    await until(
      async () => (await browser.text(".vm-spec")).includes("8 GB"),
      "mobile detail",
    );
    await clickText("Settings");
    await clickText("System");
    await screenshot("12-mobile-settings-light");
    assert.equal(
      await browser.evaluate(
        'document.querySelector("[role=dialog]").getBoundingClientRect().right<=390',
      ),
      true,
    );
    console.log(
      "Preview checks passed: desktop/mobile, light/dark, native icon loading, sidebar collapse, settings navigation, Escape/focus restore, exact delete confirmation.",
    );
  }
} catch (error) {
  console.log(
    await browser
      .evaluate(
        "JSON.stringify({url:location.href,body:document.body.innerText,assets:[...document.scripts].map(s=>s.src)})",
      )
      .catch(() => "No document"),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
