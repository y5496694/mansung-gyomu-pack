import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

test("separate CLI calls inspect and resolve iframe confirms exactly once without hanging", async () => {
  assert.notEqual(
    process.env.NARAE_TEST_EXTENSION,
    "1",
    "확인창 회귀시험은 사용 중인 Chrome을 제어하지 않습니다. NARAE_TEST_EXTENSION을 해제하고 전용 시험 브라우저로 실행하세요.",
  );
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "narae-dialog-"));
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      req.url === "/frame"
        ? `<button onclick="if(confirm('합성 문서 회수?')){document.querySelector('output').textContent=++window.count;alert('합성 처리 완료')}else document.querySelector('output').textContent='취소'">회수</button><output>0</output><script>window.count=0</script>`
        : `<title>확인창 시험</title><input type="checkbox" id="pick" style="display:none"><label for="pick">문서 선택</label><a onmousedown="window.events='down'" onmouseup="window.events+='up'" onclick="if(window.events==='downup')document.querySelector('label').textContent='변경 완료'">명령 링크</a><button onclick="window.open('/popup')">의견 팝업</button><iframe src="/frame"></iframe>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const cli = fileURLToPath(
    new URL("../bin/narae-browser.mjs", import.meta.url),
  );
  const invoke = (command, ok = true) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [cli, "run", "-", "--session", "dialog"],
        {
          env: { ...process.env, NARAE_BROWSER_HOME: temp },
          windowsHide: true,
          timeout: 15000,
        },
        (error, stdout) => {
          try {
            const result = JSON.parse(stdout);
            assert.equal(result.ok, ok, JSON.stringify({ command, result }));
            resolve(result);
          } catch (failure) {
            reject(failure);
          }
        },
      );
      child.stdin.end(JSON.stringify(command));
    });
  try {
    const initial = (
      await invoke({
        action: "open",
        url: `http://127.0.0.1:${server.address().port}`,
      })
    ).data;
    const pick = initial.elements.find((e) => e.role === "checkbox");
    assert.equal(pick.checked, false);
    const picked = (await invoke({ action: "check", ref: pick.ref })).data;
    assert.equal(
      picked.elements.find((e) => e.role === "checkbox").checked,
      true,
    );
    const unpicked = (
      await invoke({
        action: "uncheck",
        ref: picked.elements.find((e) => e.role === "checkbox").ref,
      })
    ).data;
    assert.equal(
      unpicked.elements.find((e) => e.role === "checkbox").checked,
      false,
    );
    const linked = unpicked.elements.find((e) => e.label === "명령 링크");
    assert(linked);
    await invoke({ action: "click", ref: linked.ref, method: "dom" });
    const filtered = (
      await invoke({
        action: "snapshot",
        selector: "label",
        filter: "변경 완료",
      })
    ).data;
    assert.equal(filtered.elements.length, 1);
    const frames = (await invoke({ action: "frames" })).data.frames;
    const frame = frames.find((frame) => frame.url.endsWith("/frame"));
    assert(frame);
    let snapshot = (await invoke({ action: "frame", index: frame.index })).data;
    let clicked = (
      await invoke({
        action: "click",
        force: true,
        ref: snapshot.elements.find((e) => e.label === "회수").ref,
      })
    ).data;
    assert.equal(clicked.actionPending, true);
    assert.equal(clicked.dialog.message, "합성 문서 회수?");
    const decide = (dialog, decision, message = dialog.message) =>
      invoke(
        {
          action: "dialog",
          decision,
          expectedId: dialog.id,
          expectedMessage: message,
        },
        message === dialog.message,
      );
    await decide(clicked.dialog, "accept", "다른 문서 회수?");
    assert.equal(
      (await invoke({ action: "read" }, false)).error.code,
      "DIALOG_PENDING",
    );
    assert.equal((await decide(clicked.dialog, "dismiss")).data.handled, true);
    assert.match((await invoke({ action: "read" })).data.text, /취소/);
    snapshot = (await invoke({ action: "snapshot" })).data;
    clicked = (
      await invoke({
        action: "click",
        force: true,
        ref: snapshot.elements.find((e) => e.label === "회수").ref,
      })
    ).data;
    const accepted = (await decide(clicked.dialog, "accept")).data;
    assert.equal(accepted.dialog.message, "합성 처리 완료");
    await decide(accepted.dialog, "accept");
    assert.match((await invoke({ action: "read" })).data.text, /1$/);
    assert.equal(
      (
        await invoke(
          {
            action: "dialog",
            decision: "accept",
            expectedId: clicked.dialog.id,
            expectedMessage: clicked.dialog.message,
          },
          false,
        )
      ).error.code,
      "DIALOG_MISMATCH",
    );
    assert.equal((await invoke({ action: "dialog" })).data.dialog, null);
    const main = (await invoke({ action: "frame", index: 0 })).data;
    await invoke({
      action: "click",
      ref: main.elements.find((e) => e.label === "의견 팝업").ref,
    });
    const tabs = (await invoke({ action: "tabs" })).data.tabs;
    const popup = tabs.find((tab) => tab.url.endsWith("/popup"));
    assert(
      popup,
      "A post-confirmation workflow may continue in a separate tab",
    );
    const popupState = (await invoke({ action: "tab", index: popup.index }))
      .data;
    assert(popupState.url.endsWith("/popup"));
    assert(popupState.elements.some((e) => e.label === "의견 팝업"));
  } finally {
    await invoke({ action: "close" }).catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert(temp.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
