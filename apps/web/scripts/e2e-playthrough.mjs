/**
 * CivilCraft フロント一連動作テスト（Chrome CDP）。
 * タイトル → メニュー → スタート → 配置 → 大雨 → 結果（クリア）まで。
 *
 * Usage: node apps/web/scripts/e2e-playthrough.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.CIVILCRAFT_URL ?? "http://127.0.0.1:5173/";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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

/** Node 22 の標準 WebSocket を ws 互換の最小APIへ変換する。 */
function connectWebSocket(url) {
  const socket = new WebSocket(url);
  const api = {
    on(event, handler) {
      socket.addEventListener(event, (messageEvent) => {
        if (event === "message") {
          handler(messageEvent.data);
        } else {
          handler(messageEvent);
        }
      });
      return api;
    },
    once(event, handler) {
      const listener = (messageEvent) => {
        socket.removeEventListener(event, listener);
        if (event === "message") {
          handler(messageEvent.data);
        } else {
          handler(messageEvent);
        }
      };
      socket.addEventListener(event, listener);
      return api;
    },
    send(data) {
      socket.send(data);
    },
    close() {
      socket.close();
    },
  };
  return api;
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

async function dispatchMouse(client, type, x, y, buttons = 0) {
  await client.call("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: type === "mouseReleased" ? "left" : type === "mousePressed" ? "left" : "none",
    buttons,
    clickCount: type === "mousePressed" ? 1 : 0,
  });
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
      "--enable-unsafe-swiftshader",
      "--use-gl=swiftshader",
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
    const ws = connectWebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const client = cdp(ws);
    await client.call("Runtime.enable");
    await client.call("Page.enable");
    await client.call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      // CSSはスマホ幅で評価しつつ、CDPのマウスイベントをポインター操作として送る。
      mobile: false,
    });

    await client.call("Page.navigate", { url: BASE });
    await waitFor(
      client,
      `document.querySelector('.title-screen__logo')?.textContent === 'CivilCraft'`,
    );
    step("タイトル表示");

    await evaluate(client, `document.querySelector('.title-screen__cta')?.click()`);
    await waitFor(
      client,
      `document.querySelector('.game-menu__title')?.textContent === 'プレイモードを選択'`,
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
    await waitFor(client, `!!document.querySelector('.cmd-mission')`, 60_000);
    await waitFor(
      client,
      `document.querySelector('.cmd-mission__phase')?.textContent === '準備'`,
      30_000,
    );
    step("ゲーム開始（準備中）");
    await waitFor(
      client,
      `document.querySelector('.cesium-game-map')?.getAttribute('data-3d-buildings') === 'ready'`,
      60_000,
    );
    // 建物タイルのready直後は初期カメラと地形ピックの最初の描画がまだ収束していないため、
    // 実ユーザーの操作開始に近い状態まで1フレーム以上待ってからドラッグを検証する。
    await sleep(750);
    step("スマホ幅で街の3Dモデル表示");

    const dragOnlyDock = await evaluate(
      client,
      `document.querySelector('.cmd-dock__keyboard-place') === null &&
        !document.body.textContent?.includes('地図中央に仮配置')`,
    );
    if (!dragOnlyDock) {
      throw new Error("中央配置の代替導線が残っています");
    }
    step("配置導線はドックからのドラッグに限定");

    const dragPoints = await evaluate(
      client,
      `(() => {
        const card = document.querySelector('.structure-card:not(:disabled)');
        const canvas = document.querySelector('.cesium-widget canvas');
        if (!(card instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return null;
        const cardRect = card.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        return {
          startX: cardRect.left + cardRect.width / 2,
          startY: cardRect.top + cardRect.height / 2,
          canvasLeft: canvasRect.left,
          canvasTop: canvasRect.top,
          canvasWidth: canvasRect.width,
          canvasHeight: canvasRect.height,
        };
      })()`,
    );
    if (dragPoints === null) {
      throw new Error("ドラッグ検証用の施設カードまたは地図キャンバスが見つかりません");
    }
    let draggedToMap = false;
    const dragAttempts = [];
    const dropCandidates = [
      [0.35, 0.3],
      [0.5, 0.3],
      [0.65, 0.3],
      [0.35, 0.45],
      [0.5, 0.45],
      [0.65, 0.45],
      [0.35, 0.6],
      [0.5, 0.6],
      [0.65, 0.6],
      [0.35, 0.75],
      [0.5, 0.75],
      [0.65, 0.75],
    ];
    for (const [xRatio, yRatio] of dropCandidates) {
      const targetX = dragPoints.canvasLeft + dragPoints.canvasWidth * xRatio;
      const targetY = dragPoints.canvasTop + dragPoints.canvasHeight * yRatio;
      await dispatchMouse(client, "mousePressed", dragPoints.startX, dragPoints.startY, 1);
      // まず真上へ移動して、横スクロールではなく配置ドラッグの意図を確定させる。
      await dispatchMouse(client, "mouseMoved", dragPoints.startX, dragPoints.startY - 40, 1);
      for (const ratio of [0.25, 0.5, 0.75, 1]) {
        await dispatchMouse(
          client,
          "mouseMoved",
          dragPoints.startX + (targetX - dragPoints.startX) * ratio,
          dragPoints.startY + (targetY - dragPoints.startY) * ratio,
          1,
        );
      }
      await dispatchMouse(client, "mouseReleased", targetX, targetY);
      await sleep(150);
      draggedToMap = await evaluate(
        client,
        `({
          pending: !!document.querySelector('[aria-label="仮配置の確定"]'),
          dragging: !!document.querySelector('.game-shell.is-dock-dragging'),
          ghost: !!document.querySelector('.dock-drag-ghost'),
          canvas: !!document.querySelector('.cesium-widget canvas')
        })`,
      );
      dragAttempts.push({ xRatio, yRatio, ...draggedToMap });
      if (draggedToMap.pending) {
        draggedToMap = true;
        break;
      }
      draggedToMap = false;
    }
    if (!draggedToMap) {
      throw new Error(
        `実ポインター操作で配置可能帯へドロップできませんでした: ${JSON.stringify({ dragPoints, dragAttempts })}`,
      );
    }
    step("実ポインター操作で仮配置");
    const pendingPanel = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('[aria-label="仮配置操作"]');
        const text = panel?.textContent ?? '';
        return Boolean(
          panel &&
          text.includes('仮配置') &&
          text.includes('戻す') &&
          text.includes('配置する') &&
          panel.querySelector('[aria-label="向きスライダー"]'),
        );
      })()`,
    );
    if (!pendingPanel) {
      throw new Error("仮配置操作パネルの内容が不足しています");
    }
    step("仮配置操作パネル表示");
    const touchActionAfterDrag = await evaluate(
      client,
      `getComputedStyle(document.querySelector('.structure-card:not(:disabled)')).touchAction`,
    );
    if (touchActionAfterDrag === "none") {
      throw new Error(`ドラッグ後のカード操作が復元されません: ${touchActionAfterDrag}`);
    }
    await evaluate(client, `document.querySelector('[aria-label="キャンセル"]')?.click()`);
    await waitFor(client, `!document.querySelector('[aria-label="仮配置の確定"]')`, 5_000);
    step("仮配置をキャンセル");

    await waitFor(client, `!!window.__civilcraftE2E`, 10_000);
    await evaluate(client, `window.__civilcraftE2E.setBudget(20000)`);
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
    await waitFor(client, `window.__civilcraftE2E.placementCount() >= 6`, 10_000);

    // 天候は本番ではランダム。E2Eでは固定して、結果判定を再現可能にする。
    await evaluate(client, `window.__civilcraftE2E.startRain(42601)`);
    await waitFor(client, `window.__civilcraftE2E.getFlood().phase === 'disaster'`, 10_000);
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
      `document.querySelector('.result-panel__badge')?.textContent === '成功'`,
      5_000,
    );
    step("ミッションクリア", result.title ?? result.badge);

    await evaluate(client, `document.querySelector('.result-panel__primary')?.click()`);
    await waitFor(
      client,
      `document.querySelector('.game-menu__title')?.textContent === 'プレイモードを選択'`,
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
