import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BrowserEngine, Fault, sessionRoot } from "./browser.mjs";
const entry = fileURLToPath(import.meta.url);
export function sessionPaths(session = "default") {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(session))
    throw new Fault("INVALID_SESSION", "Use 1..48 letters, digits, - or _");
  const dir = path.join(sessionRoot(), session);
  return {
    dir,
    state: path.join(dir, "daemon.json"),
    lock: path.join(dir, "start.lock"),
  };
}
function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
export async function rpc(state, command) {
  const r = await fetch(`http://127.0.0.1:${state.port}/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(45000),
  });
  const result = await r.json();
  if (!result.ok)
    throw new Fault(
      result.error?.code || "DAEMON_ERROR",
      result.error?.message || "Browser command failed",
    );
  return result.data;
}
export async function connect(session = "default", options = {}) {
  const p = sessionPaths(session);
  fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  let state = readState(p.state);
  if (state) {
    try {
      await rpc(state, { action: "tabs" });
      return state;
    } catch (e) {
      if (e.code && !["DAEMON_ERROR"].includes(e.code)) throw e;
    }
  }
  let lock;
  try {
    lock = fs.openSync(p.lock, "wx", 0o600);
    fs.writeFileSync(lock, String(process.pid));
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      const pid = Number(fs.readFileSync(p.lock, "utf8"));
      process.kill(pid, 0);
    } catch {
      fs.rmSync(p.lock, { force: true });
      return connect(session, options);
    }
  }
  if (lock !== undefined) {
    fs.rmSync(path.join(p.dir, "failure.json"), { force: true });
    const child = spawn(
      process.execPath,
      [entry, "--daemon", session, ...(options.headed ? ["--headed"] : [])],
      { detached: true, stdio: "ignore", windowsHide: true, env: process.env },
    );
    child.unref();
  }
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      state = readState(p.state);
      if (state) {
        try {
          await rpc(state, { action: "tabs" });
          return state;
        } catch {}
      }
      const failure = readState(path.join(p.dir, "failure.json"));
      if (failure)
        throw new Fault(failure.code || "START_FAILED", failure.message);
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Fault(
      "START_TIMEOUT",
      "Browser daemon did not become ready. Run doctor.",
    );
  } finally {
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.rmSync(p.lock, { force: true });
    }
  }
}
export async function command(session, input, options = {}) {
  if (input.action === "close") {
    const p = sessionPaths(session),
      s = readState(p.state);
    if (!s) return { closed: true, alreadyStopped: true };
    try {
      return await rpc(s, input);
    } catch (e) {
      if (e.code) throw e;
      fs.rmSync(p.state, { force: true });
      return { closed: true, alreadyStopped: true };
    }
  }
  return rpc(await connect(session, options), input);
}
async function daemon(session) {
  const paths = sessionPaths(session);
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const failure = path.join(paths.dir, "failure.json");
  fs.rmSync(failure, { force: true });
  const engine = new BrowserEngine();
  let server,
    timer,
    closing = false;
  const token = crypto.randomBytes(32).toString("hex");
  let queue = Promise.resolve();
  async function stop() {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    if (server) {
      server.close();
      server.closeIdleConnections();
    }
    await engine.browser?.close().catch(() => {});
    if (readState(paths.state)?.token === token)
      fs.rmSync(paths.state, { force: true });
  }
  function touch() {
    clearTimeout(timer);
    timer = setTimeout(() => void stop(), 300000);
    timer.unref();
  }
  try {
    await engine.start({ headed: process.argv.includes("--headed") });
    server = http.createServer(async (req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      const reply = (status, body) => {
        res.writeHead(status);
        res.end(JSON.stringify(body));
      };
      if (req.url !== "/command" || req.method !== "POST")
        return reply(404, { ok: false, error: { code: "NOT_FOUND" } });
      if (req.headers.origin || req.headers.authorization !== `Bearer ${token}`)
        return reply(403, {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Private local session token required",
          },
        });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return reply(415, { ok: false, error: { code: "JSON_REQUIRED" } });
      let size = 0,
        chunks = [];
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 256000)
            throw new Fault("REQUEST_TOO_LARGE", "Maximum 256KB");
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        touch();
        const run = () => engine.execute(input);
        const result = queue.then(run, run);
        queue = result.catch(() => {});
        const data = await result;
        reply(200, { ok: true, data });
        if (input.action === "close") setImmediate(() => void stop());
      } catch (e) {
        reply(400, {
          ok: false,
          error: {
            code: e.code || "COMMAND_FAILED",
            message: String(e.message).slice(0, 500),
          },
        });
      }
    });
    server.requestTimeout = 50000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    fs.writeFileSync(
      paths.state,
      JSON.stringify({
        pid: process.pid,
        port: server.address().port,
        token,
        version: 1,
      }),
      { mode: 0o600 },
    );
    touch();
    process.on("SIGTERM", () => void stop());
    process.on("SIGINT", () => void stop());
    engine.browser.on("disconnected", () => void stop());
  } catch (e) {
    fs.writeFileSync(
      failure,
      JSON.stringify({
        code: e.code || "START_FAILED",
        message: String(e.message).slice(0, 300),
      }),
      { mode: 0o600 },
    );
    await stop();
    process.exitCode = 1;
  }
}
if (process.argv[1] === entry && process.argv[2] === "--daemon")
  await daemon(process.argv[3]);
