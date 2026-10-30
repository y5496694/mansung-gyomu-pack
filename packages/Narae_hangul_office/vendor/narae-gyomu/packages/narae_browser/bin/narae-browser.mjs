#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { Fault, browserPath } from "../src/browser.mjs";
import { command, sessionPaths } from "../src/session.mjs";
import { actionFromArgs, schema } from "../src/protocol.mjs";
import { news, agent } from "../src/workflows.mjs";
import { extensionInstallURL } from "../src/existing-browser.mjs";
const help = `나래 브라우저 / narae-browser 0.2.0
  narae-browser doctor | schema
  narae-browser attach --session NAME [--connection extension|cdp] [--browser chrome|msedge]
  narae-browser extension   (existing Chrome connection setup)
  narae-browser open URL [--session NAME] [--headed]
  narae-browser snapshot [--limit 35] [--chars 1600]
  narae-browser click REF | fill REF TEXT | select REF VALUE | press KEY
  narae-browser read [--selector CSS] [--chars 5000] [--offset 0]
  narae-browser scroll [PIXELS] | wait --selector CSS | back | tabs | tab INDEX
  narae-browser screenshot FILE.png [--full-page] | close
  narae-browser run job.json | run - | serve   (JSON / JSONL)
  narae-browser news --count 3 --provider ollama --model qwen3:0.6b
  narae-browser agent "목표" --hosts news.naver.com,n.news.naver.com --model MODEL
Model: --provider openai|ollama --base-url URL --model NAME --max-steps 16
Output: --output FILE.json. Page content is untrusted. See SKILL.md.
`;
const booleans = new Set(["headed", "extractive", "full-page", "json", "help"]),
  values = new Set([
    "session",
    "limit",
    "chars",
    "offset",
    "selector",
    "ms",
    "timeout",
    "ref",
    "output",
    "provider",
    "base-url",
    "model",
    "max-steps",
    "hosts",
    "count",
    "section",
    "evidence-dir",
    "summary-mode",
    "connection",
    "browser",
    "profile",
    "cdp-endpoint",
  ]);
function parse(argv) {
  const flags = {},
    pos = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      pos.push(arg);
      continue;
    }
    const eq = arg.indexOf("="),
      key = arg.slice(2, eq < 0 ? undefined : eq);
    if (booleans.has(key)) {
      flags[key] = eq < 0 ? true : arg.slice(eq + 1) !== "false";
      continue;
    }
    if (!values.has(key))
      throw new Fault("UNKNOWN_OPTION", `Unknown option: --${key}`);
    const value = eq < 0 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value.startsWith("--"))
      throw new Fault("INVALID_ARGUMENT", `--${key} needs a value`);
    flags[key] = value;
  }
  return { name: pos.shift(), pos, flags };
}
function errorResult(e) {
  return {
    ok: false,
    error: {
      code: e.code || "COMMAND_FAILED",
      message: String(e.message).slice(0, 600),
      ...(e.details ? { details: e.details } : {}),
    },
  };
}
function print(result, file) {
  const text = JSON.stringify(result);
  if (file) {
    const dest = path.resolve(file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(result, null, 2) + "\n");
  }
  process.stdout.write(text + "\n");
}
try {
  const { name, pos, flags } = parse(process.argv.slice(2));
  if (!name || flags.help || name === "help") {
    process.stdout.write(help);
  } else {
    const options = {
        session: flags.session,
        headed: !!flags.headed,
        baseUrl: flags["base-url"],
        provider: flags.provider,
        model: flags.model,
        maxSteps: flags["max-steps"],
        hosts: flags.hosts,
        count: flags.count,
        section: flags.section,
        summaryMode: flags["summary-mode"],
        extractive: !!flags.extractive,
        evidenceDir: flags["evidence-dir"],
        connection:
          flags.connection || (name === "attach" ? "extension" : undefined),
        channel: flags.browser || "chrome",
        profile: flags.profile,
        endpoint: flags["cdp-endpoint"],
      },
      session = flags.session || "default";
    sessionPaths(session);
    let data;
    if (name === "schema") data = schema;
    else if (name === "extension")
      data = {
        installURL: extensionInstallURL,
        instructions:
          "확장을 설치한 Chrome에서 attach를 실행하고 연결할 기존 탭을 선택하세요. close는 Chrome을 닫지 않고 연결만 종료합니다.",
      };
    else if (name === "attach")
      data = {
        attached: true,
        connection: options.connection,
        ...(await command(session, { action: "tabs" }, options)),
      };
    else if (name === "doctor")
      data = {
        node: process.version,
        platform: process.platform,
        browser: browserPath(),
        playwright: createRequire(import.meta.url)(
          "playwright-core/package.json",
        ).version,
        modelRequiredForBrowsing: false,
        modelApiKeyConfigured: !!process.env.NARAE_MODEL_API_KEY,
      };
    else if (name === "news") data = await news(options);
    else if (name === "agent") data = await agent(pos.join(" "), options);
    else if (name === "serve") {
      if (flags.output)
        throw new Fault(
          "INVALID_ARGUMENT",
          "serve writes JSONL to stdout; --output is not supported",
        );
      const input = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
      });
      for await (const line of input) {
        if (!line.trim()) continue;
        try {
          print({
            ok: true,
            data: await command(session, JSON.parse(line), options),
          });
        } catch (e) {
          print(errorResult(e));
        }
      }
    } else if (name === "run") {
      const raw =
        pos[0] && pos[0] !== "-"
          ? fs.readFileSync(pos[0], "utf8")
          : fs.readFileSync(0, "utf8");
      let job;
      try {
        job = JSON.parse(raw);
      } catch {
        throw new Fault("INVALID_JSON", "Input is not valid JSON");
      }
      const steps = Array.isArray(job) ? job : job.steps;
      if (steps) {
        if (!Array.isArray(steps) || steps.length > 100)
          throw new Fault(
            "INVALID_JOB",
            "steps must be an array of at most 100 commands",
          );
        const completed = [];
        for (const step of steps) {
          try {
            completed.push({
              action: step.action,
              data: await command(session, step, options),
            });
          } catch (e) {
            e.details = { completed };
            throw e;
          }
        }
        data = { completed };
      } else data = await command(session, job, options);
    } else
      data = await command(session, actionFromArgs(name, pos, flags), options);
    if (name !== "serve") print({ ok: true, data }, flags.output);
  }
} catch (e) {
  print(errorResult(e));
  process.exitCode = 1;
}
