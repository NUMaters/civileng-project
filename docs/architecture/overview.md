# アーキテクチャ概要

## 基本方針

基本は **モジュラーモノリス** とする。

将来的に以下へ分離可能な構造にする。

- API Server
- Game Server

## バックエンドモジュール

機能単位で責務を分ける。初期段階から過度なマイクロサービス化は行わず、開発速度と保守性を優先する。

| モジュール | 役割 |
|-----------|------|
| `player` | プレイヤー管理 |
| `room` | ルーム管理（作成・参加・一覧。本編中のセッション結合は `game/session` が担当） |
| `game` | ゲーム状態管理 |
| `world` | ワールド・地形 |
| `construction` | 土木施設の設置判定 |
| `disaster` | 災害イベントの進行 |
| `simulation` | 水位・浸水範囲の計算 |
| `mapdata` | マップデータ |

`realtime` は `game/` 配下のサブモジュールとして配置する。`room` はトップレベル `internal/room/` にのみ置き、`game/` 配下に同名モジュールを作らない。

各モジュールの依存関係を明確にし、将来的に API Server / Game Server へ分割しやすい構造を維持する。

**ランキング機能は実装しない。** 過去のスキャフォールドが残っている場合は削除する。

### auth モジュール

関連 Issue: [#13](https://github.com/NUMaters/civileng-project/issues/13)

## ディレクトリ構成の役割分担

| 領域 | 役割 |
|------|------|
| `apps/web/src/game/` | CesiumJS に依存する地図表示・カメラ・地表入力とゲーム処理 |
| `apps/web/src/features/` | 建設・災害・ルーム・チュートリアルなど、ユーザー機能単位の処理 |
| `apps/web/src/components/` | アイテムバー・水位計などの表示コンポーネント |
| `apps/admin/` | 管理画面・マップ編集・シナリオ作成 |
| `apps/server/internal/<feature>/` | 機能単位のバックエンド（domain / application / infrastructure / presentation） |
| `apps/server/internal/room/` | ルーム管理（ロビー向け） |
| `apps/server/internal/game/` | 本編のゲーム状態（session / realtime / state / tick / snapshot） |
| `packages/game-schema/` | REST API・WebSocket イベントの型定義（散在禁止） |
| `packages/game-data/` | 土木技術・災害・シナリオ・マップ・ゲームルール定数のマスターデータ（コード直書き禁止） |
| `packages/ui/` | 共通 UI コンポーネント |
| `packages/config/` | ESLint, TypeScript 等の共通設定 |
| `assets/` | 3D モデル、テクスチャ、サウンド、マップ |
| `infra/` | Terraform, Docker, 監視設定 |

## 関連ドキュメント

- [技術スタック](./tech-stack.md)
- [通信方針](./communication.md)
- [パッケージ構成](./package-structure.md)
- [依存ルール](./dependency-rules.md)
- [ディレクトリ追加ルール](./directory-rules.md)
- [ゲーム概要](../game-design/overview.md)
- [地理空間アーキテクチャ](./geospatial.md)
