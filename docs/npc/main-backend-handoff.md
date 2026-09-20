# NPC Backend 引き継ぎ資料（Main Backend担当者向け）

## 目的

この文書は、NPC Backendを本物のゲーム状態へ接続するための実装引き継ぎである。NPC Backendは選択式質問に対する、Factに基づくLLM回答を担当する。ゲーム状態の正当性はMain Backendが唯一の正として管理する。

## 現在動く範囲

ローカルでは次の経路でOpenAI回答を確認できる。

```text
Web -> cmd/game の仮会話API -> cmd/npc の内部API -> OpenAI
```

`cmd/game`の会話APIは、接続確認のための橋渡し実装である。ゲームセッションを`local-<UUID>`で仮発行し、Webから受け取ったフェーズ・残り時間を検査している。この値を本番の正として使ってはならない。

## Main Backendが実装すること

Webから会話開始・質問・ヒント追加要求を受けたら、Main Backendは以下を自分のゲーム状態から検証する。

1. プレイヤーが有効なゲームセッションへ参加していること
2. 現在が会話を許可するフェーズであること
3. 対象NPCがシナリオに存在し、会話可能であること
4. 質問IDがそのNPCに登録されていること
5. ヒント段階、重複要求、クールダウン、会話終了をサーバー側で管理すること
6. AI回答の完了時にも、セッションとフェーズがまだ表示可能か再確認すること

検証に通った場合だけ、次の内部APIを呼ぶ。プレイヤー座標、残り予算、全施設配置、水位などのゲーム全体StateをNPC Backendへそのまま渡さない。

## Main Backend -> NPC Backend v1

`POST /internal/v1/npc/answers`

```json
{
  "interactionId": "Main Backendが質問ごとに発行するID",
  "gameSessionId": "Main Backendが管理する不透明なゲームセッションID",
  "npcId": "resident",
  "scenarioId": "abukuma-koriyama",
  "questionId": "past",
  "hintLevel": 1
}
```

| 項目 | Main Backendの役割 |
| --- | --- |
| `interactionId` | 質問単位で発行し、古い回答・重複回答を破棄する |
| `gameSessionId` | 本物のゲームセッションIDを設定する。プレイヤー名は含めない |
| `npcId` / `scenarioId` | 現在のゲーム・NPC配置から検証する |
| `questionId` | 選択式質問だけを許可する。自由入力は送らない |
| `hintLevel` | Webの値を信用せず、会話状態から決定する |

APIはBearerトークンで保護する。`OPENAI_API_KEY`はNPC Backendだけに設定し、WebやMain Backendへ設定・送信しない。詳細は[`main-npc-backend-api.md`](./main-npc-backend-api.md)を参照する。

## NPC Backend -> Main Backend v1

```json
{
  "interactionId": "Mainから受け取ったID",
  "result": "success",
  "answerText": "NPCペルソナに沿った、Factに基づく回答文",
  "sourceIds": ["flood-1986"]
}
```

- `success`のときだけ、相関ID・現在の会話状態・`sourceIds`を確認して表示する。
- `no_grounding`、`busy`、`timeout`、`invalid_output`、`unavailable`では、Main Backendが承認済みの固定回答を表示する。
- `sourceIds`はNPC BackendがカタログのFactから決める。LLMが選んだ値ではない。

## 災害フェーズ

LLMは準備フェーズの選択式質問だけに使う。災害中の短い状況応答は、Main Backendが判定した災害状態から承認済み定型文を選ぶ。災害状態をNPC Backendへ渡す必要が生じた場合は、全ゲームStateではなく`overflow`や`inland`のような限定した状態コードを新しい契約として追加する。

## ローカル接続確認

PowerShellを3つ開く。

```powershell
# NPC Backend: OPENAI_API_KEYを設定したシェルで実行
$env:NPC_BACKEND_TOKEN="local-npc-backend-token"
$env:NPC_LLM_PROVIDER="openai"
pnpm dev:npc-backend

# 仮Main Backend
$env:NPC_BACKEND_TOKEN="local-npc-backend-token"
pnpm dev:game-backend

# Web
pnpm dev:web:fg
```

`http://localhost:5173/`で成人向けNPCの質問を選び、NPC Backendに`provider=openai result=success`、Game Backendに`mode=ai`が出れば、内部API経由の生成を確認できる。

## 接続完了の条件

- 仮の`local-<UUID>`を本物のゲームセッションIDへ置き換える
- Web由来のフェーズ・残り時間を使用せず、Main Backendのゲーム状態で会話を認可する
- フェーズ移行・切断・ゲーム終了で進行中の会話を無効化する
- 本物のMain BackendとNPC Backendを結ぶ結合テストを追加する
