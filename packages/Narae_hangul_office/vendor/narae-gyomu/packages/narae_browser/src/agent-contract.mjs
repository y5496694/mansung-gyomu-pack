import { webUrl } from "./browser.mjs";
const branch = (action, properties = {}, required = []) => ({
  type: "object",
  properties: { action: { const: action }, ...properties },
  required: ["action", ...required],
  additionalProperties: false,
});
export function knownUrls(goal, hosts, observations = []) {
  const result = [];
  const add = (value) => {
    try {
      const url = webUrl(value, hosts);
      if (!/[{}<>"\s]/.test(value) && !result.includes(url)) result.push(url);
    } catch {}
  };
  for (const match of goal.matchAll(/https?:\/\/[^\s<>"`]+/g))
    add(match[0].replace(/[),.;]+$/, ""));
  for (const observation of observations) {
    if (observation.url) add(observation.url);
    for (const e of [
      ...(observation.elements || []),
      ...(observation.links || []),
    ])
      add(e.href || e.url);
  }
  for (const host of hosts) add("https://" + host + "/");
  return result.slice(0, 50);
}
export function actionSchema(urls, { opened = false, read = false } = {}) {
  const open = branch("open", { url: { type: "string", enum: urls } }, ["url"]);
  if (!opened) return { oneOf: [open] };
  return {
    oneOf: [
      branch("read"),
      ...(read
        ? [
            branch("finish", { answer: { type: "string", maxLength: 2000 } }, [
              "answer",
            ]),
          ]
        : []),
      branch("click", { ref: { type: "string" } }, ["ref"]),
      branch("snapshot"),
      open,
    ],
  };
}
