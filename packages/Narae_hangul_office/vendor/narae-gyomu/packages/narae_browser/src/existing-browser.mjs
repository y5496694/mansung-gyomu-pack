import { chromium } from "playwright-core";
import { execFileSync, fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const extensionInstallURL =
  "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";
const fault = (code, message) => Object.assign(new Error(message), { code });

export function extensionEnvironment(values = {}) {
  const allowed = [
    "PLAYWRIGHT_MCP_EXTENSION_TOKEN",
    "PLAYWRIGHT_MCP_BROWSER",
    "PLAYWRIGHT_MCP_PROFILE_DIR_NAME",
  ];
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.keys(values).some((key) => !allowed.includes(key))
  )
    throw fault(
      "INVALID_EXTENSION_ENV",
      "Playwright 확장 연결용 환경 변수만 지원합니다.",
    );
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      typeof value !== "string" ||
      value.length > 4096 ||
      /[\r\n\0]/.test(value)
    )
      throw fault("INVALID_EXTENSION_ENV", "연결 환경 변수 값을 확인하세요.");
    if (value.trim()) result[key] = value.trim();
  }
  if (
    result.PLAYWRIGHT_MCP_EXTENSION_TOKEN &&
    /\s/.test(result.PLAYWRIGHT_MCP_EXTENSION_TOKEN)
  )
    throw fault("INVALID_EXTENSION_ENV", "확장 토큰에는 공백을 넣지 마세요.");
  if (
    result.PLAYWRIGHT_MCP_BROWSER &&
    !["chrome", "msedge"].includes(result.PLAYWRIGHT_MCP_BROWSER)
  )
    throw fault("INVALID_EXTENSION_ENV", "Chrome 또는 Edge를 선택하세요.");
  if (
    result.PLAYWRIGHT_MCP_PROFILE_DIR_NAME &&
    !/^(?:Default|Profile \d+)$/.test(result.PLAYWRIGHT_MCP_PROFILE_DIR_NAME)
  )
    throw fault("INVALID_EXTENSION_ENV", "프로필 디렉터리 이름을 확인하세요.");
  return result;
}

// An already running desktop host does not inherit later User environment edits.
// Read only this named value; never persist it in session files or diagnostics.
export function extensionToken({
  env = process.env,
  platform = process.platform,
  query = execFileSync,
} = {}) {
  if (env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim())
    return env.PLAYWRIGHT_MCP_EXTENSION_TOKEN.trim();
  if (platform !== "win32") return undefined;
  try {
    const result = query(
      "reg.exe",
      ["query", "HKCU\\Environment", "/v", "PLAYWRIGHT_MCP_EXTENSION_TOKEN"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return result.match(
      /^\s*PLAYWRIGHT_MCP_EXTENSION_TOKEN\s+REG_SZ\s+(\S+)\s*$/m,
    )?.[1];
  } catch {
    return undefined;
  }
}

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
  channel,
  profile,
  endpoint,
  directory,
  timeout = 90000,
  environment = {},
} = {}) {
  if (connection === "cdp")
    return chromium.connectOverCDP(localCDPEndpoint(endpoint), {
      noDefaults: true,
      timeout,
    });
  const childEnvironment = {
    ...process.env,
    ...extensionEnvironment(environment),
  };
  channel ||= childEnvironment.PLAYWRIGHT_MCP_BROWSER || "chrome";
  profile ??= childEnvironment.PLAYWRIGHT_MCP_PROFILE_DIR_NAME || undefined;
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
  const token = extensionToken({ env: childEnvironment });
  const log = fs.openSync(path.join(directory, "extension-host.log"), "a");
  const child = fork(
    fileURLToPath(new URL("./extension-host.mjs", import.meta.url)),
    [],
    {
      windowsHide: true,
      execArgv: [],
      env: {
        ...childEnvironment,
        ...(token ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: token } : {}),
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
