# Implementation contract

- Independent Node 20+ CLI, Playwright Core, installed Chrome/Edge or explicit executable. No Hermes or cloud-model requirement.
- Per-session loopback daemon keeps an isolated browser/context alive across CLI invocations; local private state, random bearer token, serialized commands and idle shutdown.
- Commands and errors are JSON. Compact snapshot returns bounded element references, accessible labels, URL/title and version; stale references fail rather than click another element.
- Commands: doctor, schema, open, snapshot, click, fill, press, select, scroll, wait, read, tabs, tab, screenshot, back, close, run.
- OpenAI-compatible local models (Ollama/llama.cpp/LM Studio): bounded JSON agent loop without dependence on native tool calling; explicit hosts and read-only model actions; page data is untrusted.
- Naver news acceptance: real browser collects three distinct article URLs, extracts actual article bodies, local small model summarizes each with source URL and saved evidence; failure never becomes fabricated news.
- Acceptance distinguishes deterministic browser workflow + model summarization from a model autonomously selecting browser actions.
- Existing Chrome tabs are available only through an explicit extension/CDP connection; no profile-file copying, browser security bypass, CAPTCHA solving, login credential export, arbitrary JS/shell tool, or default remote service exposure.
- Test local deterministic fixture interaction, persistence, stale refs, structured errors, daemon auth, output caps, model JSON/error validation, URL/host policies and Naver live workflow separately.
