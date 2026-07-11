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

ドキュメントの未確定事項は Issue で管理する。Issue 番号とドキュメントの対応は以下のとおり。

| Issue | 内容 | ドキュメント |
|-------|------|-------------|
| [#3](https://github.com/NUMaters/civileng-project/issues/3) | 開発環境（Makefile / docker-compose / 構築手順） | README.md |
| [#4](https://github.com/NUMaters/civileng-project/issues/4) | セッションフローの詳細 | session-flow.md |
| [#5](https://github.com/NUMaters/civileng-project/issues/5) | 被災度の定義 | game-rules.md, disasters.md |
| [#6](https://github.com/NUMaters/civileng-project/issues/6) | 予算パラメータ | game-rules.md |
| [#7](https://github.com/NUMaters/civileng-project/issues/7) | 固定役割 | game-rules.md, overview.md |
| [#8](https://github.com/NUMaters/civileng-project/issues/8) | スコアと多軸評価 | game-rules.md, overview.md |
| [#9](https://github.com/NUMaters/civileng-project/issues/9) | REST API 詳細 | communication.md, rest-naming.md |
| [#10](https://github.com/NUMaters/civileng-project/issues/10) | WebSocket イベント | communication.md, websocket-naming.md |
| [#11](https://github.com/NUMaters/civileng-project/issues/11) | 災害現象の詳細 | disasters.md |
| [#12](https://github.com/NUMaters/civileng-project/issues/12) | 大雨パラメータ | disasters.md |
| [#13](https://github.com/NUMaters/civileng-project/issues/13) | auth モジュール | overview.md |
| [#14](https://github.com/NUMaters/civileng-project/issues/14) | 操作・UI | ui-controls.md |
| [#15](https://github.com/NUMaters/civileng-project/issues/15) | MVP マップ構成 | setting.md |

## ラベル

GitHub Issue には以下のラベルを付与する。

### 種別

| ラベル | 用途 |
|--------|------|
| `documentation` | 仕様・設計ドキュメント |
| `chore` | 開発基盤・CI・ツール整備 |
| `enhancement` | 新機能の実装（将来の feature Issue 用） |
| `bug` | 不具合修正 |

### 領域

| ラベル | 用途 |
|--------|------|
| `game-design` | ゲームルール・セッション・評価 |
| `civil-engineering` | 土木技術・災害・マップ設定 |
| `architecture` | アーキテクチャ・モジュール設計 |
| `api` | REST / WebSocket 設計 |
| `ui` | 操作・UI 設計 |
| `devops` | 開発環境・インフラ |
| `ai` | AI / NPC 要素 |

### スコープ

| ラベル | 用途 |
|--------|------|
| `mvp` | MVP で必要 |
| `post-mvp` | MVP 以降の拡張 |

## 関連ドキュメント

- [ブランチ運用規則](../git/branch-strategy.md)
- [TODO ルール](./todo-rules.md)
