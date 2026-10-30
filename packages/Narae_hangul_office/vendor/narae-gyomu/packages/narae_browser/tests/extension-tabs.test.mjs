import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  isConnectionPage,
  connectionTabPlan,
  reuseConnectionPage,
  prepareConnectionTabs,
} from "../src/extension-tabs.mjs";

const seedURL = (
  name = "나래 브라우저",
  relay = "ws://127.0.0.1:12345/extension/abc-def",
) => {
  const url = new URL(
    "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html",
  );
  url.searchParams.set("client", JSON.stringify({ name }));
  url.searchParams.set("mcpRelayUrl", relay);
  url.searchParams.set("token", "synthetic-token");
  return url.href;
};

test("cleanup recognizes only Narae's exact official loopback connection page", () => {
  assert.equal(isConnectionPage(seedURL()), true);
  for (const value of [
    "https://example.com/connect.html",
    seedURL("another client"),
    seedURL(undefined, "ws://example.com/extension/abc-def"),
    seedURL().replace("connect.html", "status.html"),
    seedURL().replace("mmlmfjhmonkocbjadbfplnigmagldckm", "other"),
    "invalid",
  ])
    assert.equal(isConnectionPage(value), false);
});

test("stale plan keeps active clients and normal tabs and restores the previous user tab only if the seed is active", () => {
  const fixture = {
    current: { id: 1, windowId: 7, active: true },
    tabs: [
      { id: 1, windowId: 7, url: seedURL() },
      { id: 2, windowId: 7, url: seedURL() },
      { id: 3, windowId: 7, url: seedURL() },
      {
        id: 4,
        windowId: 7,
        url: "https://example.com/working",
        lastAccessed: 200,
      },
      { id: 5, windowId: 7, url: seedURL("another client"), lastAccessed: 300 },
      {
        id: 6,
        windowId: 8,
        url: "https://example.org/other-window",
        lastAccessed: 400,
      },
    ],
    status: { connections: [{ connectedTabIds: [1, 3] }] },
  };
  assert.deepEqual(connectionTabPlan(fixture), { remove: [2], restore: 4 });
  fixture.current.active = false;
  assert.equal(connectionTabPlan(fixture).restore, undefined);
  assert.deepEqual(connectionTabPlan({ ...fixture, status: {} }), {
    remove: [],
  });
});

test("first requested page reuses the owned connection tab, later pages are new, and disconnect keeps ordinary tabs", async () => {
  let creates = 0,
    disconnected = 0;
  const page = {
    closed: false,
    address: seedURL(),
    url() {
      return this.address;
    },
    async bringToFront() {},
    isClosed() {
      return this.closed;
    },
    async close() {
      this.closed = true;
    },
  };
  const user = {
    url: () => "https://example.com/working",
    isClosed: () => false,
    close() {
      throw Error("user tab must stay open");
    },
  };
  const context = {
    pages: () => [page, user],
    newPage: async () => {
      creates++;
      return user;
    },
  };
  const browser = reuseConnectionPage({
    contexts: () => [context],
    close: async () => {
      disconnected++;
    },
  });
  assert.equal(await context.newPage(), page);
  assert.equal(creates, 0);
  assert.equal(await context.newPage(), user);
  assert.equal(creates, 1);
  page.address = "https://example.com/requested";
  await browser.close();
  assert.equal(page.closed, false);
  assert.equal(disconnected, 1);
  page.address = seedURL();
  await browser.close();
  assert.equal(page.closed, true);
});

test("authenticated cleanup removes dead relay pages, keeps pending/live or unknown pages, scrubs the token and avoids stealing changed focus", async () => {
  const removed = [],
    updated = [];
  let calls = 0,
    replaced;
  const observed = {
    current: { id: 1, active: true, windowId: 7 },
    tabs: [
      { id: 1, windowId: 7, url: seedURL() },
      { id: 2, url: seedURL(undefined, "ws://127.0.0.1:12345/extension/dead") },
      { id: 3, url: seedURL(undefined, "ws://127.0.0.1:12345/extension/abc") },
      { id: 4, url: seedURL(undefined, "ws://127.0.0.1:12345/extension/def") },
      {
        id: 5,
        windowId: 7,
        url: "https://example.com/working",
        lastAccessed: 10,
      },
    ],
    status: { connections: [{ connectedTabIds: [1] }] },
  };
  const page = {
    url: () => seedURL(),
    async evaluate(fn, arg) {
      if (!calls++) return observed;
      return vm.runInNewContext(`(${fn.toString()})(argument)`, {
        argument: arg,
        URL,
        location: { href: seedURL() },
        history: {
          replaceState: (_, __, url) => {
            replaced = String(url);
          },
        },
        AbortSignal,
        fetch: async (url) => {
          if (url.endsWith("/dead")) throw new TypeError("refused");
          if (url.endsWith("/def"))
            throw Object.assign(Error("timeout"), { name: "TimeoutError" });
          return {};
        },
        chrome: {
          tabs: {
            getCurrent: async () => ({ active: false }),
            remove: async (id) => removed.push(id),
            update: async (id) => updated.push(id),
          },
        },
      });
    },
  };
  const result = await prepareConnectionTabs({
    contexts: () => [{ pages: () => [page] }],
  });
  assert.equal(result.removed, 1);
  assert.deepEqual(removed, [2]);
  assert.deepEqual(updated, []);
  assert(!replaced.includes("synthetic-token"));
});
