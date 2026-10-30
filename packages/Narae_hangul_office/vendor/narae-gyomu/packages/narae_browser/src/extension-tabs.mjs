const extensionId = "mmlmfjhmonkocbjadbfplnigmagldckm";
const clientName = "나래 브라우저";

export function isConnectionPage(value) {
  try {
    const url = new URL(value);
    const relay = new URL(url.searchParams.get("mcpRelayUrl"));
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === extensionId &&
      url.pathname === "/connect.html" &&
      JSON.parse(url.searchParams.get("client"))?.name === clientName &&
      relay.protocol === "ws:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(relay.hostname) &&
      /^\/extension\/[a-f0-9-]+$/i.test(relay.pathname)
    );
  } catch {
    return false;
  }
}

export function connectionTabPlan({ current, tabs, status }) {
  if (!current || !Array.isArray(status?.connections)) return { remove: [] };
  const active = new Set(
    status.connections.flatMap((c) => c.connectedTabIds || []),
  );
  const remove = tabs
    .filter(
      (tab) =>
        tab.id !== current.id &&
        isConnectionPage(tab.url) &&
        !active.has(tab.id),
    )
    .map((tab) => tab.id);
  const previous =
    current.active &&
    tabs
      .filter(
        (tab) =>
          tab.id !== current.id &&
          tab.windowId === current.windowId &&
          !tab.url?.startsWith(`chrome-extension://${extensionId}/`) &&
          !active.has(tab.id),
      )
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  return { remove, restore: previous?.id };
}

// Runs only in our authenticated extension page. Other clients' live connection
// tabs and every ordinary user tab are excluded from cleanup.
export async function prepareConnectionTabs(browser) {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => isConnectionPage(p.url()));
  if (!page) return { removed: 0 };
  const observed = await page.evaluate(async () => ({
    current: await chrome.tabs.getCurrent(),
    tabs: await chrome.tabs.query({}),
    status: await chrome.runtime.sendMessage({ type: "getConnectionStatus" }),
  }));
  const plan = connectionTabPlan(observed);
  plan.remove = plan.remove.map((id) => ({
    id,
    relay: new URL(observed.tabs.find((t) => t.id === id).url).searchParams
      .get("mcpRelayUrl")
      .replace(/^ws:/, "http:"),
  }));
  return page.evaluate(async ({ remove, restore }) => {
    const url = new URL(location.href);
    url.searchParams.delete("token");
    history.replaceState(null, "", url);
    let removed = 0;
    for (const { id, relay } of remove) {
      // A pending permission page is not connected yet. Keep it while its relay
      // is alive; an HTTP probe never opens or replaces a relay WebSocket.
      let alive = true;
      try {
        await fetch(relay, {
          mode: "no-cors",
          cache: "no-store",
          signal: AbortSignal.timeout(500),
        });
      } catch (error) {
        alive = error.name === "TimeoutError" || error.name === "AbortError";
      }
      if (!alive)
        try {
          await chrome.tabs.remove(id);
          removed++;
        } catch {}
    }
    // Do not change focus if the user already switched away during connection.
    if (restore !== undefined && (await chrome.tabs.getCurrent())?.active)
      await chrome.tabs.update(restore, { active: true }).catch(() => {});
    return { removed };
  }, plan);
}

export async function closeConnectionPages(browser) {
  for (const context of browser.contexts())
    for (const page of context.pages())
      if (!page.isClosed() && isConnectionPage(page.url()))
        await page.close().catch(() => {});
}

export function reuseConnectionPage(browser) {
  for (const context of browser.contexts()) {
    const createPage = context.newPage.bind(context);
    let taken = false;
    context.newPage = async (...args) => {
      if (!taken) {
        taken = true;
        const seed = context
          .pages()
          .find((p) => !p.isClosed() && isConnectionPage(p.url()));
        if (seed) {
          // newPage normally activates its tab. Match that only when a caller
          // actually opens a website; idle connection never selects this tab.
          await seed.bringToFront();
          return seed;
        }
      }
      return createPage(...args);
    };
  }
  const close = browser.close.bind(browser);
  browser.close = async (...args) => {
    await closeConnectionPages(browser);
    return close(...args);
  };
  return browser;
}
