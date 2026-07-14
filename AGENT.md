# CivilCraft — AI Agent 開発ガイド

本プロジェクトの開発ガイドは `docs/` 配下にジャンル別に分割して管理している。

**エントリーポイント:** [docs/agent/guide.md](./docs/agent/guide.md)

**ハーネス（自動開発）:** [docs/agent/harness.md](./docs/agent/harness.md) — Planner / Generator / Evaluator

## ドキュメント構成

```
docs/
├── agent/
│   └── guide.md              # AI Agent 向け索引・チェックリスト
├── game-design/
│   ├── overview.md           # ゲーム概要、MVP、開発フェーズ
│   ├── game-rules.md         # 勝敗条件、時間、予算、マルチプレイ
│   ├── session-flow.md       # ロビー → 準備 → 災害 → 結果
│   └── ui-controls.md        # 操作・UI
├── civil-engineering/
│   ├── setting.md            # 阿武隈川をモデルとした舞台設定
│   ├── techniques.md         # 土木技術とパラメータ
│   └── disasters.md          # 災害システム
├── architecture/
│   ├── overview.md           # モジュラーモノリス、ディレクトリ役割
│   ├── tech-stack.md         # 技術スタック
│   ├── communication.md      # REST / WebSocket 使い分け
│   ├── package-structure.md  # パッケージ構成
│   ├── dependency-rules.md   # 依存ルール
│   └── directory-rules.md    # ディレクトリ追加ルール
├── api/
│   ├── rest-naming.md        # REST API 命名
│   └── websocket-naming.md   # WebSocket 命名
├── development/
│   ├── principles.md         # 開発原則（KISS / YAGNI / DRY / SOLID）
│   ├── naming-conventions.md # 命名規則
│   ├── development-rules.md  # 開発ルール
│   ├── coding-standards-go.md
│   ├── coding-standards-typescript.md
│   ├── comments.md
│   ├── logging.md
│   ├── error-handling.md
│   ├── ai-usage.md
│   ├── testing.md
│   ├── review-criteria.md
│   ├── issue-management.md
│   └── todo-rules.md
└── git/
    ├── branch-strategy.md    # ブランチ運用規則
    ├── commit-message.md     # コミットメッセージ
    └── pull-request.md       # Pull Request
```

すべての実装・リファクタリング・レビューは、[docs/agent/guide.md](./docs/agent/guide.md) から参照できる各ドキュメントに従うこと。

ゲーム仕様の理解は [docs/game-design/overview.md](./docs/game-design/overview.md) から始めること。
