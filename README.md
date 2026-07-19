# CivilCraft

土木工学の役割や面白さを、ゲームを通じて直感的に学べる **1 人〜複数人で遊べるブラウザ向けゲーム**。

河川氾濫の危険がある街を舞台に、堤防・遊水地・排水機場・護岸・河道掘削などの土木技術を配置し、大雨から街を守る（MVP では大雨のみ。台風は将来追加）。CesiumJS と国土地理院の地理空間データを用い、福島県郡山市の日本大学工学部周辺を流れる阿武隈川を対象地域とする。

詳細は [docs/game-design/overview.md](./docs/game-design/overview.md) を参照。

## 技術スタック

| 領域           | 技術                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| フロントエンド | TypeScript, Vite, React（`@vitejs/plugin-react-swc`）, CesiumJS, WebGL（PWA は Phase 5 以降） |
| バックエンド   | Go（モジュラーモノリス → API Server / Game Server 分離可能）                                    |
| データベース   | PostgreSQL, Redis                                                                               |
| 通信           | REST API, WebSocket（サーバー権威型）                                                           |
| マスターデータ | JSON（`packages/game-data/`）                                                                   |
| 型定義         | TypeScript（`packages/game-schema/`）                                                           |
| インフラ       | Docker, Docker Compose, AWS（ECS, RDS, ElastiCache, S3, CloudFront）, Terraform, GitHub Actions |

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

### 開発環境

関連 Issue: [#3](https://github.com/NUMaters/civileng-project/issues/3)（`Makefile` / `docker-compose.yml` / 開発環境構築手順）

#### 前提ツール

| ツール                  | バージョン目安                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Node.js                 | 20 以上                                                                               |
| pnpm                    | 10 以上（`corepack enable` で有効化）                                                 |
| Go                      | 1.22 以上                                                                             |
| Docker / Docker Compose | 最新                                                                                  |
| golangci-lint           | v2 以上（`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`） |

#### 初回セットアップ

```bash
# リポジトリをクローン後
cp .env.example .env
make setup
make up    # PostgreSQL / Redis を起動
```

#### 開発コマンド

```bash
make format   # gofmt + Prettier
make lint     # golangci-lint + ESLint
make test     # go test + Vitest
make build    # server バイナリ + web ビルド
make up       # docker compose up -d
make down     # docker compose down
```

#### 個別起動

```bash
# フロントエンド開発サーバー（http://localhost:5173）
pnpm dev:web

# API サーバー（http://localhost:8080/health）
./bin/api

# ゲームサーバー（http://localhost:8081/health）
./bin/game
```

Cesium の Worker / Assets は `apps/web/vite.config.ts` で `/cesiumStatic` として配信する（開発時は専用ミドルウェア、ビルド時は `dist/cesiumStatic` へコピー）。`CESIUM_BASE_URL` はサイトルート絶対パス（`/cesiumStatic`）である必要がある。`optimizeDeps.include` に `cesium` と `mersenne-twister` を入れ、CJS 依存の default export エラーで白画面になるのを防ぐ。地図が「Loading…」のまま止まる／真っ白な場合は、ポート 5173 の古い Vite を終了してから `pnpm --filter @civilcraft/web exec vite --force` で依存を再バンドルする。

3D 地図は CesiumJS + 国土地理院シームレス写真 + **PLATEAU-Terrain** + 郡山市公式 ZIP の **テクスチャ付き建築物 3D Tiles**（`bldg_texture`）を使う。初回は次で取得する（約 390MB ダウンロード、`public/plateau/` へ展開。Git 管理外）。

```bash
pnpm --filter @civilcraft/web fetch:plateau
```

カメラ移動は日本大学工学部周辺の阿武隈川プレイ範囲内に制限し、施設は建設ドックから河道（青い帯）上へドラッグ＆ドロップで配置する。設置向きはカメラの向きに合わせ、設置後は施設をドラッグして自由に回転できる。ドロップずれは中心線付近へスナップする。マップ検証中はブランドヘッダーとミッションカードを非表示。詳細は [docs/architecture/geospatial.md](./docs/architecture/geospatial.md) と [docs/game-design/ui-controls.md](./docs/game-design/ui-controls.md)。

ローカル DB・Redis の構成詳細は [docs/development/local-database.md](./docs/development/local-database.md) を参照。`docker-compose.yml` で PostgreSQL 16 と Redis 7 を提供する。

## ドキュメント

| 用途               | ドキュメント                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ |
| ゲーム概要・MVP    | [docs/game-design/overview.md](./docs/game-design/overview.md)                             |
| ゲームルール       | [docs/game-design/game-rules.md](./docs/game-design/game-rules.md)                         |
| セッションフロー   | [docs/game-design/session-flow.md](./docs/game-design/session-flow.md)                     |
| 操作・UI           | [docs/game-design/ui-controls.md](./docs/game-design/ui-controls.md)                       |
| 土木技術・災害     | [docs/civil-engineering/](./docs/civil-engineering/)                                       |
| AI Agent 向け索引  | [docs/agent/guide.md](./docs/agent/guide.md)                                               |
| 開発原則・命名規則 | [docs/development/](./docs/development/)                                                   |
| アーキテクチャ     | [docs/architecture/](./docs/architecture/)                                                 |
| API 命名           | [docs/api/](./docs/api/)                                                                   |
| Git 運用           | [docs/git/](./docs/git/)                                                                   |
| マスターデータ設計 | [docs/architecture/game-data-master-data.md](./docs/architecture/game-data-master-data.md) |
| game-schema 設計   | [docs/architecture/game-schema-design.md](./docs/architecture/game-schema-design.md)       |
| ゲーム状態モデル   | [docs/architecture/game-state-model.md](./docs/architecture/game-state-model.md)           |
| ローカル DB 構成   | [docs/development/local-database.md](./docs/development/local-database.md)                 |
| 地理空間アーキテクチャ | [docs/architecture/geospatial.md](./docs/architecture/geospatial.md)                    |
| CesiumJS 導入作業 | [docs/development/cesium-roadmap.md](./docs/development/cesium-roadmap.md)                  |

ルートの [AGENT.md](./AGENT.md) は `docs/agent/guide.md` への索引である。

## MVP

Phase 1（技術検証）+ Phase 2（最小ゲーム）を統合した初回リリース版。

- 1 つの河川マップ、1〜4 人プレイ（ソロ：ルームなし／マルチ：ルーム作成・一覧参加）
- 堤防・遊水地・排水機場・護岸・河道掘削の配置（複数人同時配置可）、大雨発生（台風なし）、簡易浸水判定、被災度・評価の表示、各技術の短い解説、結果画面での振り返り

詳細は [docs/game-design/overview.md#mvp](./docs/game-design/overview.md#mvp) を参照。
