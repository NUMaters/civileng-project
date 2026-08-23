# SPR-002: マルチプレイヤー仕様

> 作成日: 2026-08-23  
> 対象: Alpha-M2 / Phase 2 後半  
> 状態: 確定事項反映版

## 1. 目的

CivilCraft における 2〜4 人のマルチプレイヤーについて、プレイヤー、ルーム、ゲームセッション、リアルタイム同期、ゲーム終了までの仕様を定義する。

マルチプレイヤーは既存のモジュラーモノリス構成を維持し、REST API と WebSocket を使用する。ゲーム本編の状態はサーバーを正とする。

---

## 2. システム構成

バックエンドは以下の2つのプロセスで構成する。

| プロセス | 責務 |
|---|---|
| `apps/server/cmd/api` | プレイヤー発行、ルーム管理、ゲーム開始要求 |
| `apps/server/cmd/game` | WebSocket通信、ゲームセッション管理、ゲーム状態管理、リアルタイム同期 |

`apps/server/cmd/game` は複数のゲームセッションを同時に管理する。

```text
apps/server/cmd/game
├── Session A
│   ├── Player 1
│   └── Player 2
├── Session B
│   ├── Player 3
│   ├── Player 4
│   └── Player 5
└── Session C
    ├── Player 6
    └── Player 7
```

各ゲームセッションの状態およびWebSocketイベントは完全に分離する。

Redisは本マルチプレイヤー仕様では使用しない。

---

## 3. プレイヤー

### 3.1 プレイヤー識別子

`playerId` は API Server が UUID として発行する。

クライアント側で `playerId` を生成しない。

発行された `playerId` はブラウザの `sessionStorage` に保存する。

同一タブでは、ルーム参加からゲーム本編まで同じ `playerId` を使用する。

タブを閉じた場合、保持していた `playerId` は破棄される。

### 3.2 表示名

プレイヤーは `displayName` を持つ。

`displayName` は以下の規則に従う。

- 1〜20文字
- 入力値の前後の空白を除去する
- 空文字を許可しない
- 同一ルーム内で同じ `displayName` を許可する

プレイヤーの一意性は `displayName` ではなく `playerId` で判定する。

---

## 4. ルーム

### 4.1 参加人数

マルチプレイヤールームの参加人数は2〜4人とする。

最大参加人数は4人固定とする。

### 4.2 ルーム状態

ルームは以下の状態を持つ。

```text
open
in_game
closed
```

### 4.3 ルーム一覧

参加可能な `open` 状態のルームを一覧表示する。

独自のルーム名は持たない。

一覧上ではルーム作成者の `displayName` を使用してルームを表示する。

例:

```text
Ginga のルーム     2 / 4
Tanaka のルーム    3 / 4
```

ルームの実際の識別には `roomId` を使用する。

### 4.4 参加方法

プレイヤーはルーム一覧から参加する。

参加コードによる参加は実装しない。

QRコード等による招待も実装しない。

### 4.5 参加条件

以下の条件をすべて満たす場合にルームへ参加できる。

- ルームが存在する
- ルームが `open`
- 参加人数が4人未満
- 同一 `playerId` が現在参加していない

### 4.6 ゲーム開始権限

ゲーム開始操作はルーム作成者のみ実行できる。

ゲーム開始要求時の参加人数は2〜4人とする。

### 4.7 ロビー同期

ロビー状態はREST APIのpollingで同期する。

polling間隔は **2秒** とする。

ロビー画面では、ルーム状態および参加者状態を2秒ごとに取得する。

### 4.8 ルーム退出

`open` 状態のルームから退出できる。

退出したプレイヤーは現在の参加者から除外する。

### 4.9 作成者の退出

ルーム作成者が退出した場合、そのルームを `closed` にする。

ホスト権限を他プレイヤーへ移譲しない。

---

## 5. ゲームセッション生成

### 5.1 Sessionの生成

ルーム作成者がゲーム開始を要求した時点でゲームセッションを生成する。

生成直後のSessionはゲーム本編を開始せず、参加者のready待ち状態とする。

```text
Room
  │
  │ ゲーム開始要求
  ▼
Session生成
  │
  ▼
ready待ち
```

1つのルームに対して同時に1つのSessionだけを存在させる。

### 5.2 Session情報の受け渡し

API Serverが作成したSession情報はPostgreSQLへ保存する。

Game Serverは `sessionId` を使用してPostgreSQLからSessionの開始情報を読み込む。

Sessionの受け渡しにRedisは使用しない。

### 5.3 ゲーム開始直前の読み込み

ゲーム開始要求後、各クライアントはゲーム本編に必要なゲームデータを読み込む。

