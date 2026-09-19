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

| 変数                | 既定値（例）                                             | 用途                       |
| ------------------- | -------------------------------------------------------- | -------------------------- |
| `POSTGRES_USER`     | `civilcraft`                                             | Compose の DB ユーザー     |
| `POSTGRES_PASSWORD` | `civilcraft`                                             | Compose の DB パスワード   |
| `POSTGRES_DB`       | `civilcraft`                                             | DB 名                      |
| `POSTGRES_PORT`     | `5432`                                                   | ホスト公開ポート           |
| `DATABASE_URL`      | `postgres://…@localhost:5432/civilcraft?sslmode=disable` | Go API / Game の接続文字列 |
| `REDIS_PORT`        | `6379`                                                   | Redis ホスト公開ポート     |
| `REDIS_URL`         | `redis://localhost:6379/0`                               | Go からの Redis 接続       |

詳細な起動手順は [local-database.md](./local-database.md)。

### Server（`apps/server`）

| 変数                | 既定値（例）             | 用途                                                         |
| ------------------- | ------------------------ | ------------------------------------------------------------ |
| `API_ADDR`          | `:8080`                  | `cmd/api` の listen アドレス                                 |
| `GAME_ADDR`         | `:8081`                  | Main Backend（WebSocket `/ws`・公開NPC API）のlistenアドレス |
| `GAME_DATA_DIR`     | `packages/game-data`     | マスターデータ JSON のルート（相対または絶対）               |
| `NPC_BACKEND_URL`   | `http://127.0.0.1:8082`  | Main BackendからNPC Backendへ接続する内部URL                 |
| `NPC_BACKEND_ADDR`  | `127.0.0.1:8082`         | `cmd/npc` のlistenアドレス                                   |
| `NPC_BACKEND_TOKEN` | ローカル用共有トークン   | Main BackendとNPC Backend間のBearer認証                      |
| `NPC_LLM_PROVIDER`  | `fixed`                  | NPC Backendの回答方式（`openai` / `ollama` / `fixed`）       |
| `NPC_LLM_BASE_URL`  | `http://127.0.0.1:11434` | Ollama API                                                   |
| `NPC_LLM_MODEL`     | `qwen3:14b`              | Ollamaモデル                                                 |
| `OPENAI_BASE_URL`   | `https://api.openai.com` | OpenAI API（NPC Backendだけが使用）                          |
| `OPENAI_MODEL`      | `gpt-4o-mini`            | OpenAIモデル（NPC Backendだけが使用）                        |
| `OPENAI_API_KEY`    | Secretとして設定         | OpenAIキー。Git・Web・Main Backendへ渡さない                 |

`cmd/game` と `cmd/npc` には同じ `NPC_BACKEND_TOKEN` を設定する。本番の `cmd/npc` をループバック以外でlistenさせる場合、このトークンは必須。公開インターネットへ直接露出せず、Main Backendからのみ到達できるネットワークへ配置する。

Goプロセスは `.env` を自動読込しない。ローカルではシェルの環境変数として設定してから起動する。PowerShellの例：

```powershell
$env:NPC_BACKEND_TOKEN="local-npc-backend-token"
$env:NPC_LLM_PROVIDER="openai"
$env:OPENAI_API_KEY="各自のキー"
```

### Web（Vite / `apps/web`）

| 変数               | 既定値（例） | 用途                                             |
| ------------------ | ------------ | ------------------------------------------------ |
| `VITE_GAME_WS_URL` | `/ws`        | ゲーム WebSocket URL。開発時は Vite プロキシ経由 |

`VITE_*` のみクライアントに埋め込まれる。サーバー専用変数を `VITE_` プレフィックスで置かない。

---

## 関連

- [local-database.md](./local-database.md)
- [README.md](../../README.md) の初回セットアップ
