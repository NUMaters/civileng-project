# CivilCraft — Copilot リポジトリ指示

## プロジェクト概要

土木工学教育ゲーム **CivilCraft** のモノレポ。

- フロントエンド: TypeScript, Vite, React, Three.js（`apps/web/`）
- バックエンド: Go モジュラーモノリス（`apps/server/`）
- マスターデータ: `packages/game-data/`（コード直書き禁止）
- 型定義: `packages/game-schema/`

詳細は `docs/agent/guide.md` および `README.md` を参照。

## 開発原則

- KISS / YAGNI / DRY / SOLID（`docs/development/principles.md`）
- 1 ブランチ 1 目的、PR 経由で `develop` にマージ（`docs/git/branch-strategy.md`）
- Issue 無し TODO 禁止（`docs/development/todo-rules.md`）

## コードレビュー

**Copilot コードレビュー**は `.github/instructions/code-review.instructions.md` の指示に従う。

- レビューコメントには `[must]` / `[imo]` / `[nits]` / `[ask]` / `[good]` / `[suggestion]` / `[next]` タグを付ける
- レビューは日本語で記載する

設定: リポジトリ Settings → Copilot → Code review → 「Use custom instructions when reviewing pull requests」を有効化

参考: [GitHub Docs — Customize code review](https://docs.github.com/en/copilot/tutorials/customize-code-review)