ゲームデータの読み込み、クライアント初期化、WebSocket接続が完了したプレイヤーは、Game Serverへ以下のWebSocketイベントを送信する。

```text
session.ready
```

WebSocketへ接続しただけではreadyとはみなさない。

### 5.4 ready待ち

ready待ち時間はゲーム開始要求から **30秒** とする。

全参加者が30秒以内にreadyになった場合、その時点でready待ちを終了する。

30秒経過時点でreadyになっていない非作成者は、そのゲームセッションの参加者から除外する。

### 5.5 作成者のready timeout

ルーム作成者が30秒以内にreadyにならなかった場合、Sessionを破棄する。

他のプレイヤーが2人以上readyであってもゲームは開始しない。

Session破棄後、Roomは `open` に戻る。

### 5.6 最終参加人数

30秒経過後、作成者がreadyであり、readyプレイヤーが2人以上いる場合、そのプレイヤーだけを最終参加者としてゲームを開始する。

readyプレイヤーが1人以下の場合、Sessionを破棄し、Roomを `open` に戻す。

例:

```text
Creator A   ready
Player B    ready
Player C    ready
Player D    timeout

→ A / B / C の3人で開始
```

### 5.7 土木技術の割り当て

土木技術のランダム割り当ては最終参加者確定後に行う。

5種類の土木技術を参加者へ重複なく割り当て、チーム全体で5種類すべてを使用可能にする。

人数別の割当数は以下とする。

| 人数 | 割当数 |
|---:|---|
| 2 | 3 / 2 |
| 3 | 2 / 2 / 1 |
| 4 | 2 / 1 / 1 / 1 |

### 5.8 初期予算

マルチプレイヤーの初期予算は1プレイヤーあたり **8,500pt** とする。

予算はプレイヤーごとに独立して管理する。

---

## 6. WebSocket接続

WebSocketエンドポイントは `/ws` を使用する。

接続時に `sessionId` と `playerId` をQuery Parameterとして渡す。

```text
/ws?sessionId=<sessionId>&playerId=<playerId>
```

Game Serverは、接続要求された `sessionId` と `playerId` を対象Sessionと照合する。

WebSocketイベントの型定義は `packages/game-schema/websocket/` を正とする。イベント名は `<domain>.<verb>` 形式とする。

---

## 7. Session管理

Game Serverは複数のSessionを `sessionId` 単位で管理する。

```text
SessionRegistry
├── session A
├── session B
└── session C
```

各Sessionは以下を独立して管理する。

- 参加プレイヤー
- プレイヤー位置
- プレイヤー接続状態
- 個人予算
- 担当土木技術
- 配置済み施設
- ゲームフェーズ
- 洪水状態
- 被災度

異なるSession間で状態を共有しない。

異なるSessionへWebSocketイベントを配信しない。

---

## 8. Server Authoritative

ゲーム進行中のゲーム状態はGame Serverのメモリを正とする。

クライアントは操作要求を送信し、Game Serverが検証・確定した結果を各クライアントへ配信する。

Serverが管理する状態は以下とする。

- プレイヤー位置
- プレイヤー接続状態
- プレイヤー予算
- プレイヤー担当土木技術
- 配置済み施設
- ゲームフェーズ
- 河川水位
- 浸水状態
- 被災度
- 勝敗

---

## 9. プレイヤー位置

### 9.1 プレイヤー位置の定義

プレイヤー位置は、各プレイヤーがCesiumJS上で現在操作しているマップ上の地点とする。

プレイヤーキャラクターは配置しない。

### 9.2 表示

各プレイヤーの位置は地表上の平面円マーカーとして表示する。

自分自身を含む全プレイヤーのマーカーを表示する。

切断中のプレイヤーのマーカーは表示しない。

### 9.3 位置送信

ClientからGame Serverへの位置更新には以下を使用する。

```text
player.move
```

位置が変化している場合のみ送信する。

送信頻度は最大 **5回/秒** とする。

最短送信間隔は200msとする。

### 9.4 位置配信

Game Serverで確定したプレイヤー位置は以下のイベントで配信する。

```text
player.moved
```

payload:

```json
{
  "playerId": "uuid",
  "position": {
    "longitude": 140.0,
    "latitude": 37.0,
    "height": 250.0
  }
}
```

`player.moved` は同一Session内の全クライアントへ配信する。

位置更新を送信した本人にも配信する。

---

## 10. 施設配置

ClientからGame Serverへの施設配置要求には以下を使用する。

```text
construction.place
```

Game Serverが配置の成否を決定する。

### 10.1 配置競合

