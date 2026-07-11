# レビュー基準

レビューでは以下を確認する。

- 可読性
- 保守性
- 命名
- パフォーマンス
- セキュリティ
- 拡張性

## GitHub Copilot コードレビュー

Copilot による PR レビューは以下の指示ファイルに従う。

| ファイル | 用途 |
|---------|------|
| [.github/instructions/code-review.instructions.md](../../.github/instructions/code-review.instructions.md) | レビュー形式・観点・Approve 基準 |
| [.github/copilot-instructions.md](../../.github/copilot-instructions.md) | リポジトリ共通の Copilot 指示 |

### レビューコメントのメタ情報

| タグ | 期待する対応 | 説明 |
| --- | --- | --- |
| `[ask]` | 回答必須 | 確認 |
| `[must]` | 修正必須 | この対応がされていないと Approve できない |
| `[imo]` | 修正任意 | この対応がされていなくても Approve できる |
| `[nits]` | 修正任意 | 細かい指摘 |
| `[next]` | 修正不要 | 今後の改善点 |
| `[good]` | - | 良い点 |
| `[suggestion]` | - | 提案 |

### 有効化

リポジトリ Settings → **Copilot** → **Code review** → 「Use custom instructions when reviewing pull requests」を ON にする。

参考: [Using custom instructions to unlock the power of Copilot code review](https://docs.github.com/en/copilot/tutorials/customize-code-review)

## 関連ドキュメント

- [AI Agent 開発ガイド](../agent/guide.md)
- [Pull Request](../git/pull-request.md)
