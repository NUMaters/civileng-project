# SPR-001: Alpha-M1 設計・開発基盤

> 元プロンプト: 「Alpha-M1（#17〜#26）を Planner → Generator → Evaluator の流れで進める」
> 作成日: 2026-07-15
> ステータス: approved

## 概要

MVP 実装に先立つ設計ドキュメントとマスターデータの確定、および開発基盤（モノレポ・Lint・Copilot 指示・DB 構成）を整備する。Phase 2 前半の実装着手前に、server / web が参照できる設計と JSON を揃える。

## スコープ

- **含む:** Issue #17〜#26（#23 CI は完了済みのため対象外）
- **含まない（YAGNI）:** ゲームロジックの実装、API エンドポイント実装、UI 実装

## 機能一覧

| #   | 機能                               | Issue | 優先度 | スプリント |
| --- | ---------------------------------- | ----- | ------ | ---------- |
| 1   | 土木技術マスターデータ具体値       | #17   | must   | Sprint 1   |
| 2   | 勝利条件・クリア閾値マスターデータ | #18   | must   | Sprint 1   |
| 3   | game-schema 型定義方針             | #19   | must   | Sprint 2   |
| 4   | ゲーム状態モデル（サーバー）       | #20   | must   | Sprint 2   |
| 5   | ローカル DB・Redis 構成            | #21   | must   | Sprint 3   |
| 6   | develop ブランチ・保護設定         | #22   | must   | Sprint 4   |
| 7   | モノレポ workspace 設定            | #24   | must   | Sprint 4   |
| 8   | ESLint / Prettier / golangci-lint  | #25   | must   | Sprint 4   |
| 9   | Copilot カスタム指示               | #26   | must   | Sprint 4   |

## スプリント計画

### Sprint 1: マスターデータ確定（#17, #18）

**目的:** 5 種類の土木技術と勝敗判定ルールの具体値を JSON に確定し、参照方針を文書化する。

**ユーザーストーリー:**

- 開発者として、コード直書きなしで土木技術パラメータを参照したい。なぜならバランス調整を JSON だけで行えるから。

**受け入れ基準（Evaluator 用）:**

- [ ] `packages/game-data/structures/` に 5 種類（levee, retention-basin, drainage-pump, revetment, channel-dredging）の JSON が存在し、建設費・建設時間・維持費・効果パラメータを含む
- [ ] `packages/game-data/rules/victory-conditions.json` にクリア閾値（5%）が定義されている
- [ ] `packages/game-data/rules/budget-rules.json` に初期予算が定義されている
- [ ] 設計方針が `docs/architecture/game-data-master-data.md` に文書化されている
- [ ] `make lint` / `make test` / `make build` が通る

**依存:** なし

### Sprint 2: アーキテクチャ設計（#19, #20）

**目的:** 型定義の分割方針とサーバー側ゲーム状態モデルを文書化する。

**受け入れ基準（Evaluator 用）:**

- [ ] `docs/architecture/game-schema-design.md` に REST / WebSocket のディレクトリ構成・命名・共有方法が記載されている
- [ ] `docs/architecture/game-state-model.md` にフェーズ別状態・モジュール責務・状態遷移が記載されている
- [ ] 既存 `docs/architecture/` との矛盾がない

**依存:** Sprint 1

### Sprint 3: ローカル DB 構成（#21）

**目的:** PostgreSQL / Redis の docker-compose 構成とマイグレーション方針を文書化する。

**受け入れ基準（Evaluator 用）:**

- [ ] `docs/development/local-database.md` にサービス構成・環境変数・接続確認手順が記載されている
- [ ] マイグレーション実行手順（`make migrate`）が明文化されている
- [ ] README の DB セクションが当該ドキュメントへリンクしている

**依存:** なし

### Sprint 4: 開発基盤整備（#22, #24, #25, #26）

**目的:** ブランチ保護・モノレポ・Lint・Copilot 指示を整備し、開発基盤を Alpha-M1 完了状態にする。

**受け入れ基準（Evaluator 用）:**

- [ ] `develop` ブランチが存在し、ブランチ保護設定手順が `docs/git/branch-protection-setup.md` に記載されている
- [ ] pnpm workspace + Go module がルートから `make setup` / `make lint` / `make build` で動作する
- [ ] `.github/copilot-instructions.md` と `.github/instructions/code-review.instructions.md` が存在する
- [ ] `make lint` / `make test` / `make build` が通る

**依存:** なし

## 人間承認が必要

| 項目                              | 理由                     | 承認者 |
| --------------------------------- | ------------------------ | ------ |
| 土木技術の数値パラメータ          | ゲームバランス           | チーム |
| 初期予算・維持費                  | ゲームバランス           | チーム |
| GitHub ブランチ保護ルールの有効化 | リポジトリ管理者操作     | 管理者 |
| Copilot Code Review の有効化      | リポジトリ Settings 操作 | 管理者 |

## 非機能要件

- 対応環境: ローカル開発（macOS / Linux）
- JSON キー名: camelCase（[命名規則](../development/naming-conventions.md) 準拠）

## 関連

- Issue: #17, #18, #19, #20, #21, #22, #24, #25, #26
- ドキュメント: docs/game-design/, docs/architecture/, docs/civil-engineering/
