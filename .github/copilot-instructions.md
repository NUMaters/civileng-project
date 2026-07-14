# CivilCraft — Copilot カスタム指示

本リポジトリの AI 支援開発における共通ルール。Copilot Chat / Code Review で参照する。

## プロジェクト概要

CivilCraft は土木工学を題材としたブラウザ向けボクセルゲーム（Go + TypeScript モノレポ）。

- エントリーポイント: [AGENT.md](../AGENT.md) → [docs/agent/guide.md](../docs/agent/guide.md)
- MVP 範囲: [docs/game-design/overview.md](../docs/game-design/overview.md#mvp)

## 開発原則

- **KISS / YAGNI / DRY / SOLID** — [docs/development/principles.md](../docs/development/principles.md)
- マスターデータは `packages/game-data/`、型定義は `packages/game-schema/` に集約。コード直書き禁止
- `any` / `panic` / `fmt.Println` / `as any` 禁止
- Issue 無し TODO 禁止

## ブランチ・コミット

- ブランチ名: `<種類>/<issue番号>-<短い説明>`（[branch-strategy.md](../docs/git/branch-strategy.md)）
- コミット: 日本語 Conventional Commits（[commit-message.md](../docs/git/commit-message.md)）
- `main` / `develop` への直接 Push 禁止
- 1 ブランチ 1 目的

## 品質ゲート

PR 作成前に以下を通過すること:

```bash
make format
make lint
make test
make build
```

## アーキテクチャ

- モジュラーモノリス（[overview.md](../docs/architecture/overview.md)）
- REST: ゲーム開始前後 / WebSocket: ゲーム中リアルタイム
- サーバー権威型（クライアント表示のみを信用しない）

## レビュー時の確認

- [review-criteria.md](../docs/development/review-criteria.md) に沿って確認
- MVP 範囲外の機能追加（YAGNI 違反）を指摘
- 命名規則・依存ルール違反を指摘
