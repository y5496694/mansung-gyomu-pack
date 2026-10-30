import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { connectExistingBrowser } from "./existing-browser.mjs";
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
    this.frame = null;
    this.pendingDialog = null;
    this.dialogSerial = 0;
  }
  async start({ headed = false, connection = "isolated", ...options } = {}) {
    if (connection !== "isolated")
      return this.attach({ connection, ...options });
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
      this.watchDialogs(p);
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
  async attach(options = {}) {
    if (this.browser)
      throw new Fault(
        "BROWSER_ALREADY_CONNECTED",
        "먼저 현재 브라우저 연결을 종료하세요.",
      );
    const browser = await connectExistingBrowser({
      directory: path.join(sessionRoot(), "connections"),
      ...options,
    });
    this.browser = browser;
    this.attached = true;
    this.connection = options.connection || "extension";
    this.context = browser.contexts()[0];
    const watch = (page) => {
      if (this.pages.includes(page)) return;
      this.pages.push(page);
      this.watchDialogs(page);
      page.on("pageerror", (error) => {
        this.errors.push(error.message.slice(0, 400));
        this.errors = this.errors.slice(-10);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          this.errors.push(message.text().slice(0, 400));
          this.errors = this.errors.slice(-10);
        }
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame() && page === this.page) this.invalidate();
      });
    };
    try {
      if (!this.context)
        throw new Fault(
          "CHROME_NO_CONTEXT",
          "연결된 Chrome 창을 확인하지 못했습니다.",
        );
      this.context.setDefaultTimeout(12000);
      this.context.on("page", watch);
      for (const page of this.context.pages()) watch(page);
      this.page = this.pages.findLast((page) => /^https?:/.test(page.url()));
      return {
        browser: "chromium",
        attached: true,
        isolated: false,
        connection: this.connection,
        ...(await this.execute({ action: "tabs" })),
      };
    } catch (error) {
      await browser.close().catch(() => {});
      this.browser = null;
      throw error;
    }
  }
  invalidate() {
    this.serial++;
    this.refs.clear();
  }
  activeDocument() {
    if (this.frame?.isDetached()) {
      this.frame = null;
      this.invalidate();
      throw new Fault(
        "FRAME_DETACHED",
        "프레임이 바뀌었습니다. frames에서 다시 선택하세요.",
      );
    }
    return this.frame || this.page;
  }
  watchDialogs(page) {
    page.on("dialog", (dialog) => {
      if (this.policy) {
        void dialog.dismiss().catch(() => {});
        return;
      }
      this.pendingDialog = {
        dialog,
        page,
        id: "d" + ++this.dialogSerial,
        type: dialog.type(),
        message: dialog.message(),
        url: page.url(),
      };
    });
  }
  dialogState() {
    const current = this.pendingDialog;
    return current
      ? {
          id: current.id,
          type: current.type,
          message: current.message,
          url: current.url,
          untrusted: true,
        }
      : null;
  }
  async withDialog(action) {
    if (this.policy) {
      await action();
      return false;
    }
    let observed;
    const appeared = new Promise((resolve) => {
      observed = () => resolve();
    });
    this.page.once("dialog", observed);
    const pending = Promise.resolve().then(action);
    // Keep the click alive while returning its dialog so the next serialized
    // CLI command can resolve it. Never repeat the click to accept a prompt.
    this.pendingAction = pending;
    void pending.catch(() => {});
    try {
      await Promise.race([pending, appeared]);
    } finally {
      this.page.off("dialog", observed);
    }
    if (this.pendingDialog) return true;
    this.pendingAction = null;
    return false;
  }
  async handleDialog(command) {
    const current = this.pendingDialog;
    if (!command.decision)
      return {
        dialog: this.dialogState(),
        ...(this.errors.length ? { pageErrors: this.errors } : {}),
      };
    if (this.policy)
      throw new Fault("READ_ONLY", "Agent cannot handle dialogs");
    if (
      !current ||
      command.expectedId !== current.id ||
      command.expectedMessage !== current.message
    )
      throw new Fault(
        "DIALOG_MISMATCH",
        "dialog의 현재 ID와 확인한 원문을 정확히 지정하세요.",
      );
    if (
      !["accept", "dismiss"].includes(command.decision) ||
      !["confirm", "alert"].includes(current.type)
    )
      throw new Fault(
        "DIALOG_UNSUPPORTED",
        "confirm·alert의 accept·dismiss만 지원합니다.",
      );
    this.pendingDialog = null;
    try {
      await current.dialog[command.decision]();
    } catch (error) {
      this.pendingDialog ||= current;
      throw error;
    }
    let actionError;
    try {
      if (!this.pendingDialog && this.pendingAction) {
        const pending = this.pendingAction;
        await this.withDialog(() => pending);
      }
    } catch (error) {
      actionError = String(error.message).slice(0, 300);
    }
    this.invalidate();
    return {
      handled: true,
      id: current.id,
      decision: command.decision,
      dialog: this.dialogState(),
      ...(actionError ? { actionError } : {}),
    };
  }
  async withNavigation(action) {
    const frame = this.frame || this.page.mainFrame();
    let navigated = false;
    let resolveNavigation;
    const navigation = new Promise((resolve) => {
      resolveNavigation = resolve;
    });
    const observed = (changed) => {
      if (changed === frame) {
        navigated = true;
        resolveNavigation();
      }
    };
    this.page.on("framenavigated", observed);
    try {
      return await action();
    } catch (error) {
      if (!/Execution context was destroyed/.test(String(error.message)))
        throw error;
      // Chromium can report the destroyed context just before the matching
      // frame-navigation event reaches Playwright. Wait only for that proof.
      if (!navigated) {
        let timer;
        try {
          await Promise.race([
            navigation,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 1500);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      if (!navigated) throw error;
      this.pendingAction = null;
      this.invalidate();
      // The native handler navigated while evaluate was returning. Never
      // repeat the click: the caller must read the resulting page separately.
      return {
        actionDispatched: true,
        navigationObserved: true,
        refresh: "snapshot",
      };
    } finally {
      this.page.off("framenavigated", observed);
    }
  }
  async snapshot(args = {}) {
    const limit = bound(args.limit, 1, 100, 35),
      offset = bound(args.offset, 0, 10000, 0),
      chars = bound(args.chars, 100, 12000, 1600),
      version = "s" + ++this.serial;
    this.refs.clear();
    const result = await this.activeDocument().evaluate(
      ({ limit, chars, version, selector, filter, offset }) => {
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
          selector ||
            "a,button,label[for],input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=treeitem],[role=tab],[role=menuitem],[role=gridcell],[role=option],[role=combobox],[role=checkbox],[role=radio],[contenteditable=true]",
        );
        let i = 0;
        for (const e of nodes) {
          const nativeCheck = e.matches(
            "input[type=checkbox],input[type=radio]",
          );
          if (
            !visible(e) &&
            !(nativeCheck && e.parentElement && visible(e.parentElement))
          )
            continue;
          const tag = e.tagName.toLowerCase(),
            labelled =
              tag === "label" ? document.getElementById(e.htmlFor) : null,
            check = nativeCheck
              ? e
              : labelled?.matches("input[type=checkbox],input[type=radio]")
                ? labelled
                : null,
            role =
              (check ? check.type : null) ||
              e.getAttribute("role") ||
              (tag === "a" ? "link" : tag === "input" ? "textbox" : tag),
            label = (
              e.getAttribute("aria-label") ||
              (check
                ? e.closest("tr")?.innerText ||
                  check.labels?.[0]?.innerText ||
                  check.title ||
                  check.name
                : "") ||
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
          if (filter && !label.includes(filter)) continue;
          const ref = version + "/e" + ++i;
          e.setAttribute("data-narae-ref", ref);
          list.push({
            ref,
            role,
            label,
            id: e.id || "",
            tag,
            ...(check ? { checked: check.checked } : {}),
            ...(tag === "a" ? { href: e.href } : {}),
          });
        }
        const main =
          document.querySelector("#dic_area,article,main,[role=main]") ||
          document.body;
        return {
          url: location.href,
          title: document.title,
          text: main.innerText.replace(/\n{3,}/g, "\n\n").slice(0, chars),
          elements: list.slice(offset, offset + limit),
          totalElements: list.length,
        };
      },
      {
        limit,
        chars,
        version,
        offset,
        selector: args.selector || null,
        filter: args.filter || null,
      },
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
    return {
      entry,
      locator: this.activeDocument().locator(`[data-narae-ref="${value}"]`),
    };
  }
  async read(args = {}) {
    const chars = bound(args.chars, 100, 20000, 5000),
      offset = bound(args.offset, 0, 1000000, 0);
    const result = await this.activeDocument().evaluate(
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
    if (action === "dialog") return this.handleDialog(command);
    // Session health checks must remain available while a modal blocks DOM work.
    if (action === "tabs" && this.pendingDialog)
      return { tabs: [], dialog: this.dialogState() };
    if (this.pendingDialog && action !== "close")
      throw new Fault(
        "DIALOG_PENDING",
        "확인창이 열려 있습니다. dialog에서 원문을 확인해 처리하세요.",
      );
    if (action === "policy") {
      if (this.attached)
        throw new Fault(
          "ISOLATED_POLICY_REQUIRED",
          "뉴스·읽기 전용 agent는 전용 브라우저 세션을 사용하세요.",
        );
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
      return {
        closed: true,
        ...(this.attached
          ? { detached: true, userBrowserPreserved: true }
          : {}),
      };
    }
    if (action === "tabs")
      return {
        tabs: await Promise.all(
          this.pages
            .filter(
              (p) =>
                !p.isClosed() && (!this.attached || /^https?:/.test(p.url())),
            )
            .map(async (p, index) => ({
              index,
              url: p.url(),
              title: await p.title(),
              active: p === this.page,
            })),
        ),
      };
    if (!this.page || this.page.isClosed()) {
      if (this.attached) {
        this.page = this.pages.find(
          (p) => !p.isClosed() && /^https?:/.test(p.url()),
        );
        if (!this.page && action === "open") {
          webUrl(command.url, this.policy?.hosts);
          this.page = await this.context.newPage();
        }
        if (!this.page)
          throw new Fault(
            "ATTACHED_TAB_CLOSED",
            "연결된 웹 탭이 없습니다. open으로 기존 Chrome에 웹사이트를 여세요.",
          );
      } else {
        this.page = await this.context.newPage();
      }
      this.invalidate();
    }
    switch (action) {
      case "frames":
        return {
          frames: this.page.frames().map((frame, index) => ({
            index,
            name: frame.name(),
            url: frame.url(),
            active: frame === (this.frame || this.page.mainFrame()),
          })),
        };
      case "frame": {
        const frames = this.page.frames();
        const frame = frames[bound(command.index, 0, frames.length - 1, 0)];
        if (this.policy) webUrl(frame.url(), this.policy.hosts);
        this.frame = frame;
        this.invalidate();
        return this.snapshot(command);
      }
      case "open": {
        const url = webUrl(command.url, this.policy?.hosts);
        this.frame = null;
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
      case "inspect": {
        if (this.policy)
          throw new Fault(
            "READ_ONLY",
            "Agent inspection is limited to visible text",
          );
        const { locator } = this.ref(command.ref);
        return locator.evaluate((element) => {
          const secret = (e) =>
            e.type === "password" ||
            /token|password|passwd|pwd|secret|credential|auth|cookie|session|api.?key|private.?key/i.test(
              (e.name || "") + " " + (e.id || ""),
            );
          const attributes = {};
          for (const name of [
            "id",
            "name",
            "type",
            "value",
            "href",
            "onclick",
            "onmousedown",
            "onmouseup",
          ])
            if (element.hasAttribute(name))
              attributes[name] =
                name === "value" && secret(element)
                  ? "[redacted]"
                  : element.getAttribute(name).slice(0, 1000);
          return {
            tag: element.tagName.toLowerCase(),
            attributes,
            ...(element.tagName === "FORM"
              ? {
                  fields: [...element.elements].slice(0, 100).map((e) => ({
                    name: e.name || "",
                    type: e.type || "",
                    value: secret(e)
                      ? "[redacted]"
                      : String(e.value || "").slice(0, 1000),
                    ...(["checkbox", "radio"].includes(e.type)
                      ? { checked: e.checked }
                      : {}),
                  })),
                }
              : {}),
            untrusted: true,
          };
        });
      }
      case "read":
        return this.read(command);
      case "hover": {
        if (this.policy)
          throw new Fault("READ_ONLY", "Agent cannot hover controls");
        const { locator } = this.ref(command.ref);
        await locator.hover({ force: command.force === true });
        this.invalidate();
        return this.snapshot(command);
      }
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
        if (command.method && !["mouse", "dom"].includes(command.method))
          throw new Fault(
            "INVALID_ARGUMENT",
            "click method must be mouse or dom",
          );
        if (this.policy && command.method === "dom")
          throw new Fault("READ_ONLY", "Agent cannot dispatch DOM clicks");
        if (
          command.force === true &&
          (!(await locator.isVisible()) || !(await locator.isEnabled()))
        )
          throw new Fault(
            "CONTROL_UNAVAILABLE",
            "보이고 활성화된 컨트롤만 선택할 수 있습니다.",
          );
        return this.withNavigation(async () => {
          if (
            await this.withDialog(() =>
              command.method === "dom"
                ? locator.evaluate((element) => {
                    if (
                      element.matches(":disabled") ||
                      element.getAttribute("aria-disabled") === "true"
                    )
                      throw new Error("Control is disabled");
                    const rect = element.getBoundingClientRect();
                    const init = {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                      button: 0,
                      clientX: rect.x + rect.width / 2,
                      clientY: rect.y + rect.height / 2,
                    };
                    element.dispatchEvent(
                      new MouseEvent("mousedown", { ...init, buttons: 1 }),
                    );
                    element.dispatchEvent(new MouseEvent("mouseup", init));
                    element.click();
                  })
                : locator.click({ force: command.force === true }),
            )
          )
            return { actionPending: true, dialog: this.dialogState() };
          await this.page.waitForLoadState("domcontentloaded");
          this.invalidate();
          return await this.snapshot(command);
        });
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
      case "check":
      case "uncheck": {
        if (this.policy)
          throw new Fault("READ_ONLY", "Agent cannot change selections");
        const { entry, locator } = this.ref(command.ref);
        if (
          !["checkbox", "radio"].includes(entry.role) ||
          (await locator.count()) !== 1
        )
          throw new Fault(
            "INVALID_CHECKBOX",
            "현재 snapshot의 선택 컨트롤 ref가 필요합니다.",
          );
        const checked = action === "check";
        const result = await locator.evaluate((element, checked) => {
          const input = element.matches("input") ? element : element.control;
          if (
            !input?.matches("input[type=checkbox],input[type=radio]") ||
            input.disabled
          )
            throw new Error("Selection is unavailable");
          if (input.checked !== checked) input.click();
          return input.checked;
        }, checked);
        if (result !== checked)
          throw new Fault("CHECK_FAILED", "선택 상태가 요청과 다릅니다.");
        this.invalidate();
        return this.snapshot(command);
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
          if (await this.withDialog(() => locator.press(command.key)))
            return { actionPending: true, dialog: this.dialogState() };
        } else if (
          await this.withDialog(() => this.page.keyboard.press(command.key))
        )
          return { actionPending: true, dialog: this.dialogState() };
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
          await this.activeDocument()
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
        this.frame = null;
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
        const pages = this.pages.filter(
          (p) => !p.isClosed() && (!this.attached || /^https?:/.test(p.url())),
        );
        const index = bound(command.index, 0, pages.length - 1, 0);
        this.page = pages[index];
        this.frame = null;
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
