# パッケージ構成

機能単位で管理する。モジュール一覧は [アーキテクチャ概要](./overview.md) のバックエンドモジュールに準拠する。

```
player/
room/
game/
world/
construction/
disaster/
simulation/
mapdata/
```

`realtime` は `game/` 配下のサブモジュールとして配置する。`room` はトップレベルの `room/` のみとし、`game/room/` は作らない。

以下のような意味のない名前は禁止。

```
utils
common
helpers
models
services
```

## 関連ドキュメント

- [アーキテクチャ概要](./overview.md)
- [依存ルール](./dependency-rules.md)
