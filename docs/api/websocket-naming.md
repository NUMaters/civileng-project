# WebSocket 命名

命名規則は `<ドメイン>.<動詞>` 形式とする。

例：

```
room.join
player.move
construction.placed
```

## TODO：MVP イベント一覧

[通信方針](../architecture/communication.md) の MVP 範囲に含まれるイベントを定義する。

- [ ] Client → Server イベント名
- [ ] Server → Client イベント名
- [ ] 災害イベント通知・ゲーム状態同期・スコア更新に対応するイベント名

## TODO：MVP 対象外イベント

- [ ] チャット（`chat.send` 等）のイベント名

## 関連ドキュメント

- [通信方針](../architecture/communication.md)
- [REST API 命名](./rest-naming.md)
