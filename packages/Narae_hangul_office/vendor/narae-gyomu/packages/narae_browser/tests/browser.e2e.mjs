import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../bin/narae-browser.mjs", import.meta.url));
test("real isolated Chrome through separate CLI processes and private daemon", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "narae-browser-e2e-")),
    env = { ...process.env, NARAE_BROWSER_HOME: temp };
  let page;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
    res.end(
      '<!doctype html><html lang="ko"><title>나래 CLI fixture</title><main><h1>브라우저 회귀</h1><label>이름<input id="name"></label><label>비밀번호<input type="password" value="private-canary"></label><button onclick="document.querySelector(\'#result\').textContent=\'안녕하세요 \'+document.querySelector(\'#name\').value">인사 실행</button><select aria-label="반"><option value="a">가반</option><option value="b">나반</option></select><p id="result">아직 실행 안 함</p><a href="/next">다음 페이지</a></main></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const run = (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, ...args, "--session", "fixture"],
        { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          const lines = out
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((x) => JSON.parse(x));
          resolve({ code, result: lines[0], lines, stderr: err });
        } catch (e) {
          reject(new Error(out + " " + err + " " + e));
        }
      });
      child.stdin.end(input || "");
    });
  try {
    await t.test(
      "doctor and actual navigation; input passwords are not dumped",
      async () => {
        assert.equal((await run(["doctor"])).code, 0);
        const r = await run(["open", url, "--limit", "100"]);
        assert.equal(r.code, 0);
        assert.equal(r.result.data.status, 200);
        page = r.result.data;
        assert.equal(page.title, "나래 CLI fixture");
        assert(!JSON.stringify(page).includes("private-canary"));
      },
    );
    await t.test(
      "fill across CLI invocations, stale refs fail, real button mutates DOM",
      async () => {
        const old = page.elements.find((x) => x.label === "인사 실행").ref;
        const ref = page.elements.find((x) => x.label === "이름").ref;
        assert.equal(
          (await run(["fill", ref, "인호"])).result.data.filled,
          true,
        );
        const stale = await run(["click", old]);
        assert.equal(stale.code, 1);
        assert.equal(stale.result.error.code, "STALE_REF");
        page = (await run(["snapshot", "--limit", "100"])).result.data;
        assert.equal(
          (
            await run([
              "click",
              page.elements.find((x) => x.label === "인사 실행").ref,
            ])
          ).code,
          0,
        );
        const result = await run(["read", "--selector", "#result"]);
        assert.equal(result.result.data.text, "안녕하세요 인호");
        const missing = await run(["read", "--selector", "#missing"]);
        assert.equal(missing.code, 1);
        assert.equal(missing.result.ok, false);
        assert.equal(missing.result.error.code, "SELECTOR_NOT_FOUND");
        const stream = await run(
          ["serve"],
          JSON.stringify({ action: "read", selector: "#missing" }) + "\n",
        );
        assert.equal(stream.result.ok, false);
        assert.equal(stream.result.error.code, "SELECTOR_NOT_FOUND");
      },
    );
    await t.test(
      "select, key, screenshot and explicit output file are exercised",
      async () => {
        page = (await run(["snapshot", "--limit", "100"])).result.data;
        assert.deepEqual(
          (
            await run([
              "select",
              page.elements.find((x) => x.label === "반").ref,
              "b",
            ])
          ).result.data.selected,
          ["b"],
        );
        assert.equal((await run(["press", "Tab"])).code, 0);
        const png = path.join(temp, "shot.png");
        assert.equal((await run(["screenshot", png])).code, 0);
        assert(fs.statSync(png).size > 1000);
        const out = path.join(temp, "read.json");
        assert.equal(
          (await run(["read", "--chars", "100", "--output", out])).code,
          0,
        );
        assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).ok, true);
      },
    );
    await t.test(
      "unauthorized HTTP and browser-origin requests cannot control daemon",
      async () => {
        const state = JSON.parse(
          fs.readFileSync(path.join(temp, "fixture", "daemon.json"), "utf8"),
        );
        const api = "http://127.0.0.1:" + state.port + "/command";
        assert.equal(
          (
            await fetch(api, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: '{"action":"tabs"}',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(api, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: "Bearer " + state.token,
                origin: "https://evil.test",
              },
              body: '{"action":"tabs"}',
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "JSON jobs and streaming JSONL preserve structured observations",
      async () => {
        const batch = await run(
          ["run", "-"],
          JSON.stringify({
            steps: [
              { action: "snapshot" },
              { action: "read", selector: "#result" },
            ],
          }),
        );
        assert.equal(batch.result.data.completed.length, 2);
        const stream = await run(
          ["serve"],
          '{"action":"tabs"}\n{"action":"read","selector":"#result"}\n',
        );
        assert.equal(stream.lines.length, 2);
        assert(stream.lines.every((x) => x.ok));
        assert.equal(stream.lines[1].data.text, "안녕하세요 인호");
      },
    );
    await t.test(
      "read-only host policy blocks edits and unauthorized navigation, permits approved link",
      async () => {
        const policy = await run(
          ["run", "-"],
          JSON.stringify({ action: "policy", hosts: ["127.0.0.1"] }),
        );
        assert.equal(policy.code, 0);
        page = (await run(["snapshot", "--limit", "100"])).result.data;
        assert.equal(
          (
            await run([
              "fill",
              page.elements.find((x) => x.label === "이름").ref,
              "차단",
            ])
          ).result.error.code,
          "READ_ONLY",
        );
        assert.equal(
          (await run(["open", "https://example.com"])).result.error.code,
          "HOST_DENIED",
        );
        assert.equal(
          (
            await run([
              "click",
              page.elements.find((x) => x.label === "다음 페이지").ref,
            ])
          ).code,
          0,
        );
        assert((await run(["tabs"])).result.data.tabs[0].url.endsWith("/next"));
      },
    );
    await t.test(
      "invalid commands fail as JSON with nonzero exit, without eval capability",
      async () => {
        assert.equal(
          (await run(["eval", "1+1"])).result.error.code,
          "UNKNOWN_ACTION",
        );
        assert.equal(
          (await run(["run", "-"], "not-json")).result.error.code,
          "INVALID_JSON",
        );
        assert.equal(
          (await run(["snapshot", "--chars", "999999"])).result.error.code,
          "INVALID_ARGUMENT",
        );
      },
    );
  } finally {
    await run(["close"]);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
