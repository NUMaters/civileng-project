import { useEffect, useId, useState } from "react";
import type { PlayMode } from "./types";

type GameMenuScreenProps = {
  onBackToTitle: () => void;
  onStartGame: (mode: PlayMode) => void;
  /** 結果画面から戻ったときは遊び方を自動で開かない。 */
  openHowtoOnMount?: boolean;
};

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * シングル／マルチ選択と操作説明。
 * マルチは未対応のため選択不可。読込完了後にゲームスタート可能。
 */
export function GameMenuScreen({
  onBackToTitle,
  onStartGame,
  openHowtoOnMount = true,
}: GameMenuScreenProps) {
  const [mode, setMode] = useState<PlayMode | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const [howtoOpen, setHowtoOpen] = useState(openHowtoOnMount);
  const titleId = useId();
  const howtoTitleId = useId();

  useEffect(() => {
    if (mode !== "solo") {
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    setLoadProgress(8);

    const tick = window.setInterval(() => {
      setLoadProgress((current) => Math.min(92, current + 7 + Math.random() * 9));
    }, 180);

    const load = async () => {
      const started = performance.now();
      try {
        await Promise.all([
          fetch("/cesiumStatic/Widgets/widgets.css", { cache: "force-cache" }),
          fetch("/manifest.webmanifest", { cache: "force-cache" }),
          import("@civilcraft/game-data/load"),
          // スタート押下前に Cesium チャンクを温めてゲーム入場の白画面を短縮する。
          import("../../components/GameCanvas/CesiumGameMap"),
        ]);
        const elapsed = performance.now() - started;
        const wait = Math.max(0, 900 - elapsed);
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        if (cancelled) {
          return;
        }
        setLoadProgress(100);
        setLoadState("ready");
      } catch {
        if (!cancelled) {
          setLoadState("error");
        }
      } finally {
        window.clearInterval(tick);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [mode]);

  const canStart = mode === "solo" && loadState === "ready";

  return (
    <section className="game-menu" aria-labelledby={titleId}>
      <div className="game-menu__atmosphere" aria-hidden="true" />
      <header className="game-menu__header">
        <button className="game-menu__back" type="button" onClick={onBackToTitle}>
          タイトルへ
        </button>
        <div>
          <p className="game-menu__eyebrow">MISSION SELECT</p>
          <h1 id={titleId} className="game-menu__title">
            防衛モード選択
          </h1>
        </div>
        <button
          className="game-menu__howto-btn"
          type="button"
          onClick={() => setHowtoOpen(true)}
        >
          遊び方
        </button>
      </header>

      <div className="game-menu__modes" role="group" aria-label="プレイモード">
        <button
          type="button"
          className={`game-menu__mode${mode === "solo" ? " is-selected" : ""}`}
          onClick={() => setMode("solo")}
        >
          <span className="game-menu__mode-label">シングルプレイ</span>
          <strong>一人で阿武隈川を防衛</strong>
          <span className="game-menu__mode-meta">準備 20 秒 · 大雨 60 秒</span>
        </button>
        <button
          type="button"
          className="game-menu__mode is-disabled"
          disabled
          aria-disabled="true"
          title="マルチプレイは近日対応"
        >
          <span className="game-menu__mode-label">マルチプレイ</span>
          <strong>最大 4 人で共同防衛</strong>
          <span className="game-menu__mode-meta">準備中 · 選択できません</span>
        </button>
      </div>

      <div className="game-menu__status" aria-live="polite">
        {mode === null ? (
          <p>モードを選んでください</p>
        ) : loadState === "loading" ? (
          <p>
            戦場データを読み込み中… <strong>{Math.round(loadProgress)}%</strong>
          </p>
        ) : loadState === "ready" ? (
          <p>読込完了。防衛を開始できます</p>
        ) : loadState === "error" ? (
          <p>読込に失敗しました。シングルを選び直してください</p>
        ) : null}
        {mode === "solo" && loadState === "loading" ? (
          <div className="game-menu__track" aria-hidden="true">
            <span style={{ width: `${loadProgress}%` }} />
          </div>
        ) : null}
      </div>

      <button
        className="game-menu__start"
        type="button"
        disabled={!canStart}
        onClick={() => {
          if (mode === "solo") {
            onStartGame("solo");
          }
        }}
      >
        {canStart ? "ゲームスタート" : "読込完了後にスタート"}
      </button>

      {howtoOpen ? (
        <HowToPlayModal titleId={howtoTitleId} onClose={() => setHowtoOpen(false)} />
      ) : null}
    </section>
  );
}

function HowToPlayModal({
  titleId,
  onClose,
}: {
  titleId: string;
  onClose: () => void;
}) {
  return (
    <div className="howto-modal" role="presentation">
      <button className="howto-modal__backdrop" type="button" aria-label="閉じる" onClick={onClose} />
      <div
        className="howto-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="howto-modal__head">
          <h2 id={titleId}>遊び方</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="howto-modal__body">
          <p>
            阿武隈川沿いの弱点を読み、堤防・護岸・排水機場・遊水地・河道掘削を配備してまちを守れ。
          </p>
          <ul>
            <li>下部ドックから施設をドラッグし、川の青い帯へドロップ</li>
            <li>仮配置中に向きと位置を調整し、✓ で確定（予算消費）</li>
            <li>弱点の種類に合う施設を置く（越水→堤防、侵食→護岸など）</li>
            <li>準備 20 秒のあと大雨 60 秒。被災度 5% 未満でクリア</li>
          </ul>
        </div>
        <button className="howto-modal__ok" type="button" onClick={onClose}>
          了解
        </button>
      </div>
    </div>
  );
}
