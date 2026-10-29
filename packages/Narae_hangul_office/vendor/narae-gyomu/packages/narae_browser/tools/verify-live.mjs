import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sentenceCandidates } from "../src/extractive.mjs";
const file = process.argv[2] || "artifacts/naver-live.json";
const response = JSON.parse(fs.readFileSync(file, "utf8"));
assert.equal(response.ok, true);
const data = response.data;
assert.equal(data.count, 3);
assert.equal(data.articles.length, 3);
assert.equal(new Set(data.articles.map((a) => a.url)).size, 3);
assert.equal(data.verification.actualBrowser, true);
assert.equal(data.verification.articleBodiesRead, true);
assert.equal(data.model.usage.length, 3);
const articles = data.articles.map((article) => {
  const source = JSON.parse(fs.readFileSync(article.evidenceFile, "utf8"));
  assert.equal(source.url, article.url);
  assert.equal(source.text.length, article.readChars);
  assert.equal(
    createHash("sha256").update(source.text).digest("hex"),
    article.sourceSha256,
  );
  assert.equal(article.summaryMethod, "model-selected-source-sentences");
  const candidates = sentenceCandidates(source.text);
  assert.equal(candidates.length, article.candidateCount);
  assert.equal(
    article.summary,
    article.selectedIndices.map((i) => candidates[i]).join(" "),
  );
  assert(source.text.replace(/\s+/g, " ").includes(article.evidence));
  const { evidenceFile, ...publicFields } = article;
  return publicFields;
});
const report = {
  retrievedAt: data.retrievedAt,
  scope:
    "Real Chrome Naver browsing + local model sentence selection; NOT general autonomous-agent completion",
  model: data.model,
  verification: data.verification,
  articles,
};
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(
  "docs/live-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
const markdown = [
  "# 나래 브라우저: 실제 네이버 뉴스 3개 검증",
  "",
  `수집 시각: ${data.retrievedAt}`,
  `로컬 모델: ${data.model.requested} (${data.model.provider})`,
  "",
  "요약 방식: 모델이 핵심 문장 번호를 선택하고 실행기가 원문에서 가져온 발췌 요약. 자유 서술형 또는 임의 목표 자율 탐색 성공으로 해석하지 않습니다.",
  "",
  ...articles.flatMap((article, i) => [
    `## ${i + 1}. ${article.title}`,
    "",
    article.summary,
    "",
    `출처: ${article.url}`,
    `본문 읽기: ${article.readChars}자 · 원문 해시 및 선택 문장 일치 검증 통과`,
    "",
  ]),
  "## 검증 범위",
  "",
  "- 실제 Chrome과 실제 네이버 기사 3개 본문을 사용했습니다.",
  "- 로컬 모델 호출 3회의 모델 ID와 토큰 수를 기록했습니다.",
  "- 저장 원문의 SHA-256과 결과를 대조하고, 요약이 선택한 원문 문장과 정확히 일치함을 확인했습니다.",
  "- 사이트 기사 자체의 사실성 또는 일반 자율 탐색 성능까지 검증한 것은 아닙니다.",
  "",
];
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/naver-news-summary.md", markdown.join("\n"));
console.log(
  JSON.stringify({
    verified: true,
    count: articles.length,
    model: data.model,
    publicReport: path.resolve("docs/live-smoke.json"),
    summaryFile: path.resolve("artifacts/naver-news-summary.md"),
    articles: articles.map(({ title, url, summary }) => ({
      title,
      url,
      summary,
    })),
  }),
);
