# NPC MVPの起動・動作確認

2026-09-13更新。第1段階の仮会話を、公的資料に基づく選択式会話へ置き換えた。

## 今できること

- 住民3人（はるさん、みかさん、そうたさん）と、工事系の経験者5人（けんさん、なおさん、たくみさん、ゆうじさん、あきらさん）に話しかける。
- 各3問を選び、レベル1→2→3と詳しく聞く。一般住民のレベル3では経験者を紹介する。
- Ollamaが、その人物・質問・段階に登録した言い回しから回答を選ぶ。
- OllamaやGoサーバーが使えないときも、同じ根拠付きの固定回答で遊ぶ。
- 災害中はNPC近くの被害発生表示に応じた定型文と、現実の一般的な防災情報を表示する。
- 結果画面で、そのプレイで実際に聞いた話の資料だけを開く。

NPCは架空の人物で、位置は既存の阿武隈川マップのテスト用固定位置。実在の住民・工事従事者を再現したものではない。会話中も準備・災害の時間は進み、フェーズ変更時に会話を閉じる。

## 最短で試す：固定回答

既に `pnpm dev:web:fg` を起動中なら、そのターミナルで `Ctrl+C` を押して再起動する。安定起動モードはファイル監視が無効なので、ブラウザ更新だけではコードが切り替わらない場合がある。

```powershell
cd C:\Users\kikumanetworklab\Documents\GitHub\civileng-project
pnpm dev:web:fg
```

`http://localhost:5173/` → シングルプレイ → 開始 → 住民アイコンを押す。

固定回答だけの確認には、Goサーバー・DB・Ollama・makeは不要。Webだけで公的根拠・出典付きの会話を試せる。NPCは本番ビルドでも有効で、静的配信環境ではAPIがなければ固定回答を使う。

## LLMを使う

### 1. OpenAIを使う（共有・公開環境向け）

OpenAI APIを使う場合は、APIキーをGoサーバーを起動するPCの環境変数へ設定する。キーをリポジトリへ保存したり、ブラウザの `VITE_*` 変数へ設定したり、チャットへ送ったりしない。

```powershell
$env:NPC_LLM_PROVIDER = 'openai'
$env:OPENAI_API_KEY = 'ここへ自分のキーを設定'
$env:OPENAI_MODEL = 'gpt-4o-mini'
```

GoサーバーはOpenAIへ直接接続し、ブラウザにはキーを渡さない。OpenAIから回答が得られない場合は、同じ根拠付きの固定回答へ切り替える。選択式質問に対応する承認済みFactだけをOpenAIへ渡し、登録済み候補から表現を選ばせる。

### 2. Ollamaを使う（ローカル確認用）

#### モデルを用意する

Ollamaを起動しておく。このPCには `qwen3:14b` が既にある。他の開発者のPCで未導入の場合のみ取得する。

```powershell
ollama pull qwen3:14b
```

初回のモデル読み込みには5秒以上かかる場合がある。ゲーム前にモデルを読み込む場合は、プロジェクト直下から以下を実行する（Node 22以降）。初回は最大3分待つ。

```powershell
node apps/server/scripts/warm-npc.mjs
```

このPCでの確認では初回読み込み・初回推論が60秒を超えた一方、読み込み後のNPC API応答は約0.8秒だった。環境によって変わるため、通常のゲーム中は5秒で固定回答へ切り替える。

### 3. Goサーバーを起動する

既存の `go run ./cmd/game` が動いている場合は、そのターミナルで止めてから再起動する。

```powershell
cd C:\Users\kikumanetworklab\Documents\GitHub\civileng-project\apps\server
go run ./cmd/game
```

NPC APIと既存のゲームWebSocketが `8081` で動く。NPCの追加DBやマイグレーションは不要。

### 4. Webを起動する

別のターミナルで、上記の `pnpm dev:web:fg` を実行する。Webの `/api/npc` はGoサーバーへ転送され、GoサーバーからそのPCのOllamaへ接続する。

### 他の開発者に共有する（同一LAN）

他の開発者もあなたのPC上のOllamaを使う場合は、GoとWebをあなたのPCで起動したままにする。他の開発者はOllama・Go・DBを起動せず、ブラウザでWebの `Network:` URLを開く。

```powershell
# あなたのPCでIPアドレスを確認
ipconfig
```

例えばWeb起動ログに `http://192.168.1.10:5173/` が表示された場合、他の開発者はそのURLへアクセスする。Webの `/api/npc` と `/ws` は同じPC上のGoサーバーへ中継され、Goだけが `127.0.0.1:11434` のOllamaへ接続する。Ollamaの11434ポートはLANへ公開しない。

接続できない場合は、あなたのPCのWindows Defenderファイアウォールで、プライベートネットワークのTCP `5173`（Web）への受信を許可する。通常、NPC APIの `8081` とOllamaの `11434` は外部に開ける必要がない。会社・学校ネットワークで端末間通信が禁止されている場合は、同じテザリングまたは開発用ネットワークを使う。

