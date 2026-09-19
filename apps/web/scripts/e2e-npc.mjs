/** NPC playthrough smoke test. Node 22+; no extra browser dependency.
 * Start dev:watch, then: node apps/web/scripts/e2e-npc.mjs
 * Optional: CIVILCRAFT_URL, CHROME_PATH. Uses an isolated temporary profile.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.env.CIVILCRAFT_URL ?? "http://127.0.0.1:5173/";
const chrome =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
assert(chrome, "Set CHROME_PATH to a Chrome/Edge executable");
const artifacts = mkdtempSync(path.join(tmpdir(), "civilcraft-npc-e2e-"));
const profile = path.join(artifacts, "profile");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => process.stdout.write(`${message}\n`);
const child = spawn(
  chrome,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,900",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let launchError;
child.on("error", (error) => {
  launchError = error;
});
let socket;
let call;
const errors = [];
let intercepted = null;

async function waitFor(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const value = await check();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timeout: ${label}`);
}

try {
  const portFile = path.join(profile, "DevToolsActivePort");
  await waitFor(() => existsSync(portFile), "Chrome startup");
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.method === "Fetch.requestPaused") intercepted = message.params;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const wait = (expression, timeout) => waitFor(() => evaluate(expression), expression, timeout);
  const click = async (selector) => {
    const point = await wait(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled || getComputedStyle(el).visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!hit || !el.contains(hit)) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    assert(point, `Cannot click ${selector}`);
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  };
  const screenshot = async (name) => {
    const result = await call("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: base });
  await wait(`!!document.querySelector('.title-screen__cta')`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-npc-id]').length`), 0);
  await click(".title-screen__cta");
  await wait(`!!document.querySelector('.game-menu__mode')`);
  await click(".game-menu__mode");
  await wait(`document.querySelector('.game-menu__start')?.disabled === false`, 60_000);
  await click(".game-menu__start");
  await wait(`document.querySelectorAll('[data-npc-id]').length === 2`, 60_000);
  await wait(
    `[...document.querySelectorAll('[data-npc-id]')].every(el => getComputedStyle(el).visibility === 'visible')`,
  );
  await screenshot("map");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await wait(`document.querySelectorAll('[data-npc-id]').length === 2 && [...document.querySelectorAll('[data-npc-id]')].every(el => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).visibility === 'visible' && r.left >= 0 && r.right <= innerWidth
      && document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)?.closest('[data-npc-id]') === el;
  })`);
  await screenshot("mobile-map");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(200);
  log("PASS: two map markers; no NPCs in lobby");

  await click('[data-npc-id="resident"]');
  await wait(`!!document.querySelector('.npc-dialog[open]')`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.npc-dialog__actions button').length`),
    3,
  );
  // Native modal keeps pointer hit testing and focus off the map.
  assert(await evaluate(`document.activeElement.closest('.npc-dialog') !== null`));
  assert(await evaluate(`!!document.querySelector('.npc-dialog:modal')`));
  assert(
    await evaluate(
      `(() => { const r = document.querySelector('[data-npc-id="resident"]').getBoundingClientRect(); return !document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)?.closest('[data-npc-id]'); })()`,
    ),
  );
  const before = await evaluate(`JSON.stringify(window.__civilcraftE2E.getFlood())`);
  await evaluate(`window.__civilcraftE2E.advance(1)`);
  assert.notEqual(await evaluate(`JSON.stringify(window.__civilcraftE2E.getFlood())`), before);
  assert(await evaluate(`!!document.querySelector('.npc-dialog[open]')`));
  log("PASS: modal blocks map input; simulation continues");

  await click(".npc-dialog__actions button");
  await wait(`document.querySelectorAll('.npc-dialog__level').length === 1`);
  assert(await evaluate(`document.querySelector('.npc-dialog__deeper').disabled`));
  for (const level of [2, 3]) {
    await wait(`document.querySelector('.npc-dialog__deeper')?.disabled === false`);
    await click(".npc-dialog__deeper");
    await wait(`document.querySelectorAll('.npc-dialog__level').length === ${level}`);
  }
  await screenshot("resident-level3");
  const modes = await evaluate(
    `[...document.querySelectorAll('[data-answer-mode]')].map(el => el.dataset.answerMode)`,
  );
  if (process.env.NPC_REQUIRE_LLM === "1")
    assert(modes.includes("ollama"), "Expected a real Ollama answer");
  log(`Answer modes: ${modes.join(", ")}`);
  await click(".npc-dialog__deeper");
  await wait(
    `!document.querySelector('.npc-dialog') && !!document.querySelector('[data-npc-id="builder"].is-recommended')`,
  );
  await click(".npc-guide button");
  // Cesium updates HTML marker positions on the next postRender.
  await sleep(300);
  await click('[data-npc-id="builder"]');
  await wait(`document.querySelector('#npc-dialog-title')?.textContent === 'けんさん'`);
  log("PASS: 3 hint levels, cooldown, referral highlight, camera focus, experienced resident");

  await click(".npc-dialog__actions button");
  for (const level of [2, 3]) {
    await wait(`document.querySelector('.npc-dialog__deeper')?.disabled === false`);
    await click(".npc-dialog__deeper");
    await wait(`document.querySelectorAll('.npc-dialog__level').length === ${level}`);
  }
  assert.equal(await evaluate(`document.querySelector('.npc-dialog__deeper')`), null);
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await screenshot("mobile-dialogue");
  assert(
    await evaluate(
      `(() => {const r = document.querySelector('.npc-dialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;})()`,
    ),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 844,
    height: 390,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await screenshot("landscape-dialogue");
  assert(
    await evaluate(`(() => {
    const history = document.querySelector('.npc-dialog__history').getBoundingClientRect();
    const actions = document.querySelector('.npc-dialog__actions').getBoundingClientRect();
    return history.bottom <= actions.top + 1;
  })()`),
    "Landscape history must not overlap actions",
  );
  assert(
    await evaluate(
      `(() => {const el = document.querySelector('.npc-dialog'); el.scrollTop = el.scrollHeight; const r = el.querySelector('.npc-dialog__actions button:last-child').getBoundingClientRect(); return r.bottom <= innerHeight;})()`,
    ),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await wait(`!document.querySelector('.npc-dialog')`);
  await click('[data-npc-id="builder"]');
  await wait(`!!document.querySelector('.npc-dialog[open]')`);
  assert.equal(await evaluate(`document.querySelectorAll('.npc-dialog__level').length`), 0);
  log("PASS: experienced level 3, responsive dialogue, Escape and discarded history");

  await evaluate(`window.__civilcraftE2E.startRain()`);
  await wait(
    `window.__civilcraftE2E.getFlood().phase === 'disaster' && !document.querySelector('.npc-dialog')`,
  );
  await click('[data-npc-id="builder"]');
  await wait(`!!document.querySelector('.npc-dialog[open]')`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.npc-dialog__actions button').length`),
    0,
  );
  await evaluate(`window.__civilcraftE2E.advance(120)`);
  await wait(`!!document.querySelector('.result-panel') && !document.querySelector('.npc-dialog')`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-npc-id]').length`), 0);
  assert(await evaluate(`document.querySelectorAll('.npc-sources a').length === 5`));
  assert(
    await evaluate(
      `[...document.querySelectorAll('.npc-sources a')].every(a => a.href.startsWith('https://'))`,
    ),
  );
  assert(
    await evaluate(
      `!document.querySelector('.npc-sources')?.textContent.includes('内水ハザードマップ')`,
    ),
  );
  await click(".npc-sources summary");
  await screenshot("result");
  await click(".result-panel__primary");
  await wait(`!!document.querySelector('.game-menu__start')`);
  await click(".game-menu__mode");
  await wait(`document.querySelector('.game-menu__start')?.disabled === false`);
  await click(".game-menu__start");
  await wait(`window.__civilcraftE2E.getFlood().phase === 'preparation'`);
  if (process.env.NPC_REQUIRE_LLM === "1") {
    await call("Fetch.enable", {
      patterns: [{ urlPattern: "*/api/npc/conversations/*/answers", requestStage: "Request" }],
    });
    await click('[data-npc-id="resident"]');
    await wait(`!!document.querySelector('.npc-dialog[open]')`);
    await click(".npc-dialog__actions button");
    await waitFor(() => intercepted, "intercept pending answer");
    assert(
      await evaluate(
        `document.querySelector('.npc-dialog [role="status"]')?.textContent.includes('考え中')`,
      ),
    );
    await evaluate(`window.__civilcraftE2E.startRain()`);
    await wait(
      `!document.querySelector('.npc-dialog') && window.__civilcraftE2E.getFlood().phase === 'disaster'`,
    );
    await call("Fetch.failRequest", {
      requestId: intercepted.requestId,
      errorReason: "Aborted",
    }).catch(() => {});
    await call("Fetch.disable");
    await sleep(300);
    assert.equal(await evaluate(`document.querySelector('.npc-dialog')`), null);
    log("PASS: a pending answer is canceled on phase change and does not record sources");
  }
  await evaluate(`window.__civilcraftE2E.startRain()`);
  await wait(`window.__civilcraftE2E.getFlood().phase === 'disaster'`);
  await evaluate(`window.__civilcraftE2E.advance(120)`);
  await wait(`!!document.querySelector('.result-panel')`);
  assert.equal(await evaluate(`document.querySelector('.npc-result-note')`), null);
  assert.deepEqual(errors, [], "Unexpected browser exceptions");
  log(
    "PASS: phase transitions close dialogue, disaster has no choices, results show only used sources, new game resets",
  );
  log("NPC E2E PASSED");
} catch (error) {
  if (call) {
    try {
      const result = await call("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(artifacts, "failure.png"), Buffer.from(result.data, "base64"));
    } catch {
      /* Preserve original failure. */
    }
  }
  process.stderr.write(`${error.stack}\n${JSON.stringify(errors)}\n`);
  process.exitCode = 1;
} finally {
  if (call) await call("Browser.close").catch(() => {});
  socket?.close();
  child.kill();
  log(`Artifacts (isolated profile + screenshots): ${artifacts}`);
}
