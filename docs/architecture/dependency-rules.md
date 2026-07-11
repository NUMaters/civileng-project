# 依存ルール

循環参照禁止。

## 依存の流れ

```
player / room / mapdata / world
  ↓
game（session / realtime / state / tick / snapshot）
  ↓
construction / disaster
  ↓
simulation
```

- 上記の逆方向の依存は禁止。
- `room` はロビー向けのルーム管理に限定し、本編中の状態は `game/session` が担当する。

## 関連ドキュメント

- [アーキテクチャ概要](./overview.md)
- [パッケージ構成](./package-structure.md)