共有確認の目安は、他の開発者の画面でNPCに質問し、あなたのGoサーバーログに `npc_answer ... mode=ollama` が出ること。初回だけモデル読み込みで5秒を超えると固定回答になることがあるため、先に [warm-npc.mjs](../../apps/server/scripts/warm-npc.mjs) を実行しておく。

## 操作の確認

1. はるさん、みかさん、そうたさんのいずれかに地域の過去や土地を質問し、「もっと詳しく聞く」を2回押す。
2. レベル3の紹介ボタンで地図へ戻り、紹介された工事系NPCの位置を確認する。
3. けんさん、なおさん、たくみさん、ゆうじさん、あきらさんに、それぞれ堤防・護岸・遊水地・排水機場・河道掘削の使いどころを質問する。
4. 大雨への移行で会話が閉じること、再度話しかけると質問候補がなく状況の短い応答になることを確認する。
5. 結果画面の「住民の話に使われた資料」を開き、出典を確認する。

会話パネルは閉じるボタン・Escで閉じられる。履歴は閉じると破棄し、使った資料のIDだけをそのプレイの結果画面まで保持する。

## 設定

| 環境変数             | 既定値                 | 用途                                                                     |
| -------------------- | ---------------------- | ------------------------------------------------------------------------ |
| VITE_NPC_ENABLED     | 有効                   | Web起動時にfalseでNPC全体を非表示                                        |
| NPC_DIALOGUE_ENABLED | 有効                   | Go起動時にfalseでNPC APIを登録しない。Web単独の固定回答とは別            |
| NPC_LLM_PROVIDER     | ollama                 | fixedでGo側も固定回答のみ                                                |
| NPC_LLM_MODEL        | qwen3:14b              | 同じPCに導入したモデル名                                                 |
| NPC_LLM_BASE_URL     | http://127.0.0.1:11434 | GoからのOllama接続先                                                     |
| OPENAI_API_KEY       | 未設定                 | `NPC_LLM_PROVIDER=openai` のときだけGoサーバーが使用。ブラウザへ渡さない |
| OPENAI_MODEL         | gpt-4o-mini            | OpenAIで使用するモデル名                                                 |
| OPENAI_BASE_URL      | https://api.openai.com | OpenAI互換APIを使う場合の接続先                                          |
| NPC_API_TARGET       | http://127.0.0.1:8081  | Vite開発時のAPI転送先。共有ホストのWebを開く場合は変更不要               |
| GAME_DATA_DIR        | 既存の自動解決         | 配備先でpackages/game-dataの場所を指定                                   |

PowerShellでは起動前に `$env:NPC_LLM_PROVIDER = 'fixed'` のように指定する。`VITE_NPC_PROTOTYPE=false` も旧設定との互換性のため非表示として扱う。

## データの編集と拡張

正本は `packages/game-data/npc/npc-catalog.json`。質問→ヒント→Fact ID→出典の対応を持つ。NPCは同じ構造で追加できる。新しい文言や事実を追加したら、根拠との対応を確認し、Go・Web両方を再起動する。契約が変わる場合は `version` も更新する。

任意位置のNPC配置禁止範囲や実地の地形判定を実装したわけではない。現在の8人は既存の施設配置可能域の外に置き、テストで確認している。位置ラベルの「（仮）」は、ゲーム内の役割に合わせた暫定配置であることを示す。

## 検証

```powershell
pnpm --filter @civilcraft/web test
pnpm --filter @civilcraft/web lint
pnpm --filter @civilcraft/web build
pnpm --filter @civilcraft/game-schema build
# apps/serverから
go test ./...
go test -race ./internal/npc/...
go vet ./...
```

Web起動中、プロジェクト直下の別ターミナルからブラウザテストを実行できる。

```powershell
node apps/web/scripts/e2e-npc.mjs
# 実Ollamaの回答も必須にする場合
$env:NPC_REQUIRE_LLM = '1'
node apps/web/scripts/e2e-npc.mjs
```

Chrome/Edgeを一時プロファイルでヘッドレス起動する。必要なら `CHROME_PATH`・`CIVILCRAFT_URL` を指定する。結果画像とプロファイルはOSの一時フォルダーに残し、保存先を表示する。実Ollama必須モードでは、回答待ち中のフェーズ変更と出典への混入防止も確認する。

## 今回の範囲と今後

今回のソロMVPには、固定選択式会話・質問に対応した承認済みFactの取得・OpenAI/Ollama接続・固定回答への切替・災害表示との連動・出典表示が含まれる。LLMの言い換えは登録済み候補内に限定する。

資料本文の自動取得・ベクトル検索・共有AIサーバーの本番運用・自由入力・マルチプレイのゲーム状態への接続は今後の拡張。個別の住宅・道路の被害状態やNPC足元の水深は、現在のゲームにそのデータがないため推定して話させない。

詳細は [ソロMVP API契約](./mvp-api.md) と [一次資料の照合記録](./research/verification-notes.md) を参照。
