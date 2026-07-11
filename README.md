# CivilCraft

土木工学の役割や面白さを、ゲームを通じて直感的に学べる **1 人〜複数人で遊べるブラウザ向けゲーム**。

河川氾濫の危険がある街を舞台に、堤防・遊水地・排水機場・護岸・河道掘削などの土木技術を配置し、大雨から街を守る（MVP では大雨のみ。台風は将来追加）。福島県郡山市の阿武隈川をモデルとした地域設定。

詳細は [docs/game-design/overview.md](./docs/game-design/overview.md) を参照。

## 技術スタック

| 領域 | 技術 |
|------|------|
| フロントエンド | TypeScript, Vite, React, Three.js, WebGL（PWA は Phase 5 以降） |
| バックエンド | Go（モジュラーモノリス → API Server / Game Server 分離可能） |
| データベース | PostgreSQL, Redis |
| 通信 | REST API, WebSocket（サーバー権威型） |
| マスターデータ | JSON（`packages/game-data/`） |
| 型定義 | TypeScript（`packages/game-schema/`） |
| インフラ | Docker, Docker Compose, AWS（ECS, RDS, ElastiCache, S3, CloudFront）, Terraform, GitHub Actions |

詳細は [docs/architecture/tech-stack.md](./docs/architecture/tech-stack.md) を参照。

## プロジェクト構成

```
civilcraft/
├── AGENT.md              # AI Agent 向け索引（docs/agent/guide.md へ）
├── apps/
│   ├── web/              # ブラウザゲーム（フロントエンド）
│   │   ├── public/
│   │   └── src/          # app, components, features, game, pages, services 等
│   ├── server/           # Go バックエンド
│   │   ├── cmd/
│   │   ├── config/
│   │   ├── internal/     # 機能単位モジュール（player, room, game, simulation 等）
│   │   ├── migrations/
│   │   ├── pkg/
│   │   └── testdata/
│   └── admin/            # 管理画面・マップ編集画面
├── packages/
│   ├── game-schema/      # REST / WebSocket 通信スキーマ
│   │   ├── common/
│   │   ├── rest/
│   │   └── websocket/
│   ├── game-data/        # 土木技術・災害・マップ・ゲームルール定義
│   │   ├── disasters/
│   │   ├── maps/
│   │   ├── rules/
│   │   ├── scenarios/
│   │   └── structures/
│   ├── ui/               # 共通 UI コンポーネント
│   └── config/           # ESLint, TypeScript 等の共通設定
├── assets/
│   ├── models/
│   ├── textures/
│   ├── sounds/
│   └── maps/
├── docs/
│   ├── agent/            # AI Agent 向け開発ガイド
│   ├── architecture/     # アーキテクチャ設計
│   ├── api/              # API・WebSocket 命名規則
│   ├── development/      # 開発方針・コーディング規約
│   ├── game-design/      # ゲーム概要・MVP・開発フェーズ
│   ├── civil-engineering/# 土木技術・災害・舞台設定
│   └── git/              # Git 運用規則
├── infra/
│   ├── terraform/
│   ├── docker/
│   └── monitoring/
├── tools/
│   ├── asset-optimizer/
│   ├── map-converter/
│   └── seed-generator/
├── .github/workflows/
├── docker-compose.yml
├── Makefile
└── README.md
```

### TODO：開発環境

- [ ] `Makefile` の実装（`make format` / `make lint` / `make test` / `make build`）
- [ ] `docker-compose.yml` の実装
- [ ] 開発環境構築手順ドキュメントの作成

## ドキュメント

| 用途 | ドキュメント |
|------|-------------|
| ゲーム概要・MVP | [docs/game-design/overview.md](./docs/game-design/overview.md) |
| ゲームルール | [docs/game-design/game-rules.md](./docs/game-design/game-rules.md) |
| セッションフロー | [docs/game-design/session-flow.md](./docs/game-design/session-flow.md) |
| 操作・UI | [docs/game-design/ui-controls.md](./docs/game-design/ui-controls.md) |
| 土木技術・災害 | [docs/civil-engineering/](./docs/civil-engineering/) |
| AI Agent 向け索引 | [docs/agent/guide.md](./docs/agent/guide.md) |
| 開発原則・命名規則 | [docs/development/](./docs/development/) |
| アーキテクチャ | [docs/architecture/](./docs/architecture/) |
| API 命名 | [docs/api/](./docs/api/) |
| Git 運用 | [docs/git/](./docs/git/) |

ルートの [AGENT.md](./AGENT.md) は `docs/agent/guide.md` への索引である。

## MVP

Phase 1（技術検証）+ Phase 2（最小ゲーム）を統合した初回リリース版。

- 1 つの河川マップ、1〜4 人プレイ（ソロ：ルームなし／マルチ：ルーム作成・一覧参加）
- 堤防・遊水地・排水機場・護岸・河道掘削の配置（複数人同時配置可）、大雨発生（台風なし）、簡易浸水判定、被災度・評価の表示、各技術の短い解説、結果画面での振り返り

詳細は [docs/game-design/overview.md#mvp](./docs/game-design/overview.md#mvp) を参照。
