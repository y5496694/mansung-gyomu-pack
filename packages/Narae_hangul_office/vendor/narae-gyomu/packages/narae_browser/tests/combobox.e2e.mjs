import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { BrowserEngine } from "../src/browser.mjs";
test("an observed Nexacro-style combo opens its unique visible decorative toggle and keeps read-only restrictions", async () => {
  assert.notEqual(process.env.NARAE_TEST_EXTENSION, "1");
  const server = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html;charset=utf-8");
    r.end(
      `<div role="combobox" aria-label="업무구분"><input readonly value="업무관리"><div id="job.dropbutton" aria-hidden="true" style="display:inline-block;width:24px;height:24px" onclick="document.getElementById('options').hidden=false">+</div><input type="password" value="PRIVATE-CANARY"></div><div id="options" hidden role="listbox"><div role="option">학교회계</div></div><button>일반 버튼</button>`,
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const engine = new BrowserEngine();
  try {
    await engine.start({ connection: "isolated" });
    let s = await engine.execute({
      action: "open",
      url: "http://127.0.0.1:" + server.address().port,
    });
    const combo = s.elements.find((e) => e.role === "combobox"),
      inspection = await engine.execute({ action: "inspect", ref: combo.ref });
    assert(
      inspection.controls.some(
        (e) =>
          e.id === "job.dropbutton" && e.visible && e.ariaHidden === "true",
      ),
    );
    assert(!JSON.stringify(inspection).includes("PRIVATE-CANARY"));
    s = await engine.execute({
      action: "click",
      ref: combo.ref,
      part: "toggle",
    });
    assert(s.elements.some((e) => e.label === "학교회계"));
    const button = s.elements.find((e) => e.label === "일반 버튼");
    await assert.rejects(
      engine.execute({ action: "click", ref: button.ref, part: "toggle" }),
      { code: "COMBOBOX_REQUIRED" },
    );
    const current = s.elements.find((e) => e.role === "combobox");
    await assert.rejects(
      engine.execute({
        action: "click",
        ref: current.ref,
        part: "toggle",
        method: "dom",
      }),
      { code: "COMBOBOX_REQUIRED" },
    );
    engine.policy = { hosts: ["127.0.0.1"] };
    await assert.rejects(
      engine.execute({ action: "click", ref: current.ref, part: "toggle" }),
      { code: "READ_ONLY" },
    );
  } finally {
    await engine.execute({ action: "close" });
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
