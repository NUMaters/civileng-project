type PlacementConfirmBarProps = {
  structureName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 仮配置中の確定・キャンセルを画面下部に明示する。 */
export function PlacementConfirmBar({
  structureName,
  onConfirm,
  onCancel,
}: PlacementConfirmBarProps) {
  return (
    <div className="placement-bar" role="toolbar" aria-label="配置の確定">
      <p className="placement-bar__hint">
        <strong>{structureName}</strong> の向きと位置を調整してから確定
      </p>
      <div className="placement-bar__actions">
        <button className="placement-bar__cancel" type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button className="placement-bar__confirm" type="button" onClick={onConfirm}>
          配置を確定
        </button>
      </div>
    </div>
  );
}
