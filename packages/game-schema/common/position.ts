/**
 * プロトタイプ用ローカル座標。
 * 新規イベントは GeoPosition を使う（docs/architecture/game-schema-design.md）。
 */
export type Position = {
  x: number;
  y: number;
  z: number;
};
