## 概要

<!-- この PR で何を達成するか、1〜3 文で記載する -->

## 関連 Issue（任意）

<!-- Issue がある場合のみ記載。ない場合は「なし」 -->

- [ ] Issue あり
- [ ] Issue なし

**Issue がある場合:**

- Closes #
- Refs #

**Issue がない場合の理由:**

<!-- 例: 軽微な typo 修正 / レビュー指摘の即時対応 / 依存関係更新 など -->

## 変更種別

<!-- 該当するものにチェック -->

- [ ] `feature` — 新機能
- [ ] `fix` — 不具合修正
- [ ] `docs` — ドキュメントのみ
- [ ] `chore` — 開発基盤・CI・依存関係
- [ ] `refactor` — 外部仕様を変えないリファクタリング
- [ ] `test` — テスト追加・修正

## 実装内容

<!-- 主要な変更点を箇条書きで記載する -->

-
-

## スコープ確認

<!-- [開発ガイド](docs/agent/guide.md)・[MVP](docs/game-design/overview.md#mvp) の範囲内か確認 -->

- [ ] この PR の目的を達成している
- [ ] 1 ブランチ 1 目的（関係のない変更を含めていない）
- [ ] [命名規則](docs/development/naming-conventions.md)・[依存ルール](docs/architecture/dependency-rules.md)に違反していない
- [ ] [開発原則](docs/development/principles.md)の YAGNI に反する不要な抽象化を追加していない
- [ ] Issue 無しの TODO を残していない（[TODO ルール](docs/development/todo-rules.md)）

## ドキュメント

<!-- 該当するものにチェック。不要な場合は「なし」と記載 -->

- [ ] 仕様・設計ドキュメント（`docs/`）を更新した
- [ ] README / AGENT.md を更新した
- [ ] 更新なし（理由: ）

## テスト・品質

<!-- Makefile 整備前は個別コマンドでも可（[Issue #3](https://github.com/NUMaters/civileng-project/issues/3)） -->

- [ ] Linter / Formatter を実行した
- [ ] Unit Test を追加・更新した（重要処理は Integration Test も）
- [ ] ビルドが成功する
- [ ] `any` / `panic` / `fmt.Println` / `as any` を使用していない

```bash
# Makefile 整備後
make format
make lint
make test
make build
```

## 動作確認

<!-- 実際に確認した内容を記載する -->

| 確認項目 | 結果 | 備考 |
|---------|------|------|
| | ✅ / ❌ | |

## スクリーンショット / 録画

<!-- UI 変更がある場合は添付。なければ「なし」 -->

なし

## レビュー観点

<!-- レビュアーに特に見てほしい点。なければ「特になし」 -->

特になし

## 未完了（Draft PR の場合のみ）

<!-- Draft PR のときだけ記載。Ready for review の場合は削除 -->

- [ ]

## マージ後の作業

<!-- 該当するものにチェック -->

- [ ] 使用済みブランチを削除する
- [ ] 関連 Issue がある場合はステータスを更新する
- [ ] フォローアップ Issue が必要なら作成する

---

参照: [ブランチ運用規則](docs/git/branch-strategy.md) / [コミットメッセージ](docs/git/commit-message.md) / [Pull Request ガイド](docs/git/pull-request.md)
