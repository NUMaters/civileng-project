import { useCallback, useEffect, useRef, useState } from "react";
import { KoriyamaMapController } from "../../game/map/KoriyamaMapController";
import styles from "./KoriyamaMap.module.css";

const BUILDINGS_ERROR_MESSAGE: string =
  "郡山市の3D都市モデルを読み込めませんでした。通信環境を確認して、ページを再読み込みしてください。";

export function KoriyamaMap(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<KoriyamaMapController | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [terrainWarning, setTerrainWarning] = useState<boolean>(false);

  useEffect(() => {
    const container: HTMLDivElement | null = containerRef.current;
    if (container === null) {
      return undefined;
    }

    const controller = new KoriyamaMapController(container, {
      onReady: (): void => setIsLoading(false),
      onTerrainFallback: (): void => setTerrainWarning(true),
      onFatalError: (error: unknown): void => {
        console.error("郡山市3Dマップの初期化に失敗しました。", error);
        setFatalError(BUILDINGS_ERROR_MESSAGE);
        setIsLoading(false);
      },
    });
    controllerRef.current = controller;
    void controller.initialize().catch((): void => undefined);

    return (): void => {
      controller.destroy();
      controllerRef.current = undefined;
    };
  }, []);

  const resetCamera = useCallback((): void => {
    controllerRef.current?.resetCamera();
  }, []);

  return (
    <main className={styles.page}>
      <div ref={containerRef} className={styles.map} aria-label="郡山市の3D地図" />

      <header className={styles.header}>
        <h1>PLATEAU 郡山市 3Dマップ</h1>
      </header>

      <button className={styles.resetButton} type="button" onClick={resetCamera}>
        <span aria-hidden="true">⌖</span>
        郡山市中心へ
      </button>

      {isLoading && fatalError === null ? (
        <div className={styles.loading} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          郡山市の3D都市モデルを読み込んでいます…
        </div>
      ) : null}

      {terrainWarning && fatalError === null ? (
        <div className={styles.warning} role="status">
          地形データを取得できなかったため、標準地形で表示しています。
        </div>
      ) : null}

      {fatalError !== null ? (
        <div className={styles.error} role="alert">
          <strong>3Dマップを表示できません</strong>
          <span>{fatalError}</span>
        </div>
      ) : null}

      <aside className={styles.attribution} aria-label="データ提供元">
        <span>3D都市モデル：Project PLATEAU</span>
        <span>地形：PLATEAU | Mapterhorn | 国土地理院</span>
        <span>背景地図：国土地理院</span>
        <span>河川中心線：国土地理院</span>
      </aside>
    </main>
  );
}
