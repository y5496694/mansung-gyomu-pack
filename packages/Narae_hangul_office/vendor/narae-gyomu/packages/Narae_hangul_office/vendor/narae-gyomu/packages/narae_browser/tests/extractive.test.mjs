import test from "node:test";
import assert from "node:assert/strict";
import {
  sentenceCandidates,
  selectSentences,
  extractiveSummary,
} from "../src/extractive.mjs";
const text =
  "나래 브라우저는 별도의 계정 로그인 없이 네이버 기사 본문을 직접 읽고 출처를 함께 기록합니다.\n\n로컬 소형 모델은 본문에 있는 핵심 문장을 선택하며 실행기는 번호를 검증한 뒤 원문을 그대로 가져옵니다.\n\n모델이 잘못된 번호나 중복 번호를 반환하면 성공한 척하지 않고 명확한 오류로 작업을 중단합니다.";
test("sentence candidates are bounded literal source phrases", () => {
  const c = sentenceCandidates(text);
  assert.equal(c.length, 3);
  assert(c.every((x) => text.includes(x)));
  assert(sentenceCandidates(Array(100).fill(text).join("\n\n")).length <= 12);
});
test("extractive summaries reject fake, repeated and out-of-range sentence indices", () => {
  const c = sentenceCandidates(text);
  assert.deepEqual(selectSentences({ indices: [2, 0] }, c), [0, 2]);
  for (const indices of [[0, 0], [99, 0], [-1, 2], ["0", 1], [0], null])
    assert.throws(() => selectSentences({ indices }, c));
});
test("tiny-model output chooses source indices; it cannot inject its own dates or prose", async () => {
  const unitFixtureModel = {
    json: async (messages, options) => {
      assert.equal(options.jsonSchema.required[0], "indices");
      return { indices: [2, 0], madeUpText: "2099년에 상용화" };
    },
  };
  const result = await extractiveSummary(unitFixtureModel, {
    title: "unit fixture",
    text,
  });
  assert.equal(result.summaryMethod, "model-selected-source-sentences");
  assert.deepEqual(result.selectedIndices, [0, 2]);
  assert(!result.summary.includes("2099"));
  assert(result.summary.includes(sentenceCandidates(text)[0]));
  assert(text.includes(result.evidence));
});
