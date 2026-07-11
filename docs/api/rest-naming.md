# REST API 命名

名詞で表現する。動詞は禁止。

例：

```
GET    /rooms
POST   /rooms
GET    /rooms/:id
DELETE /rooms/:id
```

禁止例:

```
/createRoom
/deleteRoom
/getRoom
```

## TODO：REST API エンドポイント一覧

[通信方針](../architecture/communication.md) の MVP 範囲に含まれるエンドポイントを定義する。

- [ ] エンドポイントパスと HTTP メソッド
- [ ] リクエスト/レスポンス形式（`packages/game-schema/`）

## 関連ドキュメント

- [通信方針](../architecture/communication.md)
