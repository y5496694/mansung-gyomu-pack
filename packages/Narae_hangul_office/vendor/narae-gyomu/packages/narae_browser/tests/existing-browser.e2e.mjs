import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { BrowserEngine, browserPath } from "../src/browser.mjs";
import { localCDPEndpoint } from "../src/existing-browser.mjs";

test("CDP setup accepts only local endpoints without embedded secrets", () => {
  for (const endpoint of [
    "https://example.com",
    "http://example.com:9222",
    "http://user:password@127.0.0.1:9222",
    "http://127.0.0.1:9222/?token=secret",
    "file:///tmp/a",
  ])
    assert.throws(() => localCDPEndpoint(endpoint), {
      code: "INVALID_CDP_ENDPOINT",
    });
  assert.equal(
    localCDPEndpoint("http://127.0.0.1:9222"),
    "http://127.0.0.1:9222/",
  );
});

test("attach edits an already open tab, retains its login state and disconnects without closing user Chrome", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<title>합성 기존 탭 ${req.url}</title><label>내용<input></label><button onclick="document.querySelector('output').textContent=document.querySelector('input').value">반영</button><output></output>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const portServer = http.createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  let owner, engine;
  try {
    owner = await chromium.launch({
      executablePath: browserPath(),
      headless: true,
      args: [`--remote-debugging-port=${port}`],
    });
    const context = await owner.newContext(),
      first = await context.newPage();
    const url = `http://127.0.0.1:${server.address().port}`;
    await context.addCookies([
      { name: "synthetic_login", value: "retained", url },
    ]);
    await first.goto(url + "/one");
    // CDP exposes a persistent default context; use its already-open target.
    const defaultBrowser = await chromium.connectOverCDP(
      `http://127.0.0.1:${port}`,
      { noDefaults: true },
    );
    const defaultContext = defaultBrowser.contexts()[0],
      userPage = await defaultContext.newPage();
    await defaultContext.addCookies([
      { name: "synthetic_login", value: "retained", url },
    ]);
    await userPage.goto(url + "/existing");
    const before = defaultContext.pages().length;
    engine = new BrowserEngine();
    const attached = await engine.start({
      connection: "cdp",
      endpoint: `http://127.0.0.1:${port}`,
    });
    assert.equal(attached.attached, true);
    assert.equal(defaultContext.pages().length, before);
    const target = attached.tabs.find((tab) => tab.url.endsWith("/existing"));
    let snapshot = await engine.execute({ action: "tab", index: target.index });
    await engine.execute({
      action: "fill",
      ref: snapshot.elements.find((e) => e.label === "내용").ref,
      text: "기존 탭 수정 확인",
    });
    snapshot = await engine.execute({ action: "snapshot" });
    await engine.execute({
      action: "click",
      ref: snapshot.elements.find((e) => e.label === "반영").ref,
    });
    assert.equal(
      await userPage.locator("output").textContent(),
      "기존 탭 수정 확인",
    );
    const result = await engine.execute({ action: "close" });
    assert.equal(result.userBrowserPreserved, true);
    assert.equal(owner.isConnected(), true);
    assert.equal(userPage.isClosed(), false);
    assert.equal(defaultContext.pages().length, before);
    assert(
      (await defaultContext.cookies(url)).some(
        (cookie) =>
          cookie.name === "synthetic_login" && cookie.value === "retained",
      ),
    );
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "narae-attach-cli-"));
    const cli = fileURLToPath(
      new URL("../bin/narae-browser.mjs", import.meta.url),
    );
    const run = async (args) =>
      JSON.parse(
        (
          await promisify(execFile)(
            process.execPath,
            [cli, ...args, "--session", "existing"],
            {
              env: { ...process.env, NARAE_BROWSER_HOME: home },
              windowsHide: true,
            },
          )
        ).stdout,
      );
    try {
      const connected = await run([
        "attach",
        "--connection",
        "cdp",
        "--cdp-endpoint",
        `http://127.0.0.1:${port}`,
      ]);
      assert.equal(connected.data.attached, true);
      assert(connected.data.tabs.some((tab) => tab.url.endsWith("/existing")));
      assert.equal((await run(["close"])).data.userBrowserPreserved, true);
      assert.equal(userPage.isClosed(), false);
    } finally {
      await run(["close"]).catch(() => {});
      fs.rmSync(home, { recursive: true, force: true });
    }
    await defaultBrowser.close();
  } finally {
    await engine?.browser?.close().catch(() => {});
    await owner?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
