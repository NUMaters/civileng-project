# WebSocket 命名

命名規則は `<ドメイン>.<動詞>` 形式とする。

例：

```
room.join
player.move
construction.placed
```

## エンベロープ

```json
{ "type": "player.move", "payload": { ... } }
```

型定義は `packages/game-schema/websocket/` を正とする。

## MVP イベント一覧（Phase 1）

| 方向 | イベント | 用途 |
|------|----------|------|
| C→S | `session.ping` | アプリ層の疎通確認（加えてプロトコル Ping/Pong あり） |
| S→C | `session.pong` | ping 応答 |
| S→C | `session.state` | 接続直後のセッションスナップショット |
| S→C | `player.joined` / `player.left` | 接続・切断通知 |
| C→S | `player.move` | カメラ注視点（地理座標）の共有 |
| C→S | `construction.place` | 施設配置要求（プロトタイプはクライアント仮確定後に送信） |
| S→C | `construction.placed` | 配置のブロードキャスト |

詳細の拡充は [Issue #10](https://github.com/NUMaters/civileng-project/issues/10)。

## MVP 対象外イベント

チャット等のイベント名も [Issue #10](https://github.com/NUMaters/civileng-project/issues/10) で定義する。

## 関連ドキュメント

- [通信方針](../architecture/communication.md)
- [REST API 命名](./rest-naming.md)
- [game-schema 設計](../architecture/game-schema-design.md)
