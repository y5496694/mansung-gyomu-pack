import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { BrowserEngine } from "../src/browser.mjs";

test("bounded form inspection redacts credentials and DOM submit is never repeated", async () => {
  assert.notEqual(process.env.NARAE_TEST_EXTENSION, "1");
  let posts = 0;
  const server = http.createServer((req, res) => {
    if (req.method === "POST") posts++;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<main>Posts: ${posts}<form method="post"><input name="documentId" type="hidden" value="synthetic-record"><input name="other" id="access_token" type="hidden" value="hidden-canary"><input name="password" type="password" value="password-canary"><input name="sessionId" type="hidden" value="session-canary"><button type="button" onclick="this.form.submit()">Submit once</button></form></main>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const engine = new BrowserEngine();
  try {
    await engine.start({ connection: "isolated" });
    await engine.execute({
      action: "open",
      url: `http://127.0.0.1:${server.address().port}`,
    });
    const form = await engine.execute({ action: "snapshot", selector: "form" });
    const inspection = await engine.execute({
      action: "inspect",
      ref: form.elements[0].ref,
    });
    assert.equal(
      inspection.fields.find((field) => field.name === "documentId").value,
      "synthetic-record",
    );
    for (const canary of ["hidden-canary", "password-canary", "session-canary"])
      assert(!JSON.stringify(inspection).includes(canary));
    assert.equal(
      inspection.fields.filter((field) => field.value === "[redacted]").length,
      3,
    );
    const page = await engine.execute({ action: "snapshot" });
    await assert.rejects(
      () => engine.execute({ action: "inspect", ref: form.elements[0].ref }),
      { code: "STALE_REF" },
    );
    const button = page.elements.find(
      (element) => element.label === "Submit once",
    );
    const attributes = await engine.execute({
      action: "inspect",
      ref: button.ref,
    });
    assert.equal(attributes.attributes.onclick, "this.form.submit()");
    await engine.execute({ action: "click", ref: button.ref, method: "dom" });
    await engine.page.waitForLoadState("domcontentloaded");
    assert.equal(posts, 1);
    assert.match((await engine.execute({ action: "read" })).text, /Posts: 1/);
    engine.policy = { hosts: ["127.0.0.1"] };
    await assert.rejects(
      () => engine.execute({ action: "inspect", ref: button.ref }),
      { code: "READ_ONLY" },
    );
  } finally {
    await engine.execute({ action: "close" });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
