import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ModelClient } from "../src/model.mjs";
async function mock(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn("http://127.0.0.1:" + server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
const response = (res, d, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(d));
};
test("Ollama native adapter disables thinking, bounds context and validates returned identity", async () => {
  let body, url;
  await mock(
    async (req, res) => {
      url = req.url;
      let raw = "";
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw);
      response(res, {
        model: "test-small",
        done_reason: "stop",
        message: { content: '{"action":"read"}' },
        prompt_eval_count: 10,
        eval_count: 5,
      });
    },
    async (baseUrl) => {
      const client = new ModelClient({
        provider: "ollama",
        model: "test-small",
        baseUrl,
      });
      assert.deepEqual(
        await client.json([{ role: "user", content: "fixture" }]),
        { action: "read" },
      );
      assert.equal(url, "/api/chat");
      assert.equal(body.think, false);
      assert.equal(body.format, "json");
      assert.equal(body.options.num_ctx, 4096);
      assert.equal(client.usage[0].model, "test-small");
    },
  );
});
test("OpenAI-compatible adapter supports local llama.cpp/LM Studio style endpoint", async () => {
  await mock(
    async (req, res) => {
      assert.equal(req.url, "/v1/chat/completions");
      response(res, {
        model: "local-small",
        choices: [
          { finish_reason: "stop", message: { content: '{"action":"read"}' } },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      });
    },
    async (base) => {
      const client = new ModelClient({
        baseUrl: base + "/v1",
        model: "local-small",
      });
      assert.equal((await client.json([])).action, "read");
      assert.equal(client.usage[0].promptTokens, 12);
    },
  );
});
test("HTTP failure and truncated outputs fail, never fabricate summary or switch provider", async () => {
  await mock(
    (req, res) => response(res, {}, 503),
    async (baseUrl) => {
      await assert.rejects(
        new ModelClient({ baseUrl, model: "x" }).json([]),
        (e) => e.code === "MODEL_HTTP",
      );
    },
  );
  await mock(
    (req, res) =>
      response(res, {
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }),
    async (baseUrl) => {
      await assert.rejects(
        new ModelClient({ baseUrl, model: "x" }).json([]),
        (e) => e.code === "MODEL_TRUNCATED",
      );
    },
  );
});
test("model identity mismatch fails closed", async () => {
  for (const provider of ["ollama", "openai"]) {
    let requests = 0;
    await mock(
      (req, res) => {
        requests++;
        response(res, {
          model: "different",
          message: { content: "{}" },
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        });
      },
      async (baseUrl) => {
        const client = new ModelClient({ baseUrl, provider, model: "x" });
        await assert.rejects(
          client.json([]),
          (e) => e.code === "MODEL_IDENTITY",
        );
        assert.equal(requests, 1);
        assert.deepEqual(client.usage, []);
      },
    );
  }
});
