# ブランチ運用規則

## 基本方針

本プロジェクトでは、原則として以下のブランチを使用する。

```text
main
develop
feature/*
fix/*
refactor/*
docs/*
test/*
chore/*
hotfix/*
```

すべての変更は作業用ブランチで行い、Pull Request を通してマージする。

```text
main への直接 Push は禁止
develop への直接 Push は禁止
```

## ブランチ構成

```text
main
  └── develop
        ├── feature/*
        ├── fix/*
        ├── refactor/*
        ├── docs/*
        ├── test/*
        └── chore/*
```

本番環境で緊急の修正が必要な場合のみ、`main` から `hotfix/*` を作成する。

```text
main
  └── hotfix/*
```

## main ブランチ

`main` は、常に本番環境へデプロイ可能な状態を維持する。

**用途:**

- 本番リリース
- リリースタグの作成
- 緊急修正の起点
- 安定版コードの管理

**禁止事項:**

- 直接 Push
- 作業途中のコードのマージ
- テストが失敗している状態でのマージ
- レビューなしでのマージ
- 動作確認されていない変更のマージ

`main` へのマージ元は、原則として以下のみとする。

```text
develop
hotfix/*
```

## develop ブランチ

`develop` は、次回リリース予定の変更を統合する開発ブランチとする。

**用途:**

- 各機能ブランチの統合
- ステージング環境へのデプロイ
- リリース前の結合テスト
- 複数機能を組み合わせた動作確認

各作業ブランチは、原則として `develop` から作成し、`develop` へ Pull Request を作成する。

```bash
git switch develop
git pull origin develop
git switch -c feature/123-levee-placement
```

## feature ブランチ

新しい機能を追加する場合に使用する。

**形式:**

```text
feature/<issue番号>-<機能名>
```

**例:**

```text
feature/12-room-creation
feature/25-levee-placement
feature/31-flood-simulation
feature/42-mobile-controls
feature/58-player-movement
```

| 作成元    | マージ先  |
| --------- | --------- |
| `develop` | `develop` |

1 つのブランチでは、原則として 1 つの Issue または 1 つの目的だけを扱う。

## fix ブランチ

開発中に発見された不具合を修正する場合に使用する。

**形式:**

```text
fix/<issue番号>-<修正内容>
```

**例:**

```text
fix/36-player-position-sync
fix/44-websocket-reconnect
fix/51-duplicate-room-join
fix/63-water-level-display
```

| 作成元    | マージ先  |
| --------- | --------- |
| `develop` | `develop` |

本番環境で発生している緊急障害には使用せず、`hotfix/*` を使用する。

## hotfix ブランチ

本番環境で緊急対応が必要な不具合を修正する場合に使用する。

**対象例:**

- ゲームへ接続できない
- データが破損する
- 認証が正常に動作しない
- サーバーが継続的に停止する
- セキュリティ上の重大な問題がある
- 主要機能が利用できない

**形式:**

```text
hotfix/<issue番号>-<修正内容>
```

**例:**

```text
hotfix/101-login-failure
hotfix/102-game-server-crash
hotfix/103-invalid-room-access
```

| 作成元 | マージ先          |
| ------ | ----------------- |
| `main` | `main`, `develop` |

`main` へマージした後は、同じ修正を必ず `develop` にも反映する。

```bash
git switch develop
git merge main
```

または、`develop` 向けに別の Pull Request を作成する。

## refactor ブランチ

外部仕様を変更せず、コード構造を改善する場合に使用する。

**形式:**

```text
refactor/<issue番号>-<対象>
```

**例:**

```text
refactor/65-room-manager
refactor/72-websocket-handler
refactor/81-flood-calculation
refactor/94-construction-module
```

**対象例:**

- 責務の分割
- 重複コードの整理
- 命名の改善
- パッケージ構成の変更
- 処理の単純化
- 依存関係の整理

新機能の追加や仕様変更を同時に含めない。

## docs ブランチ

ドキュメントのみを変更する場合に使用する。

**形式:**

```text
docs/<issue番号>-<対象>
```

**例:**

```text
docs/15-api-specification
docs/29-websocket-events
docs/33-setup-guide
docs/40-architecture
```

