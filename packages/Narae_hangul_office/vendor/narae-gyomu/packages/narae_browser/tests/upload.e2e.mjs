import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BrowserEngine } from "../src/browser.mjs";
test("native file chooser selects explicit bytes, rejects read-only uploads and reports selection without server success", async () => {
  assert.notEqual(process.env.NARAE_TEST_EXTENSION, "1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "narae-upload-")),
    file = path.join(dir, "synthetic.txt"),
    b = new BrowserEngine();
  fs.writeFileSync(file, "Synthetic attachment only.");
  try {
    await b.start({ connection: "isolated" });
    await b.page.setContent(
      '<button onclick="document.getElementById(\'f\').click()">파일추가</button><input id="f" type="file" hidden><p id="result"></p><script>f.onchange=()=>result.textContent=f.files[0].name</script>',
    );
    let s = await b.snapshot();
    const r = await b.execute({
      action: "upload",
      ref: s.elements[0].ref,
      files: [file],
    });
    assert(r.selected);
    assert.equal(r.serverVerified, false);
    assert.equal(r.files[0].bytes, 26);
    assert.equal(r.files[0].sha256.length, 64);
    assert.equal(
      await b.page.locator("#result").textContent(),
      "synthetic.txt",
    );
    b.policy = { hosts: ["example.invalid"] };
    s = await b.snapshot();
    await assert.rejects(
      b.execute({ action: "upload", ref: s.elements[0].ref, files: [file] }),
      (e) => e.code === "READ_ONLY",
    );
  } finally {
    await b.browser?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
