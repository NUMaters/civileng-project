/** Cesium チャンク読込中のフォールバック。タイトル／メニューを塞がないようゲーム層内だけに出す。 */
export function MapBootFallback() {
  return (
    <div className="map-boot-fallback" role="status" aria-live="polite">
      <div className="map-boot-fallback__panel">
        <strong>3D 地図を準備中…</strong>
        <p>初回は数十秒かかることがあります</p>
      </div>
    </div>
  );
}
