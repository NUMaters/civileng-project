import { useEffect, useState } from "react";

const EXIT_MS = 420;

type GameToastProps = {
  message: string;
  /** info=控えめ / warn=注意 / success=成功 */
  tone?: "info" | "warn" | "success";
};

/**
 * 上部フィードバック。消すときもフェードアウトしてから DOM を外す。
 */
export function GameToast({ message, tone = "info" }: GameToastProps) {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  const [activeTone, setActiveTone] = useState(tone);

  useEffect(() => {
    if (message !== "") {
      setText(message);
      setActiveTone(tone);
      // 同じ文言の再表示でも入りアニメが走るように一度閉じる。
      setVisible(false);
      const frame = window.requestAnimationFrame(() => {
        setVisible(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timer = window.setTimeout(() => {
      setText("");
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [message, tone]);

  if (text === "") {
    return null;
  }

  return (
    <p
      className={`game-toast game-toast--${activeTone}${visible ? " is-visible" : " is-leaving"}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </p>
  );
}
