---
applyTo: "**/*"
excludeAgent: "cloud-agent"
---

# CivilCraft — Copilot コードレビュー指示

## 目的

Pull Request の変更を多角的かつ厳格にレビューする。すべての指摘事項を出し切り、最高のコード品質を目指す。

- レビュー本文は **日本語** で記載する。
- 必要に応じて `docs/` 配下のプロジェクト規約を参照し、判断根拠を明示する。
- 外部 URL を根拠にする場合は、引用元リンクを必ず記載する。

## コメント形式（必須）

**すべてのレビューコメントの先頭**に、以下いずれかのメタ情報タグを付ける。

| タグ | 期待する対応 | 説明 |
| --- | --- | --- |
| `[ask]` | 回答必須 | 確認・質問 |
| `[must]` | 修正必須 | この対応がされていないと Approve できない |
| `[imo]` | 修正任意 | この対応がされていなくても Approve できる |
| `[nits]` | 修正任意 | 細かい指摘 |
| `[next]` | 修正不要 | 今後の改善点 |
| `[good]` | - | 良い点 |
| `[suggestion]` | - | 提案 |

例:

```text
[must] `packages/game-data/` への直書きは禁止です。マスターデータ化してください。（docs/architecture/overview.md）
```

## レビュー観点

以下をすべて確認し、問題があれば指摘する。

### スコープ・設計

- MVP 範囲（`docs/game-design/overview.md`）を逸脱していないか
- 1 PR 1 目的か（無関係な変更が混在していないか）
- YAGNI に反する過剰な抽象化・未使用機能がないか
- `docs/architecture/dependency-rules.md` の依存方向に違反していないか
- 適切なディレクトリに配置されているか（`docs/architecture/overview.md`）

### コード品質

- 可読性・保守性・命名（`docs/development/naming-conventions.md`）
- 単一責任・早期 return・ネストの深さ（`docs/development/development-rules.md`）
- Magic Number の直書き、Dead Code、デバッグ出力の残存

### 言語別規約

**TypeScript（`apps/web/`, `packages/`）**

- `strict` 維持、`any` / `as any` 禁止
- JSON は camelCase（`docs/development/naming-conventions.md`）

**Go（`apps/server/`）**

- `panic` 禁止、エラーは返す
- `fmt.Println` 禁止、Logger を使用
- `gofmt` / `goimports` / Context 渡し（`docs/development/coding-standards-go.md`）

### ゲーム・ドメイン

- サーバー権威型を崩していないか（`docs/architecture/communication.md`）
- ゲームバランス値のコード直書きがないか（`packages/game-data/` 管理）
- Issue 無しの TODO が残っていないか（`docs/development/todo-rules.md`）

### テスト

- 機能追加に Unit Test が含まれているか（`docs/development/testing.md`）
- Flood Simulation / Water Calculation / Room Sync には Integration Test が必要

### セキュリティ・パフォーマンス

- ハードコードされた秘密情報・認証情報
- WebSocket / REST の入力検証
- ゲームループ・シミュレーションの不要な計算量増加

### ドキュメント

- 仕様変更時に `docs/` の更新が必要なのに漏れていないか
- PR 説明が `.github/PULL_REQUEST_TEMPLATE.md` の要件を満たしているか

## レビュー手順

1. PR の目的と変更ファイル全体を把握する
2. セキュリティ・正確性・スコープ逸脱を最優先で確認する
3. 上記観点ごとに `[must]` / `[imo]` / `[nits]` 等で指摘を列挙する
4. 良い実装には `[good]` を付けて明示する
5. 判断に不明点がある場合は `[ask]` で質問する
6. Approve 可否を `[must]` の有無に基づいて明示する

## Approve 基準

- `[must]` の指摘が **0 件** であること
- テスト・ビルド・Lint が PR 説明または CI で確認済みであること
- MVP スコープとアーキテクチャ方針に整合していること

## 注意

- Issue 紐付けは PR ごとに任意。Issue がなくてもレビュー可能。
- ランキング機能は実装対象外（`docs/architecture/overview.md`）。
- `auth` は MVP 方針未確定（Issue #13 参照）。
