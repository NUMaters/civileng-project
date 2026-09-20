import { useCallback, useEffect, useId, useState } from "react";
import { loadRules } from "@civilcraft/game-data/load";
import heroImageUrl from "../../assets/civilcraft-abukuma-hero.webp";
import { HowToPlayModal } from "./HowToPlayModal";
import { markHowToSeen } from "./howtoStorage";
import type { PlayMode } from "./types";
import "./LobbyScreens.css";

const RULES = loadRules();

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
  openHowtoOnMount = false,
}: GameMenuScreenProps) {
  const [mode, setMode] = useState<PlayMode | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [howtoOpen, setHowtoOpen] = useState(openHowtoOnMount);

  const closeHowto = useCallback(() => {
    markHowToSeen();
    setHowtoOpen(false);
  }, []);
  const titleId = useId();
  const howtoTitleId = useId();

  useEffect(() => {
    if (mode !== "solo") {
      return;
    }
    let cancelled = false;
    setLoadState("loading");

    const load = async () => {
      try {
        await Promise.all([
          fetch("/manifest.webmanifest", { cache: "force-cache" }),
          import("@civilcraft/game-data/load"),
          // Warm the local diorama; no satellite tiles or terrain download is needed.
          import("../../components/GameCanvas/DioramaGameMap"),
        ]);
        if (cancelled) {
          return;
        }
        setLoadState("ready");
      } catch {
        if (!cancelled) {
          setLoadState("error");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, mode]);

  const canStart = mode === "solo" && loadState === "ready";
  const startLabel =
    mode === null
      ? "モードを選択"
      : loadState === "loading"
        ? "読み込み中…"
        : loadState === "error"
          ? "読み込みを再試行してください"
          : canStart
            ? "ゲームスタート"
            : "準備中…";

  return (
    <section className="game-menu cc-lobby" aria-labelledby={titleId}>
      <div className="game-menu__world" aria-hidden="true">
        <img className="game-menu__hero" src={heroImageUrl} alt="" />
        <div className="game-menu__gradient" />
      </div>

      <header className="game-menu__header">
        <button className="game-menu__back" type="button" onClick={onBackToTitle}>
          <span aria-hidden="true">←</span> タイトル
        </button>
        <p className="game-menu__brand">
          <span>Civil</span>Craft
        </p>
        <button
          className="game-menu__howto-btn"
          type="button"
          onClick={() => setHowtoOpen(true)}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">?</span> 遊び方
        </button>
      </header>

      <div className="game-menu__brief">
        <p className="game-menu__brief-kicker">福島・郡山 / 阿武隈川</p>
        <h1 id={titleId} className="game-menu__title">
          プレイモードを選択
        </h1>
        <p className="game-menu__brief-copy">限られた予算と時間で、川沿いの弱点を対策する。</p>
        <p className="game-menu__availability">川を読み、施設を選び、この街の明日をつくる。</p>
      </div>

      <div className="game-menu__modes" role="group" aria-label="プレイモード">
        <button
          type="button"
          className={`game-menu__mode${mode === "solo" ? " is-selected" : ""}`}
          aria-label="シングルプレイ"
          aria-pressed={mode === "solo"}
          onClick={() => setMode("solo")}
        >
          <span className="game-menu__mode-index" aria-hidden="true">
            1P
          </span>
          <span className="game-menu__mode-body">
            <span className="game-menu__mode-label">シングルプレイ</span>
            <strong>一人で治水に挑戦</strong>
            <span className="game-menu__mode-meta">
              準備 {RULES.timing.phases.preparationSeconds} 秒 · 大雨{" "}
              {RULES.timing.phases.disasterSeconds} 秒
            </span>
            <span className="game-menu__mode-meta">
              被災度 {RULES.victory.clearThresholdPercent}% 未満でクリア
            </span>
          </span>
        </button>
        <button
          type="button"
          className="game-menu__mode is-disabled"
          disabled
          aria-disabled="true"
          title="マルチプレイは準備中"
        >
          <span className="game-menu__mode-index" aria-hidden="true">
            MP
          </span>
          <span className="game-menu__mode-body">
            <span className="game-menu__mode-label">マルチプレイ</span>
            <strong>みんなで協力（準備中）</strong>
            <span className="game-menu__mode-meta">現在はシングルプレイで遊べます</span>
          </span>
        </button>
      </div>

      <div className="game-menu__status" aria-live="polite">
        {mode === null ? (
          <p>モードを選んでください</p>
        ) : loadState === "loading" ? (
          <p>マップを読み込み中…</p>
        ) : loadState === "ready" ? (
          <p>準備完了。スタートできます</p>
        ) : loadState === "error" ? (
          <>
            <p>読み込みに失敗しました。通信状態を確認して、もう一度お試しください。</p>
            <button
              className="game-menu__retry"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              もう一度読み込む
            </button>
          </>
        ) : null}
      </div>

      <button
        className="game-menu__start"
        type="button"
        disabled={!canStart}
        onClick={() => {
          if (canStart) {
            onStartGame("solo");
          }
        }}
      >
        <span>{startLabel}</span>
        <span aria-hidden="true">▶</span>
      </button>

      {howtoOpen ? <HowToPlayModal titleId={howtoTitleId} onClose={closeHowto} /> : null}
    </section>
  );
}
