import { useEffect, useRef } from "react";
import { getCesiumRenderProfile } from "../../../components/GameCanvas/cesiumPerformance";
import { resolveRainDrama } from "../services/rainDrama";
import type { FloodSimulationState } from "../services/floodSimulation";

type RainOverlayProps = {
  active: boolean;
  getLatestState: () => FloodSimulationState;
};

type Drop = {
  x: number;
  y: number;
  len: number;
  speed: number;
  thick: number;
  alpha: number;
};

/** Canvas と 3D 地図の描画予算を共有する。端末性能に応じて雨の更新率を下げる。 */

/**
 * 画面全体の大雨オーバーレイ。
 * Cesium 負荷を避けるため Canvas 2D の筋雨＋薄闇で表現する。
 * 危機度（溢れ・水深・被害）が高いほど密度と暗さが増す。
 */
export function RainOverlay({ active, getLatestState }: RainOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mistRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
      const mist = mistRef.current;
      const flash = flashRef.current;
      if (mist !== null) {
        mist.style.opacity = "0";
      }
      if (flash !== null) {
        flash.style.opacity = "0";
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas !== null && canvas !== undefined && ctx !== null && ctx !== undefined) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const mist = mistRef.current;
    const flash = flashRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }

    const profile = getCesiumRenderProfile();
    const rainFrameIntervalMs = profile.rainFrameIntervalMs;
    const rainMaxDrops = profile.rainMaxDrops;

    let frameId = 0;
    let width = 0;
    let height = 0;
    let drops: Drop[] = [];
    let displayedDrama = 0;
    let nextFlashAt = performance.now() + 4_000;
    let flashUntil = 0;
    let lastAt = performance.now();
    let lastDrawAt = 0;

    const resize = () => {
      const dpr = Math.min(profile.rainCanvasDprCap, window.devicePixelRatio || 1);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildDrops(Math.max(drops.length, 40));
    };

    const rebuildDrops = (count: number) => {
      const next: Drop[] = [];
      for (let i = 0; i < count; i += 1) {
        next.push(spawnDrop(width, height, Math.random()));
      }
      drops = next;
    };

    const onResize = () => resize();
    resize();
    window.addEventListener("resize", onResize);

    const tick = (now: number) => {
      if (document.hidden) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }
      if (now - lastDrawAt < rainFrameIntervalMs) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }
      lastDrawAt = now;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastAt) / 1000));
      lastAt = now;
      const latest = getLatestState();
      const targetDrama = resolveRainDrama({
        phase: latest.phase,
        rainfallIntensity: latest.rainfallIntensity,
        overflowMeters: latest.overflowMeters,
        floodDepthMeters: latest.floodDepthMeters,
        damagePercent: latest.damagePercent,
      });
      displayedDrama += (targetDrama - displayedDrama) * Math.min(1, dt * 2.4);

      const desiredCount = Math.round(12 + displayedDrama * (rainMaxDrops - 12));
      if (Math.abs(desiredCount - drops.length) > 8) {
        rebuildDrops(desiredCount);
      }

      ctx.clearRect(0, 0, width, height);
      if (displayedDrama > 0.02) {
        const wind = 55 + displayedDrama * 90;
        ctx.strokeStyle = `rgba(210, 230, 245, ${0.18 + displayedDrama * 0.42})`;
        for (const drop of drops) {
          drop.y += drop.speed * dt * (0.85 + displayedDrama * 1.1);
          drop.x += wind * dt * 0.35;
          if (drop.y > height + 20 || drop.x > width + 40) {
            Object.assign(drop, spawnDrop(width, height, 0));
          }
          ctx.lineWidth = drop.thick;
          ctx.globalAlpha = drop.alpha * (0.45 + displayedDrama * 0.55);
          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y);
          ctx.lineTo(drop.x - drop.len * 0.28, drop.y + drop.len);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      if (mist !== null) {
        // 暗幕が強すぎると本川の増水・濁りが見えにくくなるため上限を抑える。
        mist.style.opacity = String(Math.min(0.48, displayedDrama * 0.52));
        mist.style.setProperty("--rain-drama", String(displayedDrama));
      }

      if (flash !== null) {
        if (displayedDrama > 0.72 && now >= nextFlashAt) {
          flashUntil = now + 90 + Math.random() * 70;
          nextFlashAt = now + 3_500 + Math.random() * 5_500 * (1.4 - displayedDrama);
        }
        const flashing = now < flashUntil;
        flash.style.opacity = flashing ? String(0.18 + displayedDrama * 0.22) : "0";
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
    };
  }, [active, getLatestState]);

  return (
    <div
      className={`rain-overlay${active ? " is-active" : ""}`}
      aria-hidden="true"
    >
      <div ref={mistRef} className="rain-overlay__mist" />
      <canvas ref={canvasRef} className="rain-overlay__canvas" />
      <div ref={flashRef} className="rain-overlay__flash" />
    </div>
  );
}

function spawnDrop(width: number, height: number, yRandom: number): Drop {
  return {
    x: Math.random() * (width + 80) - 40,
    y: yRandom * (height + 40) - 40,
    len: 10 + Math.random() * 18,
    speed: 520 + Math.random() * 680,
    thick: 1 + Math.random() * 1.4,
    alpha: 0.35 + Math.random() * 0.55,
  };
}
