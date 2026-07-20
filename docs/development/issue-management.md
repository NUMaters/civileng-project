# Issue 運用

Issue 例:

```
feat: 河川水位シミュレーション
feat: 堤防建設
feat: チャット
feat: ロビー
fix: プレイヤー同期
docs: 被災度の定義
```

ドキュメントの未確定事項は Issue で管理する。実装・基盤・品質も同様に Issue で追跡する。

## マイルストーン

| マイルストーン | 位置づけ                                             |
| -------------- | ---------------------------------------------------- |
| **[Alpha-M1]** | 設計 docs の確定、開発基盤・リポジトリ整備           |
| **[Alpha-M2]** | Phase 1 / Phase 2 の実装（技術検証 → ソロ → マルチ） |
| **[Alpha-QA]** | MVP 統合・品質保証、post-MVP 拡張の計画              |

---

## 設計 docs（ドキュメント ↔ Issue）

| Issue                                                         | 内容                                  | ドキュメント                          |
| ------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| [#4](https://github.com/NUMaters/civileng-project/issues/4)   | セッションフローの詳細                | session-flow.md                       |
| [#5](https://github.com/NUMaters/civileng-project/issues/5)   | 被災度の定義                          | game-rules.md, disasters.md           |
| [#6](https://github.com/NUMaters/civileng-project/issues/6)   | 予算パラメータ                        | game-rules.md                         |
| [#7](https://github.com/NUMaters/civileng-project/issues/7)   | 固定役割（post-MVP）                  | game-rules.md, overview.md            |
| [#8](https://github.com/NUMaters/civileng-project/issues/8)   | スコアと多軸評価                      | game-rules.md, overview.md            |
| [#9](https://github.com/NUMaters/civileng-project/issues/9)   | REST API 詳細                         | communication.md, rest-naming.md      |
| [#10](https://github.com/NUMaters/civileng-project/issues/10) | WebSocket イベント                    | communication.md, websocket-naming.md |
| [#11](https://github.com/NUMaters/civileng-project/issues/11) | 災害現象の詳細                        | disasters.md                          |
| [#12](https://github.com/NUMaters/civileng-project/issues/12) | 大雨パラメータ                        | disasters.md                          |
| [#13](https://github.com/NUMaters/civileng-project/issues/13) | auth モジュール（post-MVP）           | overview.md                           |
| [#14](https://github.com/NUMaters/civileng-project/issues/14) | 操作・UI                              | ui-controls.md                        |
| [#15](https://github.com/NUMaters/civileng-project/issues/15) | MVP マップ構成                        | setting.md                            |
| [#17](https://github.com/NUMaters/civileng-project/issues/17) | 土木技術マスターデータ具体値          | techniques.md, game-data/structures/  |
| [#18](https://github.com/NUMaters/civileng-project/issues/18) | 勝利条件・クリア閾値                  | game-rules.md, game-data/rules/       |
| [#19](https://github.com/NUMaters/civileng-project/issues/19) | game-schema 型定義方針                | packages/game-schema/                 |
| [#20](https://github.com/NUMaters/civileng-project/issues/20) | ゲーム状態モデル（サーバー）          | architecture/                         |
| [#21](https://github.com/NUMaters/civileng-project/issues/21) | ローカル開発用 DB・Redis 構成         | README.md                             |
| [#79](https://github.com/NUMaters/civileng-project/issues/79) | DB スキーマ設計（ルーム・セッション） | architecture/                         |
| [#80](https://github.com/NUMaters/civileng-project/issues/80) | マップデータ形式の確定                | game-data/maps/, setting.md           |
| [#89](https://github.com/NUMaters/civileng-project/issues/89) | apps/admin スコープ定義（post-MVP）   | README.md                             |

---

## [Alpha-M1] 開発基盤・リポジトリ整備

| Issue                                                         | 内容                                             |
| ------------------------------------------------------------- | ------------------------------------------------ |
| [#3](https://github.com/NUMaters/civileng-project/issues/3)   | 開発環境（Makefile / docker-compose / 構築手順） |
| [#22](https://github.com/NUMaters/civileng-project/issues/22) | develop ブランチの作成とブランチ保護設定         |
| [#23](https://github.com/NUMaters/civileng-project/issues/23) | GitHub Actions CI パイプライン                   |
| [#24](https://github.com/NUMaters/civileng-project/issues/24) | モノレポ workspace 設定                          |
| [#25](https://github.com/NUMaters/civileng-project/issues/25) | ESLint / Prettier / golangci-lint 設定           |
| [#26](https://github.com/NUMaters/civileng-project/issues/26) | Copilot カスタム指示の develop への反映          |
| [#74](https://github.com/NUMaters/civileng-project/issues/74) | ルート package.json / pnpm workspace 初期化      |
| [#75](https://github.com/NUMaters/civileng-project/issues/75) | .env.example と環境変数一覧の整備                |
| [#76](https://github.com/NUMaters/civileng-project/issues/76) | GitHub Issue テンプレート作成                    |
| [#77](https://github.com/NUMaters/civileng-project/issues/77) | Dependabot / CodeQL 有効化                       |
| [#78](https://github.com/NUMaters/civileng-project/issues/78) | issue-management.md の Issue 一覧更新            |
| [#81](https://github.com/NUMaters/civileng-project/issues/81) | MVP 外データの整理方針                           |
| [#82](https://github.com/NUMaters/civileng-project/issues/82) | LICENSE 追加                                     |

---

## [Alpha-M2] 実装

### 基盤・選定

| Issue                                                         | 内容                                 |
| ------------------------------------------------------------- | ------------------------------------ |
| [#16](https://github.com/NUMaters/civileng-project/issues/16) | Client 表現基盤の技術基盤選定        |
| [#84](https://github.com/NUMaters/civileng-project/issues/84) | HTTP API サーバー骨格（cmd/api）     |
| [#86](https://github.com/NUMaters/civileng-project/issues/86) | ゲームサーバー骨格（cmd/game）       |
| [#88](https://github.com/NUMaters/civileng-project/issues/88) | DB マイグレーション初期化            |
| [#83](https://github.com/NUMaters/civileng-project/issues/83) | game-data 初期値の投入               |
| [#42](https://github.com/NUMaters/civileng-project/issues/42) | game-data マスターデータ読み込み基盤 |
| [#90](https://github.com/NUMaters/civileng-project/issues/90) | Unit Test 基盤（web / server）       |

### Phase 1（技術検証）

| Issue                                                         | 内容                                        |
| ------------------------------------------------------------- | ------------------------------------------- |
| [#27](https://github.com/NUMaters/civileng-project/issues/27) | CesiumJS と地理院タイルによる対象地域の表示 |
| [#28](https://github.com/NUMaters/civileng-project/issues/28) | スマホ向けタップ移動                        |
| [#29](https://github.com/NUMaters/civileng-project/issues/29) | 施設配置 UI（ローカル）                     |
| [#30](https://github.com/NUMaters/civileng-project/issues/30) | WebSocket 接続基盤（server）                |
| [#31](https://github.com/NUMaters/civileng-project/issues/31) | WebSocket クライアント接続                  |
| [#32](https://github.com/NUMaters/civileng-project/issues/32) | Phase 1 統合（移動・配置プロトタイプ）      |

### Phase 2 前半（ソロ完走）

| Issue                                                         | 内容                                 |
| ------------------------------------------------------------- | ------------------------------------ |
| [#33](https://github.com/NUMaters/civileng-project/issues/33) | 浸水・水位シミュレーション           |
| [#34](https://github.com/NUMaters/civileng-project/issues/34) | 大雨災害イベント進行                 |
| [#35](https://github.com/NUMaters/civileng-project/issues/35) | 施設建設・効果判定                   |
| [#36](https://github.com/NUMaters/civileng-project/issues/36) | 予算・維持費管理                     |
| [#37](https://github.com/NUMaters/civileng-project/issues/37) | ゲームフェーズ管理（準備/災害/結果） |
| [#38](https://github.com/NUMaters/civileng-project/issues/38) | ソロ用セッションフロー               |
| [#39](https://github.com/NUMaters/civileng-project/issues/39) | HUD（時間・予算・水位・フェーズ）    |
| [#40](https://github.com/NUMaters/civileng-project/issues/40) | 結果画面（被災度・評価表示）         |
| [#41](https://github.com/NUMaters/civileng-project/issues/41) | 5 種類土木技術のゲーム内実装         |
| [#43](https://github.com/NUMaters/civileng-project/issues/43) | Phase 2 前半統合（ソロ完走）         |

### Phase 2 後半（マルチ）

| Issue                                                         | 内容                                |
| ------------------------------------------------------------- | ----------------------------------- |
| [#44](https://github.com/NUMaters/civileng-project/issues/44) | ルーム作成・一覧・参加 API          |
| [#45](https://github.com/NUMaters/civileng-project/issues/45) | ロビー UI（名前・ルーム一覧・作成） |
| [#46](https://github.com/NUMaters/civileng-project/issues/46) | プレイヤー位置同期                  |
| [#47](https://github.com/NUMaters/civileng-project/issues/47) | 施設配置のマルチ同期                |
| [#48](https://github.com/NUMaters/civileng-project/issues/48) | ゲーム開始・ランダム技術割当        |
| [#49](https://github.com/NUMaters/civileng-project/issues/49) | プレイヤーごとの個人予算            |
| [#50](https://github.com/NUMaters/civileng-project/issues/50) | ゲーム開始直前のデータ読み込み      |
| [#51](https://github.com/NUMaters/civileng-project/issues/51) | Phase 2 後半統合（2〜4 人マルチ）   |

### AI / NPC（post-MVP）

| Issue                                                       | 内容                      |
| ----------------------------------------------------------- | ------------------------- |
| [#1](https://github.com/NUMaters/civileng-project/issues/1) | AI（NPC 要素の仕様作成）  |
| [#2](https://github.com/NUMaters/civileng-project/issues/2) | AI（NPC 要素の API 作成） |

---

## [Alpha-QA] 統合・品質・post-MVP

### MVP 統合・品質

| Issue                                                         | 内容                                  |
| ------------------------------------------------------------- | ------------------------------------- |
| [#52](https://github.com/NUMaters/civileng-project/issues/52) | packages/game-schema 型定義実装       |
| [#53](https://github.com/NUMaters/civileng-project/issues/53) | 各土木技術の短い解説表示              |
| [#54](https://github.com/NUMaters/civileng-project/issues/54) | MVP ルール統合（ソロ/マルチ全ルール） |
| [#55](https://github.com/NUMaters/civileng-project/issues/55) | 浸水シミュレーション Integration Test |
| [#56](https://github.com/NUMaters/civileng-project/issues/56) | ルーム同期 Integration Test           |
| [#57](https://github.com/NUMaters/civileng-project/issues/57) | MVP 向けスマホ UX 調整                |
| [#85](https://github.com/NUMaters/civileng-project/issues/85) | E2E（スマホ操作）                     |
| [#87](https://github.com/NUMaters/civileng-project/issues/87) | スマホ実機パフォーマンス検証          |

### post-MVP 拡張

| Issue                                                         | 内容                                |
| ------------------------------------------------------------- | ----------------------------------- |
| [#58](https://github.com/NUMaters/civileng-project/issues/58) | マルチプレイ再接続                  |
| [#59](https://github.com/NUMaters/civileng-project/issues/59) | 切断処理・ゲーム状態復元            |
| [#60](https://github.com/NUMaters/civileng-project/issues/60) | ルーム UI 強化                      |
| [#61](https://github.com/NUMaters/civileng-project/issues/61) | 土木技術図鑑                        |
| [#62](https://github.com/NUMaters/civileng-project/issues/62) | 初心者チュートリアル                |
| [#63](https://github.com/NUMaters/civileng-project/issues/63) | 阿武隈川事例紹介コンテンツ          |
| [#64](https://github.com/NUMaters/civileng-project/issues/64) | AWS デプロイ（ECS/RDS/ElastiCache） |
| [#65](https://github.com/NUMaters/civileng-project/issues/65) | PWA 対応                            |
| [#66](https://github.com/NUMaters/civileng-project/issues/66) | 台風災害種別の追加                  |
| [#91](https://github.com/NUMaters/civileng-project/issues/91) | ステージング環境構築                |

---

## ラベル

GitHub Issue には以下のラベルを付与する。

### 種別

| ラベル          | 用途                     |
| --------------- | ------------------------ |
| `documentation` | 仕様・設計ドキュメント   |
| `chore`         | 開発基盤・CI・ツール整備 |
| `enhancement`   | 新機能の実装             |
| `test`          | テスト・品質保証         |
| `bug`           | 不具合修正               |

### 領域

| ラベル              | 用途                           |
| ------------------- | ------------------------------ |
| `game-design`       | ゲームルール・セッション・評価 |
| `civil-engineering` | 土木技術・災害・マップ設定     |
| `architecture`      | アーキテクチャ・モジュール設計 |
| `api`               | REST / WebSocket 設計          |
| `ui`                | 操作・UI 設計                  |
| `devops`            | 開発環境・インフラ             |
| `ai`                | AI / NPC 要素                  |

### スコープ

| ラベル     | 用途           |
| ---------- | -------------- |
| `mvp`      | MVP で必要     |
| `post-mvp` | MVP 以降の拡張 |

## 関連ドキュメント

- [ブランチ運用規則](../git/branch-strategy.md)
- [TODO ルール](./todo-rules.md)
