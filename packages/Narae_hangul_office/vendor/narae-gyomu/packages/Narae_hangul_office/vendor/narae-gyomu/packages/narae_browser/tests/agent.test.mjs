import test from "node:test";
import assert from "node:assert/strict";
import { knownUrls, actionSchema } from "../src/agent-contract.mjs";
test("small-model URL grammar permits only user/observed exact hosts, not invented command strings", () => {
  const urls = knownUrls(
    "https://n.news.naver.com/mnews/article/001/123 를 읽어줘",
    ["n.news.naver.com"],
    [
      {
        links: [
          { url: "https://evil.test/" },
          { url: "https://n.news.naver.com/mnews/article/002/456" },
          { url: "javascript:alert(1)" },
        ],
      },
    ],
  );
  assert.equal(urls[0], "https://n.news.naver.com/mnews/article/001/123");
  assert(urls.includes("https://n.news.naver.com/mnews/article/002/456"));
  assert(!urls.some((x) => x.includes("evil.test")));
  assert.deepEqual(
    actionSchema(urls).oneOf.map((x) => x.properties.action.const),
    ["open"],
  );
});
test("agent grammar never offers finish before a real read observation", () => {
  const urls = ["https://example.com"];
  assert(
    !actionSchema(urls, { opened: true }).oneOf.some(
      (x) => x.properties.action.const === "finish",
    ),
  );
  assert(
    actionSchema(urls, { opened: true, read: true }).oneOf.some(
      (x) => x.properties.action.const === "finish",
    ),
  );
  assert.deepEqual(actionSchema(urls).oneOf[0].properties.url.enum, urls);
});
