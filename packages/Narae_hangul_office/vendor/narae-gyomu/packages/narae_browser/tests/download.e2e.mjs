import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { BrowserEngine } from "../src/browser.mjs";
test("observed attachment downloads compare actual server bytes and cannot overwrite a local source", async () => {
  const payload = Buffer.from("Synthetic attachment bytes.\n"),
    hash = createHash("sha256").update(payload).digest("hex"),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "narae-download-")),
    dest = path.join(dir, "server-copy.txt");
  const server = http.createServer((q, r) => {
    if (q.url === "/file") {
      r.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="synthetic.txt"',
      });
      r.end(payload);
    } else {
      r.setHeader("content-type", "text/html;charset=utf-8");
      r.end('<a href="/file">첨부파일 다운로드</a>');
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = new BrowserEngine();
  try {
    await b.start({ connection: "isolated" });
    let s = await b.execute({
      action: "open",
      url: "http://127.0.0.1:" + server.address().port,
    });
    const result = await b.execute({
      action: "download",
      ref: s.elements[0].ref,
      path: dest,
      expectedSha256: hash,
    });
    assert(result.verified);
    assert.deepEqual(fs.readFileSync(dest), payload);
    s = await b.snapshot();
    await assert.rejects(
      b.execute({
        action: "download",
        ref: s.elements[0].ref,
        path: dest,
        expectedSha256: hash,
      }),
      (e) => e.code === "NEW_DOWNLOAD_PATH_REQUIRED",
    );
  } finally {
    await b.browser?.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
