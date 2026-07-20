# MVP 外データの整理方針

MVP 実装者が迷わないよう、スコープ外のコード・データの扱いを固定する。

関連 Issue: [#81](https://github.com/NUMaters/civileng-project/issues/81)

---

## 方針の原則

| 方針 | 意味 |
|------|------|
| **残す（stub）** | ファイルは残すが空／プレースホルダ。MVP ローダーは読まないか無視する |
| **残す（post-MVP）** | 将来機能用。README / Issue で post-mvp と明示 |
| **削除しない** | ディレクトリ scaffold はアーキテクチャ説明用に維持してよい |

MVP 中に本番パスから **import / 起動しない**こと。誤って有効化しないよう、エントリポイントや loader の allowlist で制御する。

---

## 対象一覧

### `packages/game-data/disasters/typhoon.json`

| 項目 | 内容 |
|------|------|
| 方針 | **残す（stub / post-MVP）** |
| 理由 | 台風は post-MVP（#66）。スキーマ例として有用 |
| MVP での扱い | シナリオは `heavy-rain` のみ。loader は typhoon をゲーム開始に使わない |
| 関連 | #66 |

### `apps/web/src/features/authentication/`

| 項目 | 内容 |
|------|------|
| 方針 | **残す（scaffold）** |
| 理由 | 将来のアカウント連携用ディレクトリ。現状は未配線でよい |
| MVP での扱い | ルーティング・App から import しない。ゲスト／ローカル playerId で進める |
| 関連 | post-MVP 認証 |

### `apps/server/internal/auth/`

| 項目 | 内容 |
|------|------|
| 方針 | **残す（scaffold）** |
| 理由 | サーバー側認証モジュールの置き場 |
| MVP での扱い | `cmd/api` / `cmd/game` から起動しない。ミドルウェア未接続 |
| 関連 | post-MVP 認証 |

### `apps/web/public/manifest.webmanifest`（PWA）

| 項目 | 内容 |
|------|------|
| 方針 | **残す（post-MVP）** |
| 理由 | PWA は Phase 5（#65）。manifest があっても Service Worker 未導入なら実質無効 |
| MVP での扱い | PWA インストールを要件にしない。必要なら HTML から link を外してもよいが削除は必須ではない |
| 関連 | #65 |

### `apps/admin/`

| 項目 | 内容 |
|------|------|
| 方針 | **残す（post-MVP / スコープ未確定）** |
| 理由 | 管理・マップ編集。#89 でスコープ定義 |
| MVP での扱い | CI の必須ビルド対象に含めない（現状どおり） |
| 関連 | #89 |

### `packages/game-data` の空配列・note 付き JSON

| 項目 | 内容 |
|------|------|
| 方針 | **残す（stub）** |
| 理由 | マスターの形を示す。値が空でもスキーマのドキュメントになる |
| MVP での扱い | 空でも loader が落ちないこと |

---

## 実装者チェックリスト

- [ ] 新機能を追加するとき、上記パスを「ついでに有効化」しない
- [ ] post-MVP ファイルを触る PR には `post-mvp` ラベルを付ける
- [ ] 削除する場合は本ドキュメントと #81 を更新してから行う

---

## 関連

- [issue-management.md](./issue-management.md) マイルストーン
- [game-design/overview.md](../game-design/overview.md) MVP 範囲
