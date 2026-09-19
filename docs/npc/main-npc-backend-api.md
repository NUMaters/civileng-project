# CivilCraft NPC機能 — Main Backend / NPC Backend MVP API

## 文書の状態

- 状態：実装済みMVP契約 v1
- 対象：Main BackendからNPC Backendへ送る選択式質問と、その回答
- 実装：`POST /internal/v1/npc/answers`
- 非対象：LLMOps、自由入力、災害中の状況回答、ゲーム状態同期

本書は[`backend-interface.md`](./backend-interface.md)の意味上の情報要件を、現在の選択式質問MVPで呼び出せる具体的な内部HTTP APIにしたものである。ブラウザからこのAPIを直接呼ばない。

## 責務

```text
Web
  ↓ 公開API
Main Backend
  ├─ ゲームセッション・フェーズ・NPC会話可否を検証
  ├─ 会話セッション・hintLevel・二重送信を管理
  └─ 内部APIを呼び出す
       ↓
NPC Backend
  ├─ NPC・質問・Factの対応を再検証
  ├─ 承認済みFactと候補回答だけでLLMを実行
  └─ answerTextとsourceIdsを返す
```

NPC Backendはステートレスとし、プレイヤー位置、残り時間、予算、`readingLevel`、ゲーム全体Stateを受け取らない。Main BackendはNPC Backendの失敗結果に応じて承認済み固定回答を選ぶ。

現在のMain Backendにはサーバー権威のフェーズ・災害状態がまだないため、ローカルMVPでは公開会話APIが受け取った状態を検証する橋渡し実装を使用する。ゲーム状態管理の完成後、この橋渡しだけをサーバー権威の判定へ置き換える。内部API契約は変更しない。

公開会話APIにはプロセス内のIP単位レート制限（会話開始30回/分、回答120回/分）を設ける。本番では複数インスタンスを横断できるよう、信頼できるリバースプロキシまたはAPI Gateway側でも認証・レート制限を設定する。

## 認証と公開範囲

- `Authorization: Bearer <NPC_BACKEND_TOKEN>`を使用する。
- `cmd/npc`は既定で`127.0.0.1:8082`だけをlistenする。
- ループバック以外をlistenする場合、`NPC_BACKEND_TOKEN`は必須。
- 本番ではPrivate Networkまたは同等の到達制限を使用し、ブラウザや公開インターネットへ直接露出しない。
- `OPENAI_API_KEY`はNPC Backendだけに設定する。

## リクエスト

```http
POST /internal/v1/npc/answers
Content-Type: application/json
Authorization: Bearer <NPC_BACKEND_TOKEN>
```

```json
{
  "interactionId": "opaque-interaction-id",
  "gameSessionId": "opaque-game-session-id",
  "npcId": "resident",
  "scenarioId": "abukuma-koriyama",
  "questionId": "past",
  "hintLevel": 1
}
```

| フィールド      | 内容                                             |
| --------------- | ------------------------------------------------ |
| `interactionId` | Main Backendが質問単位で生成する相関ID           |
| `gameSessionId` | Main Backendが管理するゲームセッションの不透明ID |
| `npcId`         | 質問対象NPC                                      |
| `scenarioId`    | 対象シナリオ                                     |
| `questionId`    | 登録済み質問候補ID                               |
| `hintLevel`     | Main Backendが管理する1〜3の段階                 |

## レスポンス

成功時：

```json
{
  "interactionId": "opaque-interaction-id",
  "result": "success",
  "answerText": "登録済み候補の一つ",
  "sourceIds": ["flood-1986"]
}
```

失敗時も、入力契約が正しければHTTP 200で論理結果を返す。Main Backendは`answerText`を信用せず、相関ID・登録済み候補・期待する`sourceIds`を再検証する。

| `result`         | Main Backendの扱い               |
| ---------------- | -------------------------------- |
| `success`        | 検証後にAI回答として表示         |
| `no_grounding`   | 承認済み固定回答へフォールバック |
| `busy`           | 承認済み固定回答へフォールバック |
| `timeout`        | 承認済み固定回答へフォールバック |
| `invalid_output` | 承認済み固定回答へフォールバック |
| `unavailable`    | 承認済み固定回答へフォールバック |

入力形式・NPC・シナリオ・質問が不正な場合は4xxを返す。認証失敗は401とする。

## ローカル動作確認

3つのPowerShellを開く。最初の2つには同じ内部トークンを設定する。

NPC Backend：

```powershell
cd C:\Users\kikumanetworklab\Documents\GitHub\civileng-project
$env:NPC_BACKEND_TOKEN="local-npc-backend-token"
$env:NPC_LLM_PROVIDER="openai"
$env:OPENAI_API_KEY="各自のキー"
pnpm dev:npc-backend
```

Main Backend：

```powershell
cd C:\Users\kikumanetworklab\Documents\GitHub\civileng-project
$env:NPC_BACKEND_TOKEN="local-npc-backend-token"
pnpm dev:game-backend
```

Web：

```powershell
cd C:\Users\kikumanetworklab\Documents\GitHub\civileng-project
pnpm dev:web:fg
```

`http://localhost:5173/`でNPCに質問し、NPC Backend側に次の形式のログが出れば内部API経由でOpenAIが使用されている。

```text
INFO npc_generation npc=... provider=openai result=success ...
```

自動結合テストは、実際のHTTP境界を立ち上げてMain BackendからNPC Backendを呼び出す。

```powershell
cd apps/server
go test ./internal/npc/...
```