**対象例:**

- README
- API 仕様書
- WebSocket 仕様書
- アーキテクチャ設計書
- 開発環境構築手順
- ゲーム仕様書
- 土木技術の解説資料

## test ブランチ

テストの追加や修正を主目的とする場合に使用する。

**形式:**

```text
test/<issue番号>-<対象>
```

**例:**

```text
test/77-flood-simulation
test/82-room-service
test/89-websocket-reconnect
```

機能実装に付随するテストは、対象の `feature/*` や `fix/*` ブランチ内で追加してよい。

## chore ブランチ

機能へ直接影響しない保守作業に使用する。

**形式:**

```text
chore/<issue番号>-<作業内容>
```

**例:**

```text
chore/21-update-dependencies
chore/34-add-linter
chore/46-configure-ci
chore/57-update-dockerfile
```

**対象例:**

- 依存関係の更新
- Linter の設定
- Formatter の設定
- CI/CD の変更
- 開発ツールの追加
- 設定ファイルの整理

## ブランチ名の命名規則

ブランチ名は、以下の形式に統一する。

```text
<種類>/<issue番号>-<短い説明>
```

**使用可能な種類:**

```text
feature
fix
hotfix
refactor
docs
test
chore
```

説明部分は英小文字の `kebab-case` を使用する。

**良い例:**

```text
feature/25-levee-placement
fix/44-websocket-reconnect
refactor/65-room-manager
docs/29-websocket-events
```

**悪い例:**

```text
feature/LeveePlacement
feature/levee_placement
feature/add-levee-placement-function
feature/new
fix/bug
work/sato
test-branch
```

ブランチ名だけで、変更の目的を推測できるようにする。

## 1 ブランチ 1 目的

1 つのブランチには、1 つの目的だけを含める。

例えば、堤防設置機能の実装中にランキング画面の不具合を発見した場合、同じブランチで修正しない。

```text
feature/25-levee-placement
fix/90-ranking-layout
```

として分ける。

複数の目的を含めると、以下の問題が発生する。

- レビュー範囲が大きくなる
- 不具合の原因を特定しにくくなる
- 一部だけを取り消せない
- コンフリクトが増える
- Pull Request の目的が曖昧になる

## ブランチ作成前の手順

新しいブランチを作成する前に、基点となるブランチを最新化する。

```bash
git switch develop
git pull origin develop
git switch -c feature/25-levee-placement
```

古い `develop` から作業ブランチを作成しない。

緊急修正の場合は、最新の `main` から作成する。

```bash
git switch main
git pull origin main
git switch -c hotfix/101-game-server-crash
```

## 作業中の同期

長期間作業するブランチでは、定期的に `develop` の変更を取り込む。

```bash
git fetch origin
git rebase origin/develop
```

チームの運用方針として rebase を使用しない場合は、merge でもよい。

```bash
git fetch origin
git merge origin/develop
```

同一の Pull Request 内で、rebase と merge を無秩序に混在させない。

## rebase の規則

自分だけが使用している作業ブランチでは、コミット履歴を整理するために rebase してよい。

ただし、複数人が共同で使用しているブランチでは、原則として rebase しない。

**禁止例:**

```bash
git rebase develop
git push --force
```

共有済みブランチで履歴を書き換えると、他の開発者の作業へ影響するためである。

強制 Push が必要な場合は、`--force` ではなく `--force-with-lease` を使用する。

```bash
git push --force-with-lease
```

ただし、以下のブランチへの強制 Push は禁止する。

```text
main
develop
```

## Pull Request 作成前の確認

Pull Request を作成する前に、以下を確認する。

- 対象 Issue の要件を満たしている
- 不要な変更が含まれていない
- デバッグコードが残っていない
- Linter が成功する
- Formatter を実行している
- Unit Test が成功する
- ビルドが成功する
- 必要なドキュメントを更新している
- `develop` の最新変更を取り込んでいる
- コンフリクトが発生していない

```bash
make format
make lint
make test
make build
```

## Pull Request のマージ方式

通常の Pull Request では、原則として以下のいずれかを使用する。

```text
Squash and merge
```

または

```text
Rebase and merge
```

