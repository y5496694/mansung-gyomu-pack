import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { command } from "./session.mjs";
import { Fault, bound, webUrl } from "./browser.mjs";
import { extractiveSummary } from "./extractive.mjs";
import { ModelClient, summarize } from "./model.mjs";
import { newsLinks } from "./protocol.mjs";
export { agent } from "./agent.mjs";
const naverHosts = ["news.naver.com", "n.news.naver.com"];
export async function news(options = {}) {
  const count = bound(options.count, 1, 10, 3),
    section = String(options.section || "105");
  if (
    options.summaryMode &&
    !["extractive", "abstractive"].includes(options.summaryMode)
  )
    throw new Fault("INVALID_SUMMARY_MODE", "Use extractive or abstractive");
  if (!["100", "101", "102", "103", "104", "105"].includes(section))
    throw new Fault("INVALID_SECTION", "Use Naver section 100..105");
  const session = options.session || "news-" + process.pid,
    model = options.extractive ? null : new ModelClient(options),
    articles = [],
    trace = [];
  try {
    await command(session, { action: "policy", hosts: naverHosts }, options);
    const start = await command(
      session,
      { action: "open", url: "https://news.naver.com/section/" + section },
      options,
    );
    trace.push({ action: "open", url: start.url, status: start.status });
    await command(session, { action: "wait", selector: "a.sa_text_title" });
    const listing = await command(session, { action: "read", chars: 1000 });
    const urls = newsLinks(listing.links);
    if (urls.length < count)
      throw new Fault(
        "NEWS_LINKS_MISSING",
        `Found ${urls.length} distinct article links, need ${count}`,
      );
    for (const url of urls.slice(0, count)) {
      const opened = await command(session, { action: "open", url });
      if (opened.status >= 400)
        throw new Fault(
          "ARTICLE_HTTP",
          `Article returned HTTP ${opened.status}`,
        );
      await command(session, { action: "wait", selector: "#dic_area" });
      const article = await command(session, {
        action: "read",
        selector: "#dic_area",
        chars: 12000,
      });
      webUrl(article.url, naverHosts);
      if (article.error || article.text.length < 150)
        throw new Fault("ARTICLE_EMPTY", "Expected a real Naver article body");
      const sourceSha256 = createHash("sha256")
        .update(article.text)
        .digest("hex");
      let evidenceFile;
      if (options.evidenceDir) {
        fs.mkdirSync(options.evidenceDir, { recursive: true });
        evidenceFile = path.resolve(
          options.evidenceDir,
          `article-${articles.length + 1}.json`,
        );
        fs.writeFileSync(
          evidenceFile,
          JSON.stringify(
            { retrievedAt: new Date().toISOString(), ...article, sourceSha256 },
            null,
            2,
          ),
        );
      }
      const summary = model
        ? options.summaryMode === "abstractive"
          ? await summarize(model, article)
          : await extractiveSummary(model, article)
        : {
            summary: article.text.slice(0, 350),
            evidence: article.text.slice(0, 100),
            summaryMethod: "source-prefix-no-model",
          };
      articles.push({
        url,
        title: article.title,
        publisher: article.publisher,
        published: article.published,
        ...summary,
        sourceChars: article.totalChars,
        readChars: article.text.length,
        sourceTruncated: article.truncated,
        sourceSha256,
        mode: model ? "local-model-summary" : "source-excerpt",
        ...(evidenceFile ? { evidenceFile } : {}),
      });
      trace.push({
        action: "read",
        url,
        bodyChars: article.text.length,
        status: opened.status,
      });
    }
    return {
      task: "naver-news",
      retrievedAt: new Date().toISOString(),
      count: articles.length,
      selection: {
        section,
        order:
          "first distinct visible section article links; not a full-site latest ranking",
      },
      articles,
      model: model
        ? {
            requested: model.model,
            provider: model.provider,
            usage: model.usage,
          }
        : null,
      trace,
      verification: {
        actualBrowser: true,
        distinctUrls: new Set(articles.map((x) => x.url)).size === count,
        articleBodiesRead: true,
        literalEvidenceValidated: !!model,
        autonomousNavigation: false,
      },
    };
  } finally {
    await command(session, { action: "close" }).catch(() => {});
  }
}
