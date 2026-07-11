# 開発ルール

- `main` / `develop` への直接 Push 禁止
- 作業ブランチ名は `<種類>/<issue番号>-<短い説明>` 形式（[ブランチ運用規則](../git/branch-strategy.md) 参照）
- 1 ブランチ 1 目的（[ブランチ運用規則](../git/branch-strategy.md) 参照）
- 必ず Pull Request を作成する
- 動作確認後 Merge
- Linter 通過必須
- Test 通過必須
- ビルド成功必須
- Dead Code は禁止
- Console 出力を残さない
- Magic Number は禁止（定数化する）
- 1 関数 100 行以内を目安
- ネストは 3 段以内を推奨
- 早期 return を意識する
- 可読性を最優先する

## 関連ドキュメント

- [開発原則](./principles.md)
- [ブランチ運用規則](../git/branch-strategy.md)
- [Pull Request](../git/pull-request.md)