本プロジェクトでは、1 つの Pull Request を 1 つの変更単位として履歴へ残すため、基本は **Squash and merge** を推奨する。

**マージ後のコミット例:**

```text
feat(server): add levee placement (#25)
```

作業途中の細かなコミットを、そのまま `develop` へ残さない。

```text
fix
fix again
動いた
レビュー対応
修正
```

## マージ条件

以下の条件をすべて満たした場合のみマージできる。

- Pull Request の説明が記載されている
- CI がすべて成功している
- 必要なレビュー承認を得ている
- 未解決のレビューコメントがない
- コンフリクトがない
- 動作確認が完了している
- 関係のない変更が含まれていない
- 必要なテストが追加されている

作成者本人による自己マージは、チームルールで許可されている場合のみ行う。

## マージ後のブランチ削除

Pull Request をマージした後は、使用済みの作業ブランチを削除する。

**リモートブランチ:**

```bash
git push origin --delete feature/25-levee-placement
```

**ローカルブランチ:**

```bash
git branch -d feature/25-levee-placement
```

不要なブランチを残さず、ブランチ一覧を整理された状態に保つ。

## 長期間放置されたブランチ

長期間更新されていないブランチは、担当者へ確認したうえで削除または Draft Pull Request 化する。

**目安:** 14 日以上更新がない

長期間の作業が必要な場合は、Issue や Pull Request に現在の状況を記載する。

## Draft Pull Request

実装途中でも、以下の場合は Draft Pull Request を作成してよい。

- 設計について早めに意見が欲しい
- 変更範囲が大きい
- インターフェースを先に確認したい
- 他のメンバーの作業と競合する可能性がある
- 方針が正しいか確認したい

Draft Pull Request には、未完了の内容を明記する。

```markdown
## 未完了

- [ ] 堤防設置時の予算減算
- [ ] 複数プレイヤーへのイベント配信
- [ ] 異常系のテスト
```

## コンフリクト対応

コンフリクトは、原則として Pull Request の作成者が解消する。

解消時には、どちらか一方の変更を単純に削除せず、双方の変更意図を確認する。

不明な場合は、対象コードの作成者へ確認する。

コンフリクト解消後は、必ず以下を再実行する。

```bash
make lint
make test
make build
```

## ブランチ保護設定

GitHub では、`main` と `develop` に Branch Protection Rule を設定する。

**推奨設定:**

- Pull Request を必須にする
- 1 名以上のレビュー承認を必須にする
- CI 成功を必須にする
- 未解決コメントがある場合はマージ不可
- Force Push を禁止する
- ブランチ削除を禁止する
- 最新ブランチとの同期を必須にする
- 管理者にも規則を適用する

**保護対象:**

```text
main
develop
```

## リリース時の流れ

リリース可能な状態になったら、`develop` から `main` へ Pull Request を作成する。

```text
develop
  ↓ Pull Request
main
```

**Pull Request タイトル例:**

```text
release: v0.2.0
```

マージ後にタグを作成する。

```bash
git switch main
git pull origin main
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

リリース後は、`main` と `develop` の差分が意図した状態になっていることを確認する。

## 禁止事項

以下の操作は禁止する。

- `main` への直接 Push
- `develop` への直接 Push
- Issue と関係のない変更を含める
- 複数機能を 1 ブランチで実装する
- 他人の作業ブランチを無断で書き換える
- 共有ブランチへ安易に Force Push する
- CI が失敗している状態でマージする
- コンフリクトを未確認のまま解消する
- レビュー指摘を未解決のままマージする
- マージ済みブランチを長期間残す
- `tmp`、`test`、`work` など目的が不明なブランチ名を使用する

## ブランチ運用例

堤防設置機能を実装する場合:

```bash
git switch develop
git pull origin develop
git switch -c feature/25-levee-placement
```

実装後:

```bash
git add .
git commit -m "feat(server): add levee placement validation"
git push -u origin feature/25-levee-placement
```

その後、GitHub 上で以下の Pull Request を作成する。

```text
feature/25-levee-placement
    ↓
develop
```

レビュー・CI・動作確認が完了したら、`Squash and merge` でマージする。
