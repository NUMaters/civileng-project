---
applyTo: "**"
description: "CivilCraft コードレビュー基準"
---

# CivilCraft Code Review

## 必須確認

1. **MVP 範囲** — [overview.md#mvp](../../docs/game-design/overview.md#mvp) 内か。post-MVP 機能を混入していないか
2. **品質** — `make lint` / `make test` / `make build` が通る変更か
3. **命名** — [naming-conventions.md](../../docs/development/naming-conventions.md) 準拠か
4. **禁止事項** — `any`, `panic`, `fmt.Println`, Issue 無し TODO がないか

## アーキテクチャ

- マスターデータ: `packages/game-data/`（直書き禁止）
- 型定義: `packages/game-schema/`（散在禁止）
- Go モジュール: `apps/server/internal/<feature>/`（domain / application / infrastructure / presentation）
- 禁止ディレクトリ名: `utils`, `common`, `helpers`, `models`, `services`

## ゲーム設計

- 被災度 5% 未満でクリア（`packages/game-data/rules/victory-conditions.json`）
- 1 プレイ 3 分（準備 60s / 災害 90s / 結果 30s）
- 建設中の施設は効果を発揮しない
- マルチは 2〜4 人、ランダム技術割当

## 指摘の優先度

| 優先度 | 内容                                         |
| ------ | -------------------------------------------- |
| P1     | セキュリティ、データ破損、ゲーム判定の不整合 |
| P2     | MVP 範囲外、命名/依存ルール違反、テスト不足  |
| P3     | 可読性、リファクタリング提案                 |

## コメント方針

- 具体的な修正案を提示する
- 関連ドキュメントへのリンクを添える
- 日本語でコメントする
