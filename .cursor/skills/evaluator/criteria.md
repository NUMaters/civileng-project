# Evaluator 閾値

各基準は **pass / fail** の二値。1つでも fail ならスプリント不合格。

## 品質ゲート（必須）

| ID | 基準 | 閾値 | 検証方法 |
|----|------|------|----------|
| Q-01 | Lint | exit code 0 | `make lint` |
| Q-02 | Test | exit code 0、失敗 0 件 | `make test` |
| Q-03 | Build | exit code 0 | `make build` |
| Q-04 | CI | GitHub Actions success | `gh pr checks` |

## UI（Playwright MCP）

| ID | 基準 | 閾値 | 検証方法 |
|----|------|------|----------|
| U-01 | ページ表示 | HTTP 200、主要要素が DOM に存在 | Playwright navigate + locator |
| U-02 | タップ操作 | 指定操作後に期待状態へ遷移 | Playwright click / tap |
| U-03 | エラー表示なし | コンソール error 0 件（許容リスト除く） | Playwright console 監視 |
| U-04 | モバイル幅 | 375px 幅でレイアウト崩れなし | Playwright viewport |

## API

| ID | 基準 | 閾値 | 検証方法 |
|----|------|------|----------|
| A-01 | Health | `GET /health` → 200 | `curl` |
| A-02 | レスポンス形式 | JSON が仕様どおりのフィールドを持つ | `curl` + jq |
| A-03 | エラーケース | 不正入力で 4xx を返す | `curl` |

## データベース（該当スプリントのみ）

| ID | 基準 | 閾値 | 検証方法 |
|----|------|------|----------|
| D-01 | 接続 | psql / redis-cli が成功 | `docker compose exec` |
| D-02 | マイグレーション | `make migrate` が exit 0 | `make migrate` |
| D-03 | データ整合 | 操作後に期待レコードが存在 | SQL クエリ |

## 仕様書の受け入れ基準

仕様書 `Sprint N` に列挙された基準は **すべて pass** 必須。Planner が書いた観測可能な文をそのままテストケースにする。

## 採点サマリー

```markdown
| カテゴリ | pass | fail | 合計 |
|----------|------|------|------|
| 品質ゲート | | | 4 |
| UI | | | 4 |
| API | | | 3 |
| DB | | | 3 |
| 受け入れ基準 | | | N |

総合: PASS / FAIL
```