複数プレイヤーから競合する施設配置要求を受信した場合、**サーバー受信順の先着優先**とする。

先に受信した要求を検証し、確定後のゲーム状態を基準として後続要求を判定する。

### 10.2 配置成功

配置成功時は以下を同一Sessionへ配信する。

```text
construction.placed
```

### 10.3 配置失敗

配置失敗時は要求元クライアントへ以下を返す。

```text
construction.rejected
```

payload:

```text
clientPlacementId
reason
```

`reason` は以下の固定値とする。

```text
structure_not_assigned
insufficient_budget
invalid_phase
invalid_position
placement_conflict
```

| reason | 意味 |
|---|---|
| `structure_not_assigned` | 対象土木技術がプレイヤーに割り当てられていない |
| `insufficient_budget` | 予算不足 |
| `invalid_phase` | 現在のフェーズでは配置できない |
| `invalid_position` | 配置位置が条件を満たさない |
| `placement_conflict` | 先に確定した施設と競合する |

ServerからUI表示用の文章は送信しない。

クライアントは `reason` に対応する表示文言を決定する。

---

## 11. ゲームフェーズ

ゲームフェーズは以下の順序で進行する。

```text
preparation
    ↓
disaster
    ↓
result
```

`finished` フェーズは設けない。

Sessionの終了状態はゲームフェーズとは別に管理する。

フェーズの開始・終了・遷移はGame Serverが決定する。

### 11.1 フェーズ変更イベント

フェーズ変更時は以下を配信する。

```text
game.phaseChanged
```

payload:

```text
phase
phaseStartedAt
phaseEndsAt
```

時刻値はUnix millisecondsとする。

---

## 12. 洪水・被災状態同期

洪水・被災状態はGame Serverを正とする。

更新イベントは以下とする。

```text
simulation.updated
```

payload:

```text
waterLevel
damagePercent
floodedCells[]
  ├── cellId
  └── depth
```

### 12.1 waterLevel

現在の河川水位を表す。

### 12.2 damagePercent

現在のチーム被災度を表す。

### 12.3 floodedCells

浸水しているグリッドセルを表す。

各セルは以下を持つ。

```text
cellId
depth
```

シミュレーション内部の計算途中状態はWebSocket payloadに含めない。

### 12.4 送信頻度

`simulation.updated` は**シミュレーションtickごと**に同一Session内の全クライアントへ配信する。

---

## 13. 初期状態同期

WebSocket接続後、クライアントへ以下を送信する。

```text
session.state
```

`session.state` は対象クライアントが現在のゲーム状態へ同期するための完全な初期スナップショットとする。

構造は以下とする。

```text
sessionId
playerId

phase
phaseStartedAt
phaseEndsAt

players[]
  ├── playerId
  ├── displayName
  ├── position
  └── connected

placements

budget
assignedStructures

simulation
  ├── waterLevel
  ├── damagePercent
  └── floodedCells[]
      ├── cellId
      └── depth
```

`players` はSession参加者全員を含む。

`budget` と `assignedStructures` は、`session.state` を受信する本人の情報のみを含む。

---

## 14. WebSocketイベント

確定したイベント一覧は以下とする。

### Client → Server

| イベント | 用途 |
|---|---|
| `session.ping` | 疎通確認 |
| `session.ready` | ゲーム開始準備完了 |
| `player.move` | プレイヤー位置更新 |
| `construction.place` | 施設配置要求 |

### Server → Client

| イベント | 用途 |
|---|---|
| `session.pong` | 疎通確認応答 |
| `session.state` | Session初期状態 |
| `player.joined` | プレイヤー接続 |
| `player.left` | プレイヤー切断 |
| `player.moved` | プレイヤー位置更新 |
| `construction.placed` | 施設配置成功 |
| `construction.rejected` | 施設配置失敗 |
| `game.phaseChanged` | ゲームフェーズ変更 |
| `simulation.updated` | 洪水・被災状態更新 |

共通のWebSocketエラーイベントは設けない。

操作失敗は操作ごとの結果イベントで通知する。

---

## 15. 時刻表現

RESTおよびWebSocketで扱うゲーム時刻は **Unix milliseconds** で表現する。

対象には以下を含む。

- `phaseStartedAt`
- `phaseEndsAt`
- `serverTime`
- その他ゲーム進行に使用する時刻

---

## 16. 切断

### 16.1 1プレイヤーの切断

1人のプレイヤーが切断してもSessionを継続する。

切断したプレイヤーについて以下を保持する。

- PlayerState
- 残予算
- 担当土木技術
- 配置済み施設

担当土木技術を残存プレイヤーへ再割り当てしない。

