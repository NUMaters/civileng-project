# 環境変数一覧

ローカル開発で使う環境変数を定義する。値のひな形はリポジトリルートの [`.env.example`](../../.env.example)。

関連 Issue: [#75](https://github.com/NUMaters/civileng-project/issues/75)

---

## セットアップ

```bash
cp .env.example .env
```

`.env` は Git 管理外。秘密情報をコミットしない。

---

## 変数一覧

### PostgreSQL / Redis（docker-compose と server 共通）

| 変数 | 既定値（例） | 用途 |
|------|--------------|------|
| `POSTGRES_USER` | `civilcraft` | Compose の DB ユーザー |
| `POSTGRES_PASSWORD` | `civilcraft` | Compose の DB パスワード |
| `POSTGRES_DB` | `civilcraft` | DB 名 |
| `POSTGRES_PORT` | `5432` | ホスト公開ポート |
| `DATABASE_URL` | `postgres://…@localhost:5432/civilcraft?sslmode=disable` | Go API / Game の接続文字列 |
| `REDIS_PORT` | `6379` | Redis ホスト公開ポート |
| `REDIS_URL` | `redis://localhost:6379/0` | Go からの Redis 接続 |

詳細な起動手順は [local-database.md](./local-database.md)。

### Server（`apps/server`）

| 変数 | 既定値（例） | 用途 |
|------|--------------|------|
| `API_ADDR` | `:8080` | `cmd/api` の listen アドレス |
| `GAME_ADDR` | `:8081` | `cmd/game` の listen アドレス（WebSocket `/ws`） |
| `GAME_DATA_DIR` | `packages/game-data` | マスターデータ JSON のルート（相対または絶対） |

### Web（Vite / `apps/web`）

| 変数 | 既定値（例） | 用途 |
|------|--------------|------|
| `VITE_GAME_WS_URL` | `/ws` | ゲーム WebSocket URL。開発時は Vite プロキシ経由 |

`VITE_*` のみクライアントに埋め込まれる。サーバー専用変数を `VITE_` プレフィックスで置かない。

---

## 関連

- [local-database.md](./local-database.md)
- [README.md](../../README.md) の初回セットアップ
