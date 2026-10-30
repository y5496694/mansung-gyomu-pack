import test from "node:test";
import assert from "node:assert/strict";
import { webUrl, bound, BrowserEngine } from "../src/browser.mjs";
import { parseJson, validateSummary, ModelClient } from "../src/model.mjs";
import {
  actionFromArgs,
  newsLinks,
  validateAgentAction,
} from "../src/protocol.mjs";
test("only credential-free HTTP URLs and exact authorized hosts", () => {
  assert.equal(
    webUrl("https://news.naver.com/section/105", ["news.naver.com"]),
    "https://news.naver.com/section/105",
  );
  for (const u of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pw@example.com",
    "https://news.naver.com.evil.test/",
  ])
    assert.throws(() => webUrl(u, ["news.naver.com"]));
});
test("bounded numeric inputs reject negative/NaN/unbounded/fractional limits", () => {
  assert.equal(bound(undefined, 1, 100, 35), 35);
  for (const x of [0, 101, "bad", Infinity, 1.2])
    assert.throws(() => bound(x, 1, 100, 35));
});

test("missing read selector fails instead of returning a successful empty body", async () => {
  const engine = new BrowserEngine();
  engine.page = {
    evaluate: async () => ({ text: "", error: "SELECTOR_NOT_FOUND" }),
  };
  await assert.rejects(() => engine.read({ selector: "#missing" }), {
    code: "SELECTOR_NOT_FOUND",
  });
  engine.page.evaluate = async () => ({ text: "", totalChars: 0, offset: 0 });
  assert.equal((await engine.read()).totalChars, 0);
});
test("small-model JSON accepts plain/fenced objects and rejects fake JS/arrays", () => {
  assert.deepEqual(parseJson('```json\n{"action":"read"}\n```'), {
    action: "read",
  });
  assert.deepEqual(parseJson('<think>reason</think>{"action":"read"}'), {
    action: "read",
  });
  for (const t of ["not json", "[1,2]", "process.exit()", "null"])
    assert.throws(() => parseJson(t));
});
test("source evidence must be a literal article quote, never a fabricated citation", () => {
  const article = {
      text: "브라우저 자동화는 실제 뉴스 본문을 읽고 검증 가능한 근거를 남깁니다.",
    },
    summary =
      "브라우저가 실제 뉴스를 읽으며 확인 가능한 출처를 함께 기록합니다.";
  assert.equal(
    validateSummary({ summary, evidence: "실제 뉴스 본문을 읽고" }, article)
      .summary,
    summary,
  );
  assert.throws(() =>
    validateSummary(
      { summary, evidence: "뉴스를 마음대로 만들어 냅니다" },
      article,
    ),
  );
  assert.throws(() =>
    validateSummary(
      { summary: "짧음", evidence: "실제 뉴스 본문을 읽고" },
      article,
    ),
  );
});
test("CLI maps direct short commands to deterministic JSON actions", () => {
  assert.deepEqual(actionFromArgs("open", ["https://example.com"], {}), {
    action: "open",
    url: "https://example.com",
  });
  assert.deepEqual(actionFromArgs("fill", ["s1/e1", "이인호"], {}), {
    action: "fill",
    ref: "s1/e1",
    text: "이인호",
  });
  assert.throws(() => actionFromArgs("eval", ["process.exit()"], {}));
  assert.throws(() => actionFromArgs("open", [], {}));
});
test("news selection canonicalizes and deduplicates distinct real Naver article IDs", () => {
  const links = [
    { url: "https://n.news.naver.com/mnews/article/001/123?sid=105" },
    { url: "https://n.news.naver.com/article/001/123" },
    { url: "https://evil.test/article/001/123" },
    { url: "https://n.news.naver.com/mnews/article/002/456" },
    { url: "https://n.news.naver.com/mnews/article/comment/001/123" },
  ];
  assert.deepEqual(newsLinks(links), [
    "https://n.news.naver.com/mnews/article/001/123",
    "https://n.news.naver.com/mnews/article/002/456",
  ]);
});
test("model action boundary blocks code, file writes, form edits and host escapes", () => {
  assert.deepEqual(
    validateAgentAction({ action: "read", chars: 3000 }, ["news.naver.com"]),
    { action: "read", chars: 3000 },
  );
  for (const cmd of [
    { action: "eval", code: "x" },
    { action: "fill", text: "send" },
    { action: "policy", hosts: ["evil.test"] },
    { action: "screenshot", path: "secret.png" },
    { action: "open", url: "http://127.0.0.1" },
  ])
    assert.throws(() => validateAgentAction(cmd, ["news.naver.com"]));
  assert.throws(() =>
    validateAgentAction({ action: "read", chars: 999999 }, ["news.naver.com"]),
  );
});
test("model configuration is explicit, credential-free URLs, no implicit cloud route", () => {
  assert.throws(() => new ModelClient({ model: "x", provider: "unknown" }));
  assert.throws(
    () => new ModelClient({ model: "x", baseUrl: "https://user:pass@host/v1" }),
  );
  assert.equal(
    new ModelClient({ model: "x", provider: "ollama" }).base,
    "http://127.0.0.1:11434",
  );
});
