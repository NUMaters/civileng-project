/**
 * CivilCraft フロント一連動作テスト（Chrome CDP）。
 * タイトル → メニュー → スタート → 配置 → 大雨 → 結果（クリア）まで。
 *
 * Usage: node apps/web/scripts/e2e-playthrough.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("/tmp/node_modules/ws");

const BASE = process.env.CIVILCRAFT_URL ?? "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9455 + Math.floor(Math.random() * 40);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    call(method, params = {}) {
      const myId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(myId, { resolve, reject });
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    },
  };
}

async function waitPort(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error("Chrome CDP not ready");
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "evaluate failed");
  }
  return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${expression}`);
}

async function main() {
  const health = await fetch(BASE).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Vite not reachable at ${BASE}`);
  }

  const userData = `/tmp/civilcraft-e2e-${PORT}`;
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });

  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userData}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const log = [];
  const step = (name, detail) => {
    const line = detail === undefined ? `✓ ${name}` : `✓ ${name}: ${detail}`;
    log.push(line);
    console.log(line);
  };

  try {
    await waitPort(PORT);
    const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = pages.find((p) => p.type === "page") || pages[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const client = cdp(ws);
    await client.call("Runtime.enable");
    await client.call("Page.enable");

    await client.call("Page.navigate", { url: BASE });
    await waitFor(
      client,
      `document.querySelector('.title-screen__logo')?.textContent === 'CivilCraft'`,
    );
    step("タイトル表示");

    await evaluate(client, `document.querySelector('.title-screen__cta')?.click()`);
    await waitFor(
      client,
      `document.querySelector('.game-menu__title')?.textContent === 'モード選択'`,
    );
    const howtoOpen = await evaluate(client, `!!document.querySelector('.howto-modal')`);
    if (howtoOpen) throw new Error("遊び方が自動表示されている");
    step("メニュー表示（遊び方は手動）");

    await evaluate(client, `document.querySelectorAll('.game-menu__mode')[0]?.click()`);
    await waitFor(
      client,
      `document.querySelector('.game-menu__start')?.disabled === false`,
      60_000,
    );
    step("シングル読込完了");

    await evaluate(client, `document.querySelector('.game-menu__start')?.click()`);
    await waitFor(client, `!!document.querySelector('.flood-hud')`, 60_000);
    await waitFor(
      client,
      `document.querySelector('.flood-hud__phase')?.textContent === '準備中'`,
      30_000,
    );
    step("ゲーム開始（準備中）");

    await waitFor(client, `!!window.__civilcraftE2E`, 10_000);
    const placed = await evaluate(
      client,
      `(() => {
        const e2e = window.__civilcraftE2E;
        const a = e2e.place('levee', 140.37776, 37.359853, 140);
        const b = e2e.place('levee', 140.37492, 37.357985, 155);
        const c = e2e.place('levee', 140.38349, 37.364066, 130);
        const d = e2e.place('revetment', 140.385275, 37.371045, 110);
        const e = e2e.place('drainage-pump', 140.3791, 37.36035, 50);
        const f = e2e.place('retention-basin', 140.3762, 37.3584, 90);
        return {
          ok: !!(a && b && c && d && e && f),
          ids: [a?.id, b?.id, c?.id, d?.id, e?.id, f?.id],
          placementCount: e2e.placementCount?.() ?? null,
        };
      })()`,
    );
    if (!placed?.ok) {
      throw new Error(`配置失敗: ${JSON.stringify(placed)}`);
    }
    step("適所混成で6施設を配置", JSON.stringify(placed.ids));

    // React の配置反映を待つ
    await sleep(500);
    await waitFor(
      client,
      `window.__civilcraftE2E.placementCount() >= 6`,
      10_000,
    );

    await evaluate(client, `window.__civilcraftE2E.startRain()`);
    await waitFor(
      client,
      `window.__civilcraftE2E.getFlood().phase === 'disaster'`,
      10_000,
    );
    step("大雨スタート");

    // headless では rAF が止まることがあるため、シミュレーションを直接進める。
    let result = null;
    for (let i = 0; i < 40; i += 1) {
      result = await evaluate(
        client,
        `(() => {
          const s = window.__civilcraftE2E.advance(3);
          return {
            phase: s.phase,
            damage: s.damagePercent,
            clear: s.isClear,
            placements: window.__civilcraftE2E.placementCount(),
            badge: document.querySelector('.result-panel__badge')?.textContent || null,
            title: document.querySelector('.result-panel h2')?.textContent || null,
          };
        })()`,
      );
      if (result.phase === "result") break;
      await sleep(50);
    }

    if (result?.phase !== "result") {
      throw new Error(`結果画面に到達できない: ${JSON.stringify(result)}`);
    }
    step(
      "結果画面到達",
      `damage=${Number(result.damage).toFixed(2)}% placements=${result.placements}`,
    );

    if (result.clear !== true) {
      throw new Error(`クリア失敗: ${JSON.stringify(result)}`);
    }
    await waitFor(
      client,
      `document.querySelector('.result-panel__badge')?.textContent === 'CLEAR'`,
      5_000,
    );
    step("ミッションクリア", result.title ?? result.badge);

    await evaluate(client, `document.querySelector('.result-panel__primary')?.click()`);
    await waitFor(
      client,
      `document.querySelector('.game-menu__title')?.textContent === 'モード選択'`,
      10_000,
    );
    step("メニューへ復帰");

    console.log("\nE2E PLAYTHROUGH PASSED");
    console.log(log.join("\n"));
    ws.close();
    child.kill("SIGKILL");
    process.exit(0);
  } catch (error) {
    console.error("\nE2E PLAYTHROUGH FAILED");
    console.error(error);
    console.error(log.join("\n"));
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

await main();
