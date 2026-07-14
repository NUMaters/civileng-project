# AI Agent 開発ガイド

本ドキュメントは、AI Agent および開発者が本プロジェクトでコードを書く・レビューする際に従うべき方針・規約の索引である。

**すべての実装・リファクタリング・レビューは、以下のドキュメントに従うこと。**

---

## ドキュメント一覧

### ハーネスエンジニアリング（自動開発）

| ドキュメント | 内容 |
|-------------|------|
| [ハーネス概要](./harness.md) | Planner / Generator / Evaluator のワークフロー |
| Planner Skill | `.cursor/skills/planner/SKILL.md` |
| Generator Skill | `.cursor/skills/generator/SKILL.md` |
| Evaluator Skill | `.cursor/skills/evaluator/SKILL.md` |

### ゲーム設計・土木工学

| ドキュメント | 内容 |
|-------------|------|
| [ゲーム概要](../game-design/overview.md) | 概要、目的、ゲーム進行、MVP、開発フェーズ |
| [ゲームルール](../game-design/game-rules.md) | 勝敗条件、時間、予算、フェーズ、マルチプレイ |
| [セッションフロー](../game-design/session-flow.md) | ロビー → 準備 → 災害 → 結果 |
| [操作・UI](../game-design/ui-controls.md) | タップ操作、カメラ、施設配置フロー |
| [舞台設定](../civil-engineering/setting.md) | 阿武隈川をモデルとした地域設定 |
| [土木技術](../civil-engineering/techniques.md) | ゲーム内の土木技術とパラメータ |
| [災害システム](../civil-engineering/disasters.md) | 災害イベントとシミュレーション方針 |

### 開発方針・規約

| ドキュメント | 内容 |
|-------------|------|
| [開発原則](../development/principles.md) | 基本方針、KISS / YAGNI / DRY / SOLID、最終目標 |
| [命名規則](../development/naming-conventions.md) | Repository、ディレクトリ、ファイル、クラス、JSON 等 |
| [開発ルール](../development/development-rules.md) | Push 禁止、Linter、テスト、コード品質 |
| [AI 利用ルール](../development/ai-usage.md) | AI 生成コードの取り扱い |
| [レビュー基準](../development/review-criteria.md) | レビュー時の確認項目 |
| [Issue 運用](../development/issue-management.md) | Issue の作成・命名 |
| [TODO ルール](../development/todo-rules.md) | TODO コメントの書き方 |

### アーキテクチャ

| ドキュメント | 内容 |
|-------------|------|
| [アーキテクチャ概要](../architecture/overview.md) | モジュラーモノリス、ディレクトリ構成の役割分担 |
| [技術スタック](../architecture/tech-stack.md) | フロントエンド・バックエンド・インフラ |
| [通信方針](../architecture/communication.md) | REST API と WebSocket の使い分け |
| [パッケージ構成](../architecture/package-structure.md) | 機能単位のパッケージ管理 |
| [依存ルール](../architecture/dependency-rules.md) | モジュール間の依存方向 |
| [ディレクトリ追加ルール](../architecture/directory-rules.md) | 新規ディレクトリ追加の判断基準 |

### API・通信

| ドキュメント | 内容 |
|-------------|------|
| [REST API 命名](../api/rest-naming.md) | エンドポイントの命名規則 |
| [WebSocket 命名](../api/websocket-naming.md) | イベント名の命名規則 |

### コーディング規約

| ドキュメント | 内容 |
|-------------|------|
| [Go コーディング規約](../development/coding-standards-go.md) | gofmt、エラーハンドリング、Context |
| [TypeScript コーディング規約](../development/coding-standards-typescript.md) | strict、any 禁止、型定義 |
| [コメント規約](../development/comments.md) | コメントの書き方 |
| [ログ規約](../development/logging.md) | Logger の使用 |
| [エラーハンドリング](../development/error-handling.md) | エラーの Wrap |
| [テスト規約](../development/testing.md) | Unit / Integration Test |

### Git 運用

| ドキュメント | 内容 |
|-------------|------|
| [ブランチ運用規則](../git/branch-strategy.md) | ブランチ構成、命名、マージ、リリース |
| [コミットメッセージ](../git/commit-message.md) | Conventional Commits |
| [Pull Request](../git/pull-request.md) | PR タイトル、テンプレート |

---

## AI Agent 向けチェックリスト

### 実装前

- [ ] [ゲーム概要](../game-design/overview.md)・[ゲームルール](../game-design/game-rules.md)・[MVP](../game-design/overview.md#mvp)の範囲内か
- [ ] [命名規則](../development/naming-conventions.md)・[依存ルール](../architecture/dependency-rules.md)に違反していないか
- [ ] [開発原則](../development/principles.md)の YAGNI に反する不要な機能・抽象化を追加していないか
- [ ] [アーキテクチャ概要](../architecture/overview.md)に従い、適切なディレクトリに配置しているか
- [ ] ブランチ名が `<種類>/<issue番号>-<短い説明>` 形式か（[ブランチ運用規則](../git/branch-strategy.md) 参照）
- [ ] 1 ブランチ 1 目的になっているか（[ブランチ運用規則](../git/branch-strategy.md) 参照）

### 実装後

- [ ] Linter・Formatter を通過したか
- [ ] [テスト規約](../development/testing.md)に従い Unit Test を追加したか（重要処理は Integration Test も）
- [ ] `any` / `panic` / `fmt.Println` / `as any` を使っていないか
- [ ] [TODO ルール](../development/todo-rules.md)に従い、Issue 無しの TODO を残していないか
- [ ] [AI 利用ルール](../development/ai-usage.md)に従い、生成コードをそのまま提出していないか
- [ ] [ブランチ運用規則](../git/branch-strategy.md)の PR 作成前チェックを満たしているか
