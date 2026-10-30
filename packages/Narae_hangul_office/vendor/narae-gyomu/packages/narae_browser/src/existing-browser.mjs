import { chromium } from "playwright-core";
import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const extensionInstallURL =
  "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";
const fault = (code, message) => Object.assign(new Error(message), { code });

export function localCDPEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fault("INVALID_CDP_ENDPOINT", "로컬 Chrome 연결 주소를 확인하세요.");
  }
  if (
    !["http:", "ws:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw fault(
      "INVALID_CDP_ENDPOINT",
      "이 PC의 HTTP 또는 WebSocket Chrome 연결 주소만 지원합니다.",
    );
  return url.href;
}

export async function connectExistingBrowser({
  connection = "extension",
  channel = "chrome",
  profile,
  endpoint,
  directory,
  timeout = 90000,
} = {}) {
  if (connection === "cdp")
    return chromium.connectOverCDP(localCDPEndpoint(endpoint), {
      noDefaults: true,
      timeout,
    });
  if (connection !== "extension" || !["chrome", "msedge"].includes(channel))
    throw fault(
      "INVALID_BROWSER_CONNECTION",
      "Chrome 또는 Edge 확장 연결을 선택하세요.",
    );
  if (!directory || !path.isAbsolute(directory))
    throw fault(
      "BROWSER_DATA_DIRECTORY",
      "브라우저 연결 자료의 절대 경로가 필요합니다.",
    );
  if (profile !== undefined && !/^(?:Default|Profile \d+)$/.test(profile))
    throw fault(
      "INVALID_BROWSER_PROFILE",
      "Default 또는 Profile 번호를 지정하세요.",
    );
  fs.mkdirSync(directory, { recursive: true });
  const log = fs.openSync(path.join(directory, "extension-host.log"), "a");
  const child = fork(
    fileURLToPath(new URL("./extension-host.mjs", import.meta.url)),
    [],
    {
      windowsHide: true,
      execArgv: [],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PWTEST_SERVER_REGISTRY: path.join(directory, "registry"),
      },
      stdio: ["ignore", "ignore", log, "ipc"],
    },
  );
  fs.closeSync(log);
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(reject)(
            fault(
              "CHROME_CONNECT_TIMEOUT",
              "Chrome에서 연결할 탭을 선택하는 시간이 지났습니다. 다시 연결하세요.",
            ),
          ),
        timeout,
      );
      const finish = (fn) => (value) => {
        clearTimeout(timer);
        child.removeListener("message", message);
        child.removeListener("error", error);
        child.removeListener("exit", exited);
        fn(value);
      };
      const message = (value) =>
        value?.ok
          ? finish(resolve)(value.endpoint)
          : finish(reject)(
              fault(
                value?.code || "CHROME_CONNECT_FAILED",
                value?.message || "Chrome 연결을 완료하지 못했습니다.",
              ),
            );
      const error = finish(reject),
        exited = () =>
          finish(reject)(
            fault("CHROME_CONNECT_CLOSED", "Chrome 연결이 종료됐습니다."),
          );
      child.on("message", message);
      child.once("error", error);
      child.once("exit", exited);
      child.send({ channel, profile, directory });
    });
    const browser = await chromium.connect(address, { timeout: 15000 });
    browser.on("disconnected", stop);
    return browser;
  } catch (error) {
    stop();
    throw error;
  }
}
