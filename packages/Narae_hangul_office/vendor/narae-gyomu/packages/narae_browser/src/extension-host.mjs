// Keep the official extension relay in a disposable helper. Cancelling a tab
// selection kills this relay, never the user's Chrome process or profile.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let browser;
const close = async () => {
  await browser?.close().catch(() => {});
  process.exit();
};
process.on("disconnect", close);
process.on("SIGTERM", close);
process.once("message", async ({ channel, profile, directory }) => {
  try {
    // This exported integration API is pinned to the tested Playwright release.
    const { tools } = require("playwright-core/lib/coreBundle");
    const options = {
      extension: true,
      browser: channel,
      profileDirName: profile,
      outputDir: directory,
    };
    const config = await tools.resolveCLIConfigForMCP(options, {});
    config.browser.isolated = false;
    const info = await tools.createBrowserWithInfo(
      config,
      { clientName: "나래 브라우저", clientVersion: "0.2.0", cwd: directory },
      options,
      { title: "나래 브라우저", workspaceDir: directory },
    );
    browser = info.browser;
    process.send({ ok: true, endpoint: info.endpoint });
  } catch (error) {
    console.error(error);
    const missing =
      /Extension not found|extension is installed|extension.*not.*install/i.test(
        error.message,
      );
    process.send(
      {
        ok: false,
        code: missing ? "CHROME_EXTENSION_REQUIRED" : "CHROME_CONNECT_FAILED",
        message: missing
          ? "Chrome에 Playwright 확장을 설치한 뒤 다시 연결하세요."
          : "Chrome 연결을 완료하지 못했습니다. 확장 연결 화면에서 탭을 선택한 뒤 다시 시도하세요.",
      },
      close,
    );
  }
});
