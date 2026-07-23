# CivilCraft

土木工学の役割や面白さを、ゲームを通じて直感的に学べる **1 人〜複数人で遊べるブラウザ向けゲーム**。

河川氾濫の危険がある街を舞台に、堤防・遊水地・排水機場・護岸・河道掘削などの土木技術を配置し、大雨から街を守る（MVP では大雨のみ。台風は将来追加）。CesiumJS と国土地理院の地理空間データを用い、福島県郡山市の日本大学工学部周辺を流れる阿武隈川を対象地域とする。

詳細は [docs/game-design/overview.md](./docs/game-design/overview.md) を参照。

## ライセンス

[MIT License](./LICENSE)（Copyright 2026 NUMaters / CivilCraft contributors）

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

起動フローは **タイトル → メニュー（シングル／マルチ・遊び方）→ 読込完了後にゲームスタート → マップ本編**。タイトル／メニューでは Cesium を `React.lazy` で遅延読込し、メニューの読込中にチャンクを先読みする。一度マップを開いたあとは破棄せず裏に残し（`visibility: hidden`）、再入場の白画面を防ぐ。マルチは UI 上は暗い無効表示（未実装）。本編は準備 20 秒・大雨 60 秒・結果 20 秒（`packages/game-data/rules/game-timing.json`）。

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

環境変数の一覧は [docs/development/environment-variables.md](./docs/development/environment-variables.md)。DB 詳細は [docs/development/local-database.md](./docs/development/local-database.md)。

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
# フロントエンド開発サーバー（http://localhost:5173 、同一ネットワークの端末向けに 0.0.0.0:5173）
pnpm dev:web

# API サーバー（http://localhost:8080/health 、マスターデータ: /v1/game-data）
./bin/api

# ゲームサーバー（http://localhost:8081/health 、WebSocket: ws://localhost:8081/ws）
./bin/game
```

スマホなど同一ネットワーク上の端末からは、Mac の LAN IP（`pnpm dev:web` 起動時に表示される `Network:`）へアクセスする。例: `http://172.20.10.2:5173/`。接続できないときは macOS のファイアウォールで Node の着信を許可する。

マスターデータは `packages/game-data/`（土木技術・ルール・災害・マップ・シナリオ）。web は `@civilcraft/game-data`、server は `GAME_DATA_DIR`（既定で同ディレクトリを探索）経由で読み込む。

ゲーム中のリアルタイム通信は **WebSocket**（`cmd/game` の `GET /ws`）。開発時フロントは Vite の `/ws` プロキシ経由で接続し、ヘッダーに接続状態（オンライン／オフライン）を表示する。イベント型は `@civilcraft/game-schema`（`packages/game-schema/websocket/`）。Phase 1 ではカメラ注視点移動（`player.move`）と施設配置（`construction.place` / `construction.placed`）を薄く同期する。

Cesium の Worker / Assets は `apps/web/vite.config.ts` で `/cesiumStatic` として配信する（開発時は専用ミドルウェア、ビルド時は `dist/cesiumStatic` へコピー）。`CESIUM_BASE_URL` はサイトルート絶対パス（`/cesiumStatic`）である必要がある。`optimizeDeps.include` に `cesium` と `mersenne-twister` を入れ、CJS 依存の default export エラーで白画面になるのを防ぐ。地図が「Loading…」のまま止まる／真っ白な場合は、ポート 5173 の古い Vite を終了してから `pnpm --filter @civilcraft/web exec vite --force` で依存を再バンドルする。ローカル開発は iCloud Documents 配下だと Vite が落ちやすいため、`apps/web/scripts/dev-lan.mjs`（`0.0.0.0:5173`、watch 無効）での起動を推奨する。

3D 地図は CesiumJS + 国土地理院シームレス写真 + **PLATEAU-Terrain** + 郡山市公式 ZIP の **テクスチャ付き建築物 3D Tiles**（`bldg_texture`）を使う。初回は次で取得する（約 390MB ダウンロード、`public/plateau/` へ展開。Git 管理外）。

```bash
pnpm --filter @civilcraft/web fetch:plateau
```

