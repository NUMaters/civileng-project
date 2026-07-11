# 通信方針

通信は、用途に応じて REST API と WebSocket を使い分けます。

ゲームの重要な判定はサーバー側で行い、クライアント側の表示内容だけを信用しない **サーバー権威型** の設計を基本とします。

## REST API

主にゲーム開始前後の処理に使用します。

命名規則は [REST API 命名](../api/rest-naming.md) に従うこと。

型定義は `packages/game-schema/` に集約し、散在させないこと。

### REST API 詳細

関連 Issue: [#9](https://github.com/NUMaters/civileng-project/issues/9)

## WebSocket

主にゲーム中のリアルタイム処理に使用します。

- プレイヤーの移動
- 土木施設の設置
- 河川水位の更新
- 災害イベントの通知
- ゲーム状態の同期
- 被災度の更新
- ゲーム終了通知

**MVP では実装しない：** チャット

命名規則は [WebSocket 命名](../api/websocket-naming.md) に従うこと。

型定義は `packages/game-schema/` に集約し、散在させないこと。

### WebSocket イベント詳細

関連 Issue: [#10](https://github.com/NUMaters/civileng-project/issues/10)

## 関連ドキュメント

- [REST API 命名](../api/rest-naming.md)
- [WebSocket 命名](../api/websocket-naming.md)
- [技術スタック](./tech-stack.md)
- [アーキテクチャ概要](./overview.md)
