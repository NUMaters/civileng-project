# game-schema 型定義方針

REST / WebSocket の型定義を `packages/game-schema/` にどう分割・命名するかを定義する。

関連 Issue: [#19](https://github.com/NUMaters/civileng-project/issues/19)

---

## 概要

通信スキーマの型定義は **`packages/game-schema/` に集約** し、`apps/web` や `apps/server` に散在させない（[通信方針](./communication.md) 参照）。

TypeScript で定義し、web は直接 import、server は将来 code generation または手動対応で整合を取る。

---

## ディレクトリ構成

```
packages/game-schema/
├── common/           # REST / WebSocket 共通型
│   ├── position.ts   # 地理座標・方向（既存XYZ型は移行対象）
│   ├── structure.ts  # 施設種別・定義
│   └── disaster.ts   # 災害種別
├── rest/             # REST API リクエスト / レスポンス
│   ├── room.ts
│   └── player.ts
└── websocket/        # WebSocket イベント
    ├── client-events.ts   # クライアント → サーバー
    ├── server-events.ts   # サーバー → クライアント
    └── payloads.ts        # イベントペイロード
```

### 追加ルール

| ルール                | 内容                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| 1 ファイル 1 ドメイン | `room.ts` に player 型を混在させない                                          |
| 共通型は `common/`    | 複数プロトコルで使う型のみ                                                    |
| 禁止ディレクトリ名    | `utils`, `helpers`, `models`（[パッケージ構成](./package-structure.md) 参照） |

---

## 命名規則

### 型名

PascalCase。接頭辞 `I` は禁止（[命名規則](../development/naming-conventions.md) 参照）。

```typescript
export type RoomSummary = { ... };
export type PlayerMovePayload = { ... };
```

### REST

| 種類       | 命名                                                  | 例                            |
| ---------- | ----------------------------------------------------- | ----------------------------- |
| リクエスト | `<操作><Resource>Request`                             | `CreateRoomRequest`           |
| レスポンス | `<Resource>Response` / `<Resource>Summary`            | `RoomResponse`, `RoomSummary` |
| パス       | kebab-case 名詞（[REST 命名](../api/rest-naming.md)） | `/rooms`, `/rooms/:id`        |

### WebSocket

| 種類             | 命名                                  | 例                             |
| ---------------- | ------------------------------------- | ------------------------------ |
| イベント名       | `<domain>.<verb>`（文字列リテラル型） | `"room.join"`, `"player.move"` |
| ペイロード       | `<Domain><Verb>Payload`               | `PlayerMovePayload`            |
| クライアント送信 | `ClientEvent` union                   | `"room.join" \| "player.move"` |
| サーバー送信     | `ServerEvent` union                   | `"game.phaseChanged"`          |

詳細なイベント一覧は [Issue #9](https://github.com/NUMaters/civileng-project/issues/9), [#10](https://github.com/NUMaters/civileng-project/issues/10) で拡充する。

---

## server / web 間の共有方法

| 層               | 方法                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **web**          | `import type { ... } from "@civilcraft/game-schema/rest/room"`                                                               |
| **server（Go）** | MVP では手動で構造体を定義し、JSON タグで整合。将来 `packages/game-schema` から OpenAPI / JSON Schema を生成する選択肢を残す |
| **packages 間**  | `game-schema` は `game-data` に依存しない（型とデータの分離）                                                                |

### pnpm workspace 参照

```json
// apps/web/package.json
{
  "dependencies": {
    "@civilcraft/game-schema": "workspace:*"
  }
}
```

---

## 型定義の拡張方針

1. **MVP:** ロビー・ルーム・移動・施設配置・フェーズ変更に必要な最小型のみ
2. **Phase 2 後半:** マルチ同期用のイベント型を追加
3. **post-MVP:** エラーレスポンス・再接続用の型を追加

新規型追加時は `common/` に共通部分を抽出してから `rest/` または `websocket/` に配置する。

### 地理座標

CesiumJS 導入後、通信境界の位置は意味が不明確な `x`, `y`, `z` ではなく、次の地理座標型を使用する。

```typescript
export type GeoPosition = {
  longitude: number;
  latitude: number;
  height: number;
};
```

- 経度・緯度は度、標高はメートル
- CesiumJS固有の`Cartesian3`を通信スキーマへ含めない
- 浸水計算用のローカル座標・グリッド座標はサーバー内部型とし、必要になるまで公開スキーマへ追加しない
- 既存の`Position { x, y, z }`は移行が完了するまでのプロトタイプ型とする
- 配置要求はサーバー側で座標範囲と対象地域内であることを検証する

---

## 関連ドキュメント

- [通信方針](./communication.md)
- [REST API 命名](../api/rest-naming.md)
- [WebSocket 命名](../api/websocket-naming.md)
- [TypeScript コーディング規約](../development/coding-standards-typescript.md)
- [地理空間アーキテクチャ](./geospatial.md)