カメラ移動は日本大学工学部周辺の阿武隈川プレイ範囲内に制限し、施設は建設ドックから河道・河岸（薄い青い帯、中心線片岸約 75 m）上へドラッグ＆ドロップでのみ配置する（市街地不可。地図タップでは配置しない。誤設置防止）。ドラッグ中はドックのアイコンではなく、地図上に**設置予定の立体モデル**がカーソルに追従する（配置可能域は青系、不可域は赤系）。ドロップ直後は仮配置（プレビュー）となり、施設上の小さな ✓／× で確定・キャンセルできる（Enter／Esc 対応。大きな確定バーは使わない）。ドックの各施設カードには `apps/web/public/icons/structures/` のシーン風 SVG イラスト（堤防断面・遊水地・排水機場・護岸・河道掘削）を大きく表示する。地図上の施設は単色ボックスではなく、土・芝・コンクリート・護岸石・水面などの手続きテクスチャ付き多層パーツ（`structureModels` / `structureMaterials`）で表現する。施設モデルは Cesium の ImageMaterial 相性問題を避けるため単色マテリアルで描画し、ドラッグ中は多パーツ再生成による白画面を防ぐため施設外形の簡易シルエットで追従する。モデル生成失敗時は簡易ボックスへフォールバックする。設置向きはカメラの向きに合わせ、仮配置中のみ**施設手前の向きスライダー**で回転できる（ドラッグ中もモデルと**影響圏**が同じ向きでライブ回転。確定後は向き固定。角度表示・左右ボタンなし）。ドックからのドラッグ中および仮配置中は影響圏（帯／楕円／扇）をプレビュー表示する（数値の防衛効果は確定後のみ）。確定前は地図ドラッグまたは矢印キーで仮配置の位置を細かく移せる（河道・河岸内のみ）。配置可能域（薄い青い帯）内ならドロップ位置をそのまま使い、中心線などへの強制スナップはしない。阿武隈川の水面は Cesium `Water` マテリアル（法線マップ＋波アニメ）と、**下流（北→南）へ進む**流向ストリークで表現する。洪水シミュレーションは `requestAnimationFrame` で水位を連続更新し、**フェーズ残り時間は壁時計に同期**する（フレーム負荷で 0.05 秒頭打ちにせず、不足分を複数ステップで追いつける。配置更新時も進行中の時間を巻き戻さない）。大雨フェーズでは Canvas の筋雨オーバーレイ＋空の暗転・霧で豪雨を演出し、溢れ・水深・被害が増えるほど雨脚が強まる（`resolveRainDrama`）。本川の水量帯・氾濫原・越水プルームは `CallbackProperty` と指数補間で滑らかに追従させる（Entity プロパティの差し替えや 0.25 秒刻みの段階切替によるカクつきを避ける）。平常時の本川幅はそのままに、水位が約 3.6 m を超えると氾濫寸前の河道沿い氾濫原（片岸約 200 m、越水時は最大約 320 m）を別レイヤで徐々に広げて表示する。計画高水位を超えると決壊地点（オレンジの決壊口）から、簡易浅水の高さ場で低地へ水が広がり、水深バンドと流向ストリークで溢れを表現する（地点名ラベルは出さない。真の流体ソルバではなく教育用近似）。浸水範囲は決壊地点起点のみとし、無関係な固定エリアへの浸水表示はしない。低い河岸ほど決壊しやすく、近傍の堤防・護岸（河岸配置・川沿い向き・標高）で抑えられる。施設の影響圏は種別ごと（堤防・護岸・掘削は**堤体長軸（向き+90°）に沿う帯**、遊水地は楕円、排水は扇形）で、模型の見た目と一致するよう追従する（仮配置中も可視化。数値の治水効果は確定後のみ）。HUD は雨勢・水位・被害など戦況指標を示し、配備数は簡潔に表示する（細かい防衛内訳は出さない）。弱点は越水・侵食・内水・流下不足に分かれ、施設ごとの `hazardAffinity`（強み／弱み）と一致しないと局所効果が薄い。ドックと HUD で得意分野を確認して配置する。ゲーム終了後は結果画面から「結果を自由に見る」（最終浸水状態のままカメラ拘束を外してプレビュー）または「新しくゲームを開始」（配置・予算をリセットして準備フェーズへ）を選べる。施設名などの地図ラベルは Cesium LabelGraphics ではなく HTML/CSS オーバーレイで描画し、日本語のギザつきを避ける。予算は初期 12,000 pt に加え、準備中 80 pt/s・災害中 110 pt/s で補給され、災害開始時に緊急 2,000 pt が付与される（所持上限 24,000 pt。施設の維持費は毎秒差し引き）。HUD に純増減（pt/s）を表示する。マップ検証中はブランドヘッダーとミッションカードを非表示。詳細は [docs/architecture/geospatial.md](./docs/architecture/geospatial.md) と [docs/game-design/ui-controls.md](./docs/game-design/ui-controls.md)。

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
| マップデータ形式 | [docs/architecture/map-data-format.md](./docs/architecture/map-data-format.md) |
| DB スキーマ（ルーム等） | [docs/architecture/db-schema.md](./docs/architecture/db-schema.md) |
| game-schema 設計   | [docs/architecture/game-schema-design.md](./docs/architecture/game-schema-design.md)       |
| ゲーム状態モデル   | [docs/architecture/game-state-model.md](./docs/architecture/game-state-model.md)           |
| ローカル DB 構成   | [docs/development/local-database.md](./docs/development/local-database.md)                 |
| 環境変数一覧 | [docs/development/environment-variables.md](./docs/development/environment-variables.md) |
| MVP 外データ方針 | [docs/development/mvp-scope-data.md](./docs/development/mvp-scope-data.md) |
| 地理空間アーキテクチャ | [docs/architecture/geospatial.md](./docs/architecture/geospatial.md)                    |
| CesiumJS 導入作業 | [docs/development/cesium-roadmap.md](./docs/development/cesium-roadmap.md)                  |

ルートの [AGENT.md](./AGENT.md) は `docs/agent/guide.md` への索引である。

## MVP

Phase 1（技術検証）+ Phase 2（最小ゲーム）を統合した初回リリース版。

- 1 つの河川マップ、1〜4 人プレイ（ソロ：ルームなし／マルチ：ルーム作成・一覧参加）
- 堤防・遊水地・排水機場・護岸・河道掘削の配置（複数人同時配置可）、大雨発生（台風なし）、簡易浸水判定、被災度・評価の表示、各技術の短い解説、結果画面での振り返り

詳細は [docs/game-design/overview.md#mvp](./docs/game-design/overview.md#mvp) を参照。
