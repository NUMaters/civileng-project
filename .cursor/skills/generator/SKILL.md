---
name: generator
description: >-
  Implements one sprint task at a time from a product spec, self-evaluates, then
  hands off to the Evaluator. Use when implementing a sprint, running the
  Generator agent, or building features from docs/specs/.
disable-model-invocation: true
---

# Generator（ジェネレーター）

仕様書のスプリントを **1回に1機能ずつ** 実装するサブエージェント。

## 前提

- 仕様書: `docs/specs/SPR-*.md`（Planner 出力・`approved` 推奨）
- 規約: [docs/agent/guide.md](../../../docs/agent/guide.md)

## スプリントサイクル

```
1. スプリント選択（未完了の最小番号）
2. develop からブランチ作成
3. 実装（HOW はここで決める）
4. 自己評価
5. Evaluator に引き渡し
6. 不合格 → フィードバックを反映（最大2回）
7. 合格 → PR 作成・マージ待ち
```

## 1. スプリント選択

- 仕様書の `Sprint N` から **1つだけ** 選ぶ
- 依存スプリントが未完了なら先にそれを選ぶ
- [sprint-template.md](sprint-template.md) で進捗を記録する

## 2. ブランチ作成

```bash
git switch develop && git pull origin develop
git switch -c <種類>/<issue番号>-<短い説明>
```

種類: `feature` / `fix` / `chore` / `docs` / `test`（[branch-strategy.md](../../../docs/git/branch-strategy.md) 参照）

## 3. 実装

- [guide.md のチェックリスト](../../../docs/agent/guide.md) に従う
- 1 ブランチ 1 目的
- `any` / `panic` / `fmt.Println` / `as any` 禁止
- Issue 無し TODO 禁止

## 4. 自己評価（Evaluator 引き渡し前）

```bash
make format
make lint
make test
make build
```

[sprint-template.md](sprint-template.md) の自己評価欄を埋める。すべて ✅ でなければ Evaluator に渡さない。

## 5. Evaluator への引き渡し

以下を渡す:

```
スプリント: Sprint N（SPR-XXX）
ブランチ: <branch>
受け入れ基準: （仕様書からコピー）
変更ファイル: git diff --stat develop...HEAD
```

## 6. コミット・PR

- コミットメッセージ: 日本語 Conventional Commits（[commit-message.md](../../../docs/git/commit-message.md)）
- **Co-authored-by: Cursor を付けない**（`git commit-tree` で作成する場合は trailer なし）
- PR: [PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md) に沿う

## 禁止

- 複数スプリントを1 PR にまとめない
- 仕様書にない機能を追加しない（YAGNI）
- 自己評価未完了で Evaluator に渡さない

## 追加リソース

- 進捗テンプレート: [sprint-template.md](sprint-template.md)