切断したプレイヤーの位置マーカーは非表示にする。

再接続による状態復元は実装しない。

### 16.2 全員切断

接続中プレイヤーが0人になった時点でSessionを即座に終了する。

この終了は正常終了として扱う。

---

## 17. Game Server停止

Game Serverプロセスが停止した場合、進行中Sessionを復元しない。

再起動時に残っている進行中Room / Sessionは終了処理の対象とする。

この終了は正常終了として扱う。

---

## 18. Session終了

通常のゲーム終了時は以下の順序で処理する。

```text
result
  ↓
最終結果確定
  ↓
全Clientへ結果通知
  ↓
WebSocket close
  ↓
Sessionをメモリから削除
  ↓
Room / Session関連DBレコードを削除
```

Result画面はWebSocketで受信済みの結果データを表示する。

ユーザーはResult画面からゲームメニューへ戻る。

Game Server停止などにより結果を受信できずWebSocketが切断された場合はゲームメニューへ戻る。

---

## 19. 再プレイ

終了済みRoomを再利用しない。

再プレイする場合はゲームメニューから新しいRoomを作成する。

---

## 20. 永続化

### 20.1 PostgreSQL

PostgreSQLは、ルームおよびSessionをゲーム開始・進行させるための共有情報として使用する。

ゲーム開始時、API ServerがSession情報を保存し、Game Serverが `sessionId` で取得する。

### 20.2 ゲーム進行中

ゲーム進行中の権威状態はGame Serverのメモリに保持する。

ゲーム状態をリアルタイムにPostgreSQLへ永続化しない。

### 20.3 ゲーム履歴

ゲーム履歴を保存しない。

以下をゲーム終了後の履歴として保持しない。

- 最終予算
- 最終プレイヤー位置
- 配置施設履歴
- 最終浸水状態
- 最終被災度
- 勝敗履歴
- 過去Session

ゲーム終了後、Room / Session関連DBレコードを削除する。

ランキング、戦績閲覧、リプレイ、過去結果閲覧は本仕様の対象外とする。

---

## 21. REST API

確定したREST APIは以下の7エンドポイントとする。

```text
POST   /players
GET    /rooms
POST   /rooms
GET    /rooms/{roomId}
POST   /rooms/{roomId}/members
DELETE /rooms/{roomId}/members/{playerId}
POST   /rooms/{roomId}/sessions
```

| Endpoint | 用途 |
|---|---|
| `POST /players` | プレイヤー発行 |
| `GET /rooms` | 参加可能ルーム一覧 |
| `POST /rooms` | ルーム作成 |
| `GET /rooms/{roomId}` | ルーム詳細・ロビーpolling |
| `POST /rooms/{roomId}/members` | ルーム参加 |
| `DELETE /rooms/{roomId}/members/{playerId}` | ルーム退出 |
| `POST /rooms/{roomId}/sessions` | ゲーム開始要求・Session生成 |

参加コード用API、ホスト移譲API、再プレイAPIは設けない。

---

## 22. RESTエラー

REST APIのエラーレスポンスは以下の構造に統一する。

```json
{
  "error": {
    "code": "ROOM_FULL",
    "message": "Room is full."
  }
}
```

クライアントの処理分岐には `error.code` を使用する。

`error.message` の文字列を解析して処理を分岐しない。

---

## 23. マルチプレイヤーのゲームフロー

```text
プレイヤー発行
    ↓
sessionStorageへplayerId保存
    ↓
ルーム一覧
    ↓
Room作成 / 参加
    ↓
2秒間隔REST polling
    ↓
作成者がゲーム開始
    ↓
Session生成
    ↓
ゲームデータ読み込み
    ↓
WebSocket接続
    ↓
session.ready
    ↓
全員ready または30秒経過
    ↓
最終参加者確定
    ↓
土木技術割り当て
    ↓
Preparation
    ↓
Disaster
    ↓
Result
    ↓
結果通知
    ↓
WebSocket close
    ↓
Session / Room削除
    ↓
ゲームメニュー
```

---

## 24. 関連ドキュメント

- `docs/game-design/overview.md`
- `docs/game-design/game-rules.md`
- `docs/game-design/session-flow.md`
- `docs/game-design/ui-controls.md`
- `docs/architecture/overview.md`
- `docs/architecture/communication.md`
- `docs/architecture/dependency-rules.md`
- `docs/architecture/game-state-model.md`
- `docs/architecture/db-schema.md`
- `docs/architecture/game-schema-design.md`
- `docs/api/rest-naming.md`
- `docs/api/websocket-naming.md`
- `docs/development/testing.md`
- `packages/game-data/rules/budget-rules.json`
