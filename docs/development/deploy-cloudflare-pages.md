# Cloudflare Pages へのソロ静的デプロイ

CivilCraft Web（`apps/web`）を **Cloudflare Pages** に静的公開する手順です。  
現状のソロプレイはクライアント完結のため、Go / PostgreSQL なしで公開できます（デプロイ案α）。

想定コスト: **約 $0–15 / 月**（無料枠内ならほぼ $0。Workers Paid を使う場合は $5〜）。

## 前提

- Node.js 20+ / pnpm 10+
- Cloudflare アカウント
- リポジトリへの push 権限（GitHub Actions を使う場合）

本番ビルドでは地理院タイルを `cyberjapandata.gsi.go.jp` へ直接参照します（開発時の `/gsi-tiles` プロキシは不要）。  
PLATEAU 建物のローカル展開（`public/plateau/`、約 390MB）は **既定の本番ビルドから除外**します（iCloud 上の巨大コピー失敗を避けるため）。未配置でもリモート LOD1 / 地形 URL で動作します。含める場合は `CIVILCRAFT_INCLUDE_PLATEAU=1 pnpm --filter @civilcraft/web build`。

## 1. ローカルでビルド確認

```bash
# リポジトリルート
pnpm install
pnpm --filter @civilcraft/web build
pnpm --filter @civilcraft/web preview
# → http://127.0.0.1:4173/ で確認
```

ローカル（iCloud Documents 配下）では成果物を `~/.cache/civilcraft/web-dist` に出します。CI では `apps/web/dist` です。`CIVILCRAFT_OUT_DIR` で上書き可能です。

`dist/`（またはキャッシュ outDir）に `_redirects`（SPA フォールバック）と `_headers`（キャッシュ）が含まれることを確認します。

## 2. ダッシュボードから接続（初回おすすめ）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. このリポジトリを選択
3. **本番ブランチ** は `develop`（または Pages 用の作業ブランチ）にする。  
   **`main` は使わない** — 現状の `main` にはルート `package.json` / `pnpm-workspace.yaml` がなく、`apps/web/package.json` も空ファイルのため、必ず `ERR_PNPM_JSON_PARSE` で落ちる。
4. ビルド設定（**Deploy command は空のまま**。Pages が成果物ディレクトリをそのまま公開する）:

| 項目 | 値 |
|------|-----|
| Framework preset | None（または Vite） |
| Root directory | `/`（リポジトリルート） |
| Build command | `CI=true pnpm install --frozen-lockfile && CI=true pnpm --filter @civilcraft/web build` |
| Build output directory | `apps/web/dist` |
| Deploy command | （空・未設定） |
| Node version | `22`（Environment variables で `NODE_VERSION=22`） |

### よくある誤設定（ビルド失敗の典型）

次は **Git 連携の Build command に入れない**:

| 入れてはいけない例 | 理由 |
|--------------------|------|
| `wrangler login` | 対話ログインは CI で使えない。ローカル CLI 用 |
| `pnpm deploy:web` / `wrangler pages deploy` | それは手動デプロイ。Git 連携では Build のあとに Pages が自動公開する |
| `npx wrangler deploy` | Workers 向け。Pages の静的出力公開ではない |

失敗ログ例:

- `ERR_PNPM_JSON_PARSE` … `apps/web/package.json` が空 → **ブランチが `main` のまま**
- `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` … ルートに `package.json` がない → 同上、または Root directory が間違っている

5. デプロイ後、`*.pages.dev` URL でタイトル画面が出ることを確認

プロジェクト名の既定は `civilcraft`（`apps/web/wrangler.toml` と揃える）。

## 3. CLI から手動デプロイ

```bash
# Cloudflare にログイン（ブラウザ認証）
pnpm --filter @civilcraft/web exec wrangler login

# ビルド＋デプロイ
pnpm deploy:web
# または
pnpm --filter @civilcraft/web pages:deploy
```

## 4. GitHub Actions 自動デプロイ

ワークフロー: [`.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml)

必要な Secret / Variable（設定済みなら追加作業なし）:

| Secret / Variable | 内容 |
|-------------------|------|
| `CLOUDFLARE_API_TOKEN` | Pages 編集権限付き API トークン（または Wrangler OAuth トークン） |
| `CLOUDFLARE_ACCOUNT_ID` | アカウント ID |
| `ENABLE_CLOUDFLARE_PAGES` | `true` のとき push で自動デプロイ |

`main` / `develop` / `feat/web-water-flood-ux` への push（web / game-data 変更時）、または Actions の **Run workflow**（`workflow_dispatch`）で https://civilcraft.pages.dev/ へ公開されます。

## 5. カスタムドメイン（任意）

Pages プロジェクト → **Custom domains** でドメインを追加し、指示どおり DNS を設定します。

## トラブルシュート

| 症状 | 確認 |
|------|------|
| `ERR_PNPM_JSON_PARSE` / 空の package.json | 本番ブランチを `develop` に変更。`main` はモノレポ未整備 |
| Build に `wrangler login` が入っている | 上記の正しい Build command に差し替え。Deploy command は空 |
| 真っ白 / Cesium 404 | `dist/cesiumStatic/` があるか。ビルドログで Cesium コピー失敗がないか |
| リロード 404 | `_redirects` の `/* /index.html 200` が dist にあるか |
| タイルが出ない | 本番は地理院へ直接アクセス。端末・ネットワークのブロックを確認 |
| Actions がスキップ | `CLOUDFLARE_API_TOKEN` 未設定。Secret を追加するか `workflow_dispatch` で確認 |
| `Authentication error [code: 10000]` / `Invalid access token [code: 9109]` | GitHub Secret の API トークン期限切れ。Cloudflare Dashboard で Pages 編集権限付きトークンを再発行し、`CLOUDFLARE_API_TOKEN` を更新する。ローカルは `wrangler login` し直して `pnpm deploy:web` |
| 出力ディレクトリが見つからない | `CI=true` でビルドしているか（成果物は `apps/web/dist`） |

## 関連

- 技術スタック: [docs/architecture/tech-stack.md](../architecture/tech-stack.md)
- ローカル開発: [README.md](../../README.md)
