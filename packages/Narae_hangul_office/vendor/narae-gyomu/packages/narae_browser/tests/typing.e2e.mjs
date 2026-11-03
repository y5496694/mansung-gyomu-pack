import test from "node:test";
import assert from "node:assert/strict";
import { BrowserEngine } from "../src/browser.mjs";
test("native typing commits a component whose model ignores DOM-only fill", async () => {
  const b = new BrowserEngine();
  try {
    await b.start({ connection: "isolated" });
    await b.page.setContent(
      '<input aria-label="제목" onkeydown="if(event.key!==String.fromCharCode(84,97,98))this.dirty=true" onblur="if(this.dirty)window.modelTitle=this.value"><button>다음</button><script>window.modelTitle=""</script>',
    );
    let s = await b.snapshot();
    await b.execute({
      action: "fill",
      ref: s.elements[0].ref,
      text: "합성 제목",
    });
    s = await b.snapshot();
    await b.execute({ action: "press", ref: s.elements[0].ref, key: "Tab" });
    assert.equal(await b.page.evaluate(() => window.modelTitle), "");
    s = await b.snapshot();
    await b.execute({
      action: "type",
      ref: s.elements[0].ref,
      text: "합성 제목",
    });
    s = await b.snapshot();
    await b.execute({ action: "press", ref: s.elements[0].ref, key: "Tab" });
    assert.equal(await b.page.evaluate(() => window.modelTitle), "합성 제목");
  } finally {
    await b.browser?.close();
  }
});
test("a single-line input rejects Enter before editing or submitting", async () => {
  const b = new BrowserEngine();
  try {
    await b.start({ connection: "isolated" });
    await b.page.setContent(
      '<form onsubmit="window.submitted=true;return false"><input value="original"><button>저장</button></form>',
    );
    const s = await b.snapshot();
    await assert.rejects(
      b.execute({ action: "type", ref: s.elements[0].ref, text: "one\ntwo" }),
      (e) => e.code === "MULTILINE_CONTROL_REQUIRED",
    );
    assert.equal(await b.page.locator("input").inputValue(), "original");
    assert.notEqual(await b.page.evaluate(() => window.submitted), true);
  } finally {
    await b.browser?.close();
  }
});
