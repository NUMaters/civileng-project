# ローカル開発用 DB・Redis 構成

ローカル開発環境における PostgreSQL / Redis の構成とマイグレーション方針を定義する。

関連 Issue: [#21](https://github.com/NUMaters/civileng-project/issues/21)

---

## 概要

ローカル開発では `docker-compose.yml` で PostgreSQL と Redis を起動する。アプリケーション（`apps/server`）は `.env` の接続 URL を参照する。

| サービス      | 用途                               |
| ------------- | ---------------------------------- |
| PostgreSQL 16 | 永続データ（ルーム、プレイヤー等） |
| Redis 7       | セッション・キャッシュ             |

---

## docker-compose サービス構成

| サービス   | イメージ             | コンテナ名            | ホストポート（既定） |
| ---------- | -------------------- | --------------------- | -------------------- |
| `postgres` | `postgres:16-alpine` | `civilcraft-postgres` | `5432`               |
| `redis`    | `redis:7-alpine`     | `civilcraft-redis`    | `6379`               |

### 起動・停止

```bash
make up      # バックグラウンド起動
make down    # 停止・コンテナ削除
```

起動確認:

```bash
docker compose ps
```

両サービスの `healthcheck` が `healthy` になることを確認する。

### データ永続化

PostgreSQL のデータは Docker ボリューム `postgres_data` に保存される。Redis はローカル開発では永続化しない（インメモリ）。

---

## 環境変数

`.env.example` をコピーして `.env` を作成する。サーバー／Web を含む全体一覧は [environment-variables.md](./environment-variables.md)。

```bash
cp .env.example .env
```

| 変数                | 既定値                                                                       | 説明                  |
| ------------------- | ---------------------------------------------------------------------------- | --------------------- |
| `POSTGRES_USER`     | `civilcraft`                                                                 | PostgreSQL ユーザー   |
| `POSTGRES_PASSWORD` | `civilcraft`                                                                 | PostgreSQL パスワード |
| `POSTGRES_DB`       | `civilcraft`                                                                 | データベース名        |
| `POSTGRES_PORT`     | `5432`                                                                       | ホスト側ポート        |
| `DATABASE_URL`      | `postgres://civilcraft:civilcraft@localhost:5432/civilcraft?sslmode=disable` | アプリ接続 URL        |
| `REDIS_PORT`        | `6379`                                                                       | ホスト側ポート        |
| `REDIS_URL`         | `redis://localhost:6379/0`                                                   | アプリ接続 URL        |

ポートを変更する場合は `.env` と `docker-compose.yml` の両方を整合させる。

---

## 接続確認

### PostgreSQL

```bash
docker compose exec postgres psql -U civilcraft -d civilcraft -c '\dt'
```

### Redis

```bash
docker compose exec redis redis-cli ping
# PONG
```

---

## マイグレーション方針

### ディレクトリ構成

```
apps/server/
├── cmd/migrate/main.go   # マイグレーション実行エントリポイント
└── migrations/           # SQL マイグレーションファイル（将来追加）
```

### 命名規則

マイグレーションファイルは連番 + 説明の snake_case とする。

```
000001_create_rooms_table.up.sql
000001_create_rooms_table.down.sql
```

### 実行手順

1. DB を起動する。

```bash
make up
```

2. マイグレーションを実行する。

```bash
make migrate
```

`make migrate` は `apps/server/cmd/migrate` をビルド・実行する。マイグレーション SQL が未配置の間は正常終了し、配置後は同コマンドで適用する。

3. ビルド済みバイナリから直接実行する場合。

```bash
make build
./bin/migrate
```

### 方針

- マイグレーションは **サーバー起動前** に適用する
- 本番環境では CI/CD またはデプロイ手順の一部として実行する（将来の #64 で詳細化）
- スキーマ変更は `apps/server/migrations/` に SQL として追加し、コード直書きしない

---

## 関連ドキュメント

- [README.md](../../README.md) — 開発環境セットアップ
- [技術スタック](../architecture/tech-stack.md) — PostgreSQL / Redis の用途
- [Issue #3](https://github.com/NUMaters/civileng-project/issues/3) — 開発基盤（docker-compose 導入）
