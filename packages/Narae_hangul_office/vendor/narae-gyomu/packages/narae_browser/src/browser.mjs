import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export class Fault extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export function bound(value, min, max, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Fault("INVALID_ARGUMENT", `Expected integer ${min}..${max}`);
  return n;
}
export function webUrl(value, hosts = []) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Fault("INVALID_URL", "Absolute http(s) URL required");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Fault(
      "INVALID_URL",
      "Only http(s), without embedded credentials",
    );
  if (hosts.length && !hosts.includes(u.hostname.toLowerCase()))
    throw new Fault("HOST_DENIED", `Host not allowed: ${u.hostname}`);
  return u.href;
}
export function browserPath() {
  if (process.env.NARAE_BROWSER_EXECUTABLE) {
    if (!fs.existsSync(process.env.NARAE_BROWSER_EXECUTABLE))
      throw new Fault(
        "BROWSER_NOT_FOUND",
        "NARAE_BROWSER_EXECUTABLE does not exist",
      );
    return process.env.NARAE_BROWSER_EXECUTABLE;
  }
  const candidates =
    process.platform === "win32"
      ? [
          `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,
          `${process.env["PROGRAMFILES(X86)"]}/Microsoft/Edge/Application/msedge.exe`,
          `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
          ];
  const found = candidates.find((x) => fs.existsSync(x));
  if (!found)
    throw new Fault(
      "BROWSER_NOT_FOUND",
      "Install Chrome/Edge, or set NARAE_BROWSER_EXECUTABLE",
    );
  return found;
}
export class BrowserEngine {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pages = [];
    this.refs = new Map();
    this.serial = 0;
    this.policy = null;
    this.errors = [];
  }
  async start({ headed = false } = {}) {
    this.browser = await chromium.launch({
      headless: !headed,
      executablePath: browserPath(),
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "ko-KR",
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    this.context.setDefaultTimeout(12000);
    this.context.on("page", (p) => {
      this.pages.push(p);
      p.on("framenavigated", (f) => {
        if (f === p.mainFrame() && p === this.page) this.invalidate();
      });
      p.on("pageerror", (e) => {
        this.errors.push(e.message.slice(0, 200));
        this.errors = this.errors.slice(-10);
      });
      p.on("dialog", (d) => d.dismiss().catch(() => {}));
    });
    await this.context.route("**/*", async (route) => {
      const req = route.request();
      if (this.policy && req.isNavigationRequest()) {
        try {
          webUrl(req.url(), this.policy.hosts);
        } catch {
          return route.abort("blockedbyclient");
        }
        if (!["GET", "HEAD"].includes(req.method()))
          return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    this.page = await this.context.newPage();
    return { browser: "chromium", headless: !headed, isolated: true };
  }
  invalidate() {
    this.serial++;
    this.refs.clear();
  }
  async snapshot(args = {}) {
    const limit = bound(args.limit, 1, 100, 35),
      chars = bound(args.chars, 100, 12000, 1600),
      version = "s" + ++this.serial;
    this.refs.clear();
    const result = await this.page.evaluate(
      ({ limit, chars, version }) => {
        const visible = (e) => {
          const s = getComputedStyle(e),
            r = e.getBoundingClientRect();
          return (
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            r.width > 0 &&
            r.height > 0
          );
        };
        const list = [];
        const nodes = document.querySelectorAll(
          "a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]",
        );
        let i = 0;
        for (const e of nodes) {
          if (!visible(e)) continue;
          const tag = e.tagName.toLowerCase(),
            role =
              e.getAttribute("role") ||
              (tag === "a" ? "link" : tag === "input" ? "textbox" : tag),
            label = (
              e.getAttribute("aria-label") ||
              e.labels?.[0]?.innerText ||
              e.getAttribute("placeholder") ||
              e.innerText ||
              e.getAttribute("title") ||
              e.getAttribute("name") ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);
          if (!label && tag === "a") continue;
          const ref = version + "/e" + ++i;
          e.setAttribute("data-narae-ref", ref);
          list.push({
            ref,
            role,
            label,
            ...(tag === "a" ? { href: e.href } : {}),
          });
          if (i >= limit) break;
        }
        const main =
          document.querySelector("#dic_area,article,main,[role=main]") ||
          document.body;
        return {
          url: location.href,
          title: document.title,
          text: main.innerText.replace(/\n{3,}/g, "\n\n").slice(0, chars),
          elements: list,
        };
      },
      { limit, chars, version },
    );
    for (const item of result.elements) this.refs.set(item.ref, item);
    return { version, ...result, untrusted: true };
  }
  ref(value) {
    const entry = this.refs.get(value);
    if (!entry)
      throw new Fault(
        "STALE_REF",
        "Unknown/expired reference. Call snapshot and use its ref.",
      );
    return { entry, locator: this.page.locator(`[data-narae-ref="${value}"]`) };
  }
  async read(args = {}) {
    const chars = bound(args.chars, 100, 20000, 5000),
      offset = bound(args.offset, 0, 1000000, 0);
    const result = await this.page.evaluate(
      ({ chars, offset, selector }) => {
        const el = selector
          ? document.querySelector(selector)
          : document.querySelector("#dic_area,article,main,[role=main]") ||
            document.body;
        if (!el)
          return {
            url: location.href,
            title: document.title,
            text: "",
            error: "SELECTOR_NOT_FOUND",
          };
        const text = el.innerText.replace(/\n{3,}/g, "\n\n").trim();
        const headline =
          document
            .querySelector("#title_area,article h1,main h1,[role=main] h1")
            ?.innerText.trim() || document.title;
        const description =
          document.querySelector("meta[name=description]")?.content || "";
        const publisher =
          document.querySelector(".media_end_head_top_logo img")?.alt ||
          document.querySelector('meta[property="og:site_name"]')?.content ||
          "";
        const published =
          document
            .querySelector("._ARTICLE_DATE_TIME")
            ?.getAttribute("data-date-time") ||
          document.querySelector('meta[property="article:published_time"]')
            ?.content ||
          "";
        const links = [...el.querySelectorAll("a[href]")]
          .map((e) => ({
            title: e.innerText.replace(/\s+/g, " ").trim().slice(0, 140),
            url: e.href,
          }))
          .filter((x) => x.title && /^https?:/.test(x.url))
          .slice(0, 60);
        return {
          url: location.href,
          title: headline,
          publisher,
          published,
          description,
          text: text.slice(offset, offset + chars),
          offset,
          totalChars: text.length,
          truncated: text.length > offset + chars,
          links,
          untrusted: true,
        };
      },
      { chars, offset, selector: args.selector || null },
    );
    if (result.error)
      throw new Fault(
        result.error,
        "Requested content was not found; take a new snapshot",
      );
    return result;
  }
  async execute(command) {
    if (!command || typeof command !== "object" || Array.isArray(command))
      throw new Fault("INVALID_COMMAND", "Command object required");
    const { action } = command;
    if (typeof action !== "string")
      throw new Fault("INVALID_COMMAND", "action is required");
    if (action === "policy") {
      if (
        !Array.isArray(command.hosts) ||
        !command.hosts.length ||
        command.hosts.some(
          (h) => typeof h !== "string" || !/^[a-z0-9.-]+$/.test(h),
        )
      )
        throw new Fault("INVALID_POLICY", "Explicit hostnames required");
      this.policy = { hosts: command.hosts };
      return { readOnly: true, hosts: command.hosts };
    }
    if (action === "close") {
      await this.browser?.close();
      return { closed: true };
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
      this.invalidate();
    }
    switch (action) {
      case "open": {
        const url = webUrl(command.url, this.policy?.hosts);
        this.invalidate();
        const response = await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        if (this.policy) webUrl(this.page.url(), this.policy.hosts);
        return {
          status: response?.status() ?? null,
          ...(await this.snapshot(command)),
        };
      }
      case "snapshot":
        return this.snapshot(command);
      case "read":
        return this.read(command);
      case "click": {
        const { entry, locator } = this.ref(command.ref);
        if (this.policy) {
          if (entry.role !== "link" || !entry.href)
            throw new Fault(
              "READ_ONLY",
              "Agent may click only navigation links",
            );
          webUrl(entry.href, this.policy.hosts);
        }
        if ((await locator.count()) !== 1)
          throw new Fault(
            "STALE_REF",
            "Element no longer exists. Refresh snapshot.",
          );
        await locator.click();
        await this.page.waitForLoadState("domcontentloaded");
        this.invalidate();
        return this.snapshot(command);
      }
      case "fill": {
        if (this.policy)
          throw new Fault("READ_ONLY", "Model session cannot edit forms");
        if (typeof command.text !== "string" || command.text.length > 20000)
          throw new Fault("INVALID_ARGUMENT", "text string max 20000 required");
        const { locator } = this.ref(command.ref);
        await locator.fill(command.text);
        this.invalidate();
        return { filled: true, refresh: "snapshot" };
      }
      case "select": {
        if (this.policy)
          throw new Fault("READ_ONLY", "Model session cannot edit forms");
        const { locator } = this.ref(command.ref);
        const selected = await locator.selectOption(String(command.value));
        this.invalidate();
        return { selected };
      }
      case "press": {
        if (this.policy)
          throw new Fault("READ_ONLY", "Model session cannot press keys");
        if (typeof command.key !== "string" || command.key.length > 60)
          throw new Fault("INVALID_ARGUMENT", "key required");
        if (command.ref) {
          const { locator } = this.ref(command.ref);
          await locator.press(command.key);
        } else await this.page.keyboard.press(command.key);
        this.invalidate();
        return this.snapshot(command);
      }
      case "scroll": {
        const pixels = bound(command.pixels, -10000, 10000, 600);
        await this.page.mouse.wheel(0, pixels);
        this.invalidate();
        return this.snapshot(command);
      }
      case "wait": {
        if (command.selector)
          await this.page
            .locator(command.selector)
            .first()
            .waitFor({
              state: "visible",
              timeout: bound(command.timeout, 100, 30000, 12000),
            });
        else await this.page.waitForTimeout(bound(command.ms, 0, 5000, 300));
        return { ready: true, url: this.page.url() };
      }
      case "back":
        await this.page.goBack({ waitUntil: "domcontentloaded" });
        this.invalidate();
        return this.snapshot(command);
      case "tabs":
        return {
          tabs: await Promise.all(
            this.pages
              .filter((p) => !p.isClosed())
              .map(async (p, i) => ({
                index: i,
                url: p.url(),
                title: await p.title(),
                active: p === this.page,
              })),
          ),
        };
      case "tab": {
        const pages = this.pages.filter((p) => !p.isClosed());
        const index = bound(command.index, 0, pages.length - 1, 0);
        this.page = pages[index];
        await this.page.bringToFront();
        this.invalidate();
        return this.snapshot(command);
      }
      case "screenshot": {
        if (this.policy)
          throw new Fault("READ_ONLY", "Agent cannot write files");
        if (!command.path) throw new Fault("INVALID_ARGUMENT", "path required");
        const dest = path.resolve(command.path);
        if (!/\.(png|jpe?g)$/i.test(dest))
          throw new Fault("INVALID_ARGUMENT", "PNG/JPEG path required");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await this.page.screenshot({
          path: dest,
          fullPage: command.fullPage === true,
        });
        return { path: dest, bytes: fs.statSync(dest).size };
      }
      default:
        throw new Fault("UNKNOWN_ACTION", `Unknown action: ${action}`);
    }
  }
}
export function sessionRoot() {
  return path.resolve(
    process.env.NARAE_BROWSER_HOME || path.join(os.homedir(), ".narae-browser"),
  );
}
