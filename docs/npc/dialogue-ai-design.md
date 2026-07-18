# CivilCraft NPC 機能 — RAG・LLM 技術設計

## 文書の状態

- 状態：RAG・LLM専門設計承認済み
- 対象：地域情報提供型・住民 NPC の会話、RAG、LLM、知識データ、グロッサリー、フォールバック、安全性、匿名分析の専門設計
- 位置づけ：RAG・LLM 固有の設計の正本。機能要件・受け入れ条件は [`requirements.md`](./requirements.md)、統合構成・型・API設計Issueへの引き継ぎ条件は [`detailed-design.md`](./detailed-design.md) を正本とし、本書では重複記載しない
- **API・通信方式（WebSocketイベント名、ペイロード、TypeScript型、`status`・`reasonCode`の列挙値等）は、本書では確定しない。別のAPI設計Issueで決定する（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）**
- 初期 LLM：Ollama
- 初期利用規模：1〜4 人
- 将来利用規模：5〜50 人

本書は新規 NPC 機能の補足技術設計であり、既存の `docs/` 文書を変更しない。

---

## 設計目標

1. NPC が承認済みの地域情報だけを根拠に回答する
2. 同じ根拠情報を、NPC の人格に合わせて少し異なる表現で伝える
3. 小学校高学年が 60 秒の準備時間内で利用できる応答速度と文章量にする
4. NPC・地域・シナリオ・担当テーマを越えた情報漏れを防ぐ
5. LLM や検索基盤が停止しても、ゲーム本体と基本 NPC 会話を継続する
6. 質問文・回答文・個人情報を保存せず、匿名の利用指標だけを収集する
7. 初回は Ollama で費用を抑え、将来はクラウド LLM へ移行可能にする

---

## 非目標

- LLM による災害イベントの発火・難易度調整
- AI ディレクター
- NPC の自律移動・施設配置
- LLM による未知の地域情報・災害情報の生成
- 実行時のインターネット検索
- 一般的な雑談・ゲーム外質問への回答
- 具体的な施設配置座標の指示
- クラウド LLM への自動フェイルオーバー
- 会話本文の永続保存
- 認証なしの分析データ公開 API

---

## 全体構成

```text
スマートフォン Web クライアント
  ├─ NPC 表示・接近判定・会話 UI
  ├─ 質問候補・自由入力
  └─ 通信（方式はAPI設計Issueで決定）
           ↓
Go ゲームサーバー（サーバー権威型）
  ├─ NPC 定義・出現判定
  ├─ 会話セッション管理
  ├─ 入力検証・安全判定
  ├─ ヒントレベル制御
  ├─ 検索・根拠検証
  ├─ LLM 呼び出し
  ├─ フォールバック
  ├─ 災害中の定型回答
  └─ 匿名分析イベント
           ↓
  承認済み知識データ／検索基盤
           ↓
  Ollama（同一 GPU 搭載 PC）
```

ブラウザから Ollama や外部 LLM API へ直接接続しない。接続先、モデル名、認証情報はバックエンドだけが保持する。

具体的な通信イベント・フィールド・ペイロードの型定義は、別のAPI設計Issueで決定する（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）。本書では、RAG・LLM に固有の設計のみを扱う。

---

## 回答経路

### 準備フェーズ：登録質問

```text
質問候補 ID
  ↓
NPC・シナリオ・質問候補を検証
  ↓
対応する承認済み知識 ID を直接取得
  ↓
根拠情報＋人格＋ヒントレベルを LLM へ渡す
  ↓
LLM内部生成結果と回答本文を検証
  ↓
プレイヤーへ表示
```

登録質問ではベクトル検索を必須にしない。質問候補に対応する知識 ID を直接取得し、根拠の取り違えを防ぐ。

### 準備フェーズ：自由入力

```text
最大 100 文字の自由入力
  ↓
入力検証・範囲外／不適切判定
  ↓
scenarioId・npcId・areaId・themeId で検索範囲を限定
  ↓
承認済み知識だけを検索
  ↓
閾値以上の根拠がある場合だけ LLM へ渡す
  ↓
LLM内部生成結果と回答本文を検証
  ↓
プレイヤーへ表示
```

検索結果がない、スコアが閾値未満、または担当テーマ外の場合は LLM の一般知識を使用しない。

### 災害フェーズ

```text
NPC 座標
  ↓
周辺のサーバー権威型ゲーム状態を取得
  ↓
被害段階・水位傾向・感情段階を決定
  ↓
承認済み定型文を選択
  ↓
プレイヤーへ表示
```

MVP の災害中回答には LLM を使用しない。速度、正確性、再現性を優先する。

---

## 「同じ事実・異なる表現」の実現

LLM は知識を補完する役割ではなく、承認済み事実の**言語化器**として使用する。

### LLM へ渡す情報

- NPC の名前、職業、簡単な性格、話し方
- 対象年齢と表記規則
- 現在のヒントレベル
- プレイヤーの質問
- サーバーが選択・検証した承認済み根拠情報と、その適用可能なヒント範囲。知識IDはサーバー内部の追跡情報として保持し、LLMに出力させない
- 禁止事項
- 最大 120 文字・1〜2 文という出力制約

LLM へは「よみやすさ設定（readingLevel）」を渡さない。かな中心／ふりがな／標準の 3 段階は語彙・言い回しを共通にしたまま表記のみを変える設計（[`requirements.md`](./requirements.md#15-よみやすさ設定)）であるため、LLM は常に「標準相当」のプレーン文を 1 種類だけ生成する。ふりがな付与はLLMの役割ではなく、LLM出力をサーバーが受け取った後の後処理として行う。正本は[`detailed-design.md`](./detailed-design.md#25-ふりがな生成検証)とする。

### LLM が行ってよいこと

- 語順、接続表現、語尾を変える
- NPC の性格に沿った軽微な表現差を付ける
- 難しい表現を小学校高学年向けに言い換える
- 根拠に含まれる情報を短く要約する

### LLM が行ってはいけないこと

- 根拠にない場所、災害、年月、数値、人名、施設を追加する
- NPC の担当外テーマへ回答する
- 最適な配置座標を指定する
- レベル 1〜2 の要求にレベル 3 の推薦を混ぜる
- 公的資料の内容とゲーム内の簡略化情報を混同する
- 実際の避難・防災判断として断定する
- ふりがな・ルビを表すマークアップおよび HTML を生成する
- readingLevel ごとに異なる文章を生成する（readingLevel は LLM に渡されないため、そもそも入力として受け取らない）

---

## LLM内部生成結果

LLMから受け取るデータは、APIレスポンスとは独立した内部生成結果として扱う。LLMが生成する本文はプレーンテキストとし、HTML、ルビマークアップ、表示用セグメントを生成させない。

内部生成結果は、概念上、次の最小情報だけを持つ。

```json
{
  "answerText": "プレイヤーへ表示する回答本文",
  "generationResult": "answered"
}
```

`generationResult`は、内部処理上、少なくとも次を区別できるものとする。

- `answered`：渡された承認済み根拠だけで回答を生成できた
- `noEvidence`：渡された根拠だけでは回答できない
- `refused`：安全上の理由で回答本文を生成しなかった

これはLLMアダプター内部の生成結果であり、クライアントへ送るAPIのフィールド名・DTO・状態値を定義するものではない。具体的なAPI表現は別のAPI設計Issueで決定する。

LLMは次を出力しない。

- 根拠として使用した知識IDまたは`sourceIds`
- `hintLevel`
- 表示用`segments`
- `readingLevel`
- API上の`status`または`reasonCode`

`sourceIds`は、登録質問の直接参照またはRAG検索結果からサーバーが確定する。`hintLevel`は会話セッションからサーバーが確定する。表示用`segments`は、検証済みの`answerText`をサーバーが後処理して生成する。

サーバーはLLM呼び出し前に、根拠情報が承認済みであり、現在のNPC・シナリオ・地域・担当テーマ・ヒントレベルの範囲内であることを検証する。

LLM出力後は次を検証する。

- 内部生成結果が想定された形式であること
- `generationResult`が許可された値であること
- `answered`の場合、`answerText`が空でないこと
- 1〜2文、最大120文字であること
- URL、HTML、ルビマークアップ、制御文字を含まないこと
- プレイヤー入力に含まれた個人情報を不必要に反復していないこと
- 承認済み根拠情報にない事実を追加していないこと
- 現在も同じゲーム・フェーズ・会話セッション・質問要求であること

`noEvidence`または`refused`の場合、LLMが返した本文は表示せず、NPC定義に対応付けられた承認済み定型応答へ切り替える。検証に失敗した場合も承認済みフォールバック応答へ切り替える。

---

## 知識データ

### 原則

- 国土交通省、自治体などの信頼できる公的資料を使用する
- 実行時の Web 検索は行わない
- 公的資料を小学校高学年向け・ゲーム向けに簡略化する
- 簡略化した内容を人間が確認する
- 承認状態でない知識は検索対象にしない
- マップとの対応を確認できない情報は対象シナリオで有効化しない
- AI が生成した未確認情報を本番知識として登録しない

知識データと並ぶマスターデータとして、技術用語・地名・NPC が頻繁に使う語の読みを管理する**技術用語グロッサリー**（`npc-glossary.json`）を用意する。グロッサリーは知識データと同じ手順で、Claude Code が仮案を作成し、人間承認を経て `approved = true` のもののみを使用する。グロッサリーの用途（最長一致による読み仮名付与）は [`detailed-design.md`](./detailed-design.md#25-ふりがな生成検証) を参照。

### 初期データの公的資料候補

初期の最小データは、次の公的資料から人間が確認して作成する。

- [郡山市洪水ハザードマップ](https://www.city.koriyama.lg.jp/soshiki/126/2177.html)
- [国土交通省 福島河川国道事務所：阿武隈川緊急治水対策プロジェクト](https://www.thr.mlit.go.jp/fukushima/abupro/index.html)
- [国土交通省：令和元年東日本台風の出水概要と阿武隈川緊急治水対策プロジェクト](https://www.thr.mlit.go.jp/fukushima/kasen_seibi/2020dai14kai/06-14-siryou2-1.pdf)

これらは候補であり、資料の引用・利用条件、対象地点、ゲームマップとの対応を確認してから使用する。

### 原本の配置案

最終配置は実リポジトリの調査後に決定する。既存方針に沿う候補は次のとおり。

```text
packages/game-data/npc/
  ├── npc-definitions.json
  ├── npc-knowledge.json
  ├── npc-questions.json
  ├── npc-fallback-responses.json
  └── npc-glossary.json
```

### 知識レコード案

```json
{
  "id": "knowledge-koriyama-001",
  "scenarioId": "scenario-example",
  "npcIds": ["npc-example-resident"],
  "areaId": "area-example",
  "themeId": "past-flood",
  "hintLevel": 1,
  "approved": true,
  "approvedBy": "human-reviewer-id",
  "approvedAt": "YYYY-MM-DD",
  "canonicalFact": "人間が確認したゲーム向けの簡略化情報",
  "source": {
    "title": "公的資料名",
    "publisher": "発行機関",
    "url": "https://example.invalid",
    "accessedAt": "YYYY-MM-DD"
  }
}
```

実データでは `example.invalid` を使用せず、確認済みの公的資料を設定する。

`canonicalFact`はLLMへの根拠情報としてのみ使用する平易な日本語の文字列であり、プレイヤーへ直接表示しない。フォールバック応答は知識レコードへ埋め込まず、`npc-fallback-responses.json`を唯一の正本として管理する。NPC定義は処理結果ごとのフォールバック応答IDだけを保持する。

フォールバック応答はプレイヤーへ直接表示する承認済み文言であるため、8章の表示用セグメント配列として登録する。よみやすさ設定ごとに文章を複製せず、1つのセグメント配列を`ReadingAwareText`で切り替えて表示する。

### NPC 定義案

```json
{
  "id": "npc-example-resident",
  "scenarioId": "scenario-example",
  "areaId": "area-example",
  "enabled": true,
  "displayName": [
    { "text": "ユーザー承認後に設定" }
  ],
  "occupationLabel": [
    { "text": "長年", "reading": "ながねん" },
    { "text": "住んでいる" },
    { "text": "住民", "reading": "じゅうみん" }
  ],
  "personality": "落ち着いていて親切",
  "themeIds": ["past-flood"],
  "canRecommendTechnique": false,
  "position": { "x": 0, "y": 0, "z": 0 },
  "interactionRadius": 0,
  "questionIds": ["question-001", "question-002", "question-003"],
  "fallbackResponseIds": {
  "llmFailure": "fallback-npc-example-llm-failure",
  "noEvidence": "fallback-npc-example-no-evidence",
  "outOfScope": "fallback-npc-example-out-of-scope",
  "inappropriate": "fallback-npc-example-inappropriate"
  }
}
```

`displayName`と`occupationLabel`はプレイヤーへ表示する承認済みセグメント配列である。`personality`はLLMの話し方を制約する内部情報であり、プレイヤーへ直接表示しない。LLMへ名前・職業を渡す場合は、セグメントの`text`を連結した標準表記を使用する。

座標、会話距離、NPC 数はマップ完成後に決定する。

### フォールバック応答レコード案

`npc-fallback-responses.json`をフォールバック応答の唯一の正本とする。

```json
[
  {
    "id": "fallback-npc-example-llm-failure",
    "kind": "llmFailure",
    "segments": [
      { "text": "今はうまく話せないみたいだ。" },
      { "text": "少ししてから、もう一度聞いてみてね。" }
    ]
  },
  {
    "id": "fallback-npc-example-no-evidence",
    "kind": "noEvidence",
    "segments": [
      { "text": "そのことは分からないな。" },
      { "text": "この地域の洪水についてなら話せるよ。" }
    ]
  },
  {
    "id": "fallback-npc-example-out-of-scope",
    "kind": "outOfScope",
    "segments": [
      { "text": "そのことは、わたしの担当ではないんだ。" },
      { "text": "この地域の洪水についてなら話せるよ。" }
    ]
  },
  {
    "id": "fallback-npc-example-inappropriate",
    "kind": "inappropriate",
    "segments": [
      { "text": "その話には答えられないよ。" },
      { "text": "地域の災害について聞いてみてね。" }
    ]
  }
]
```

実データでは、NPC定義の`fallbackResponseIds`から、処理結果に対応する承認済み応答を参照する。知識レコードごとにフォールバック本文を重複保持しない。

---

## 検索

### メタデータフィルター

ベクトル類似度の前に、必ず次で検索対象を制限する。

- `approved = true`
- `scenarioId`
- `npcId` または許可された `npcIds`
- `areaId`
- `themeId`
- 現在許可されている `hintLevel`

この制限により、別地域・別シナリオ・別 NPC・上位ヒントの情報を取得しない。

### 検索基盤

検索基盤は未決定である。候補は次のとおり。

1. 既存 PostgreSQL に `pgvector` を追加
2. 小規模実証向けの簡易ファイル・メモリ検索
3. 外部ベクトル DB

Claude Code は実リポジトリ、DB マイグレーション、既存依存関係、ローカル起動方法を読み取り専用で確認し、候補と推奨案を提示する。ユーザー承認前に追加依存関係・DB拡張を導入しない。

---

## LLM プロバイダー

### 初期構成

- プロバイダー：Ollama
- 実行場所：ゲームサーバーと同じ GPU 搭載 PC
- 初期同時利用：1〜4 人
- タイムアウト：5 秒
- 自動クラウドフェイルオーバー：なし
- 障害時：承認済み基本回答

### 環境変数案

実際の命名はリポジトリの設定規則へ合わせる。

```text
NPC_LLM_PROVIDER=ollama
NPC_LLM_MODEL=<model-name>
NPC_LLM_BASE_URL=<ollama-url>
NPC_LLM_TIMEOUT_MS=5000
NPC_DIALOGUE_ENABLED=true
```

APIキー、`.env`、秘密情報はリポジトリへコミットしない。

### 将来拡張

5〜50 人規模では、次を再評価する。

- Ollama の同時リクエスト処理性能
- GPU メモリとモデルサイズ
- 95 パーセンタイル応答時間
- OpenAI、Anthropic、AWS Bedrock 等のクラウド利用
- 費用上限、レート制限、利用規約

初回実装で複数プロバイダーのアダプターや自動切り替えを先行実装しない。既存の KISS・YAGNI 方針を優先する。

---

## 会話セッション

- プレイヤーごと・NPC ごとに独立した一時セッションを作る
- 同じ NPC に複数プレイヤーが同時接続できる
- 会話履歴は会話画面を閉じるまで保持する
- 会話画面を閉じたら履歴を破棄する
- ゲーム終了時にも残存セッションを破棄する
- フェーズ変更時は準備中の会話を閉じ、未完了要求を無効化する
- 同じプレイヤーから同時に送信できる質問は 1 件
- 回答待ち中は送信不可
- 回答後 2 秒間は次の送信を制限する
- 二重タップ・重複要求を冪等性キー等で防止する

ゲーム状態の変更後に古い回答を配信しないよう、要求と回答は安全に対応付けられる必要がある。ドメイン・アプリケーション層としての設計は [`detailed-design.md`](./detailed-design.md#15-会話セッション) を、具体的な識別・対応付けの方式はAPI設計Issue（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）を参照。

---

## 通信とAPI設計Issueとの関係

具体的な通信イベント名、ペイロード、フィールド構成、サーバー権威型検証の実現方式は、別のAPI設計Issueで決定する（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）。ここでは、RAG・LLMの観点から通信設計が満たすべき性質のみを述べる。

会話内容は当該プレイヤーだけに送信し、ルーム全体へブロードキャストしない。NPC の出現状態は必要に応じてルーム参加者へ共有する。質問は、事前登録された質問候補と自由入力（最大100文字）を区別できる必要があり、区別の具体的な表現方法はAPI設計Issueで決定する。

---

## 安全性・入力対策

### 入力

- 100 文字を超える入力を拒否する
- 空文字、制御文字、過剰な改行を拒否する
- ゲーム・地域・災害・NPC担当テーマ外の質問を拒否する
- システムプロンプト、内部設定、別 NPC の情報を要求する入力を拒否する
- 不適切な内容には詳細に反応せず、短い拒否と質問候補を返す
- 入力言語を強制的に遮断せず、回答は原則日本語とする

### プロンプト

- プレイヤー入力を命令としてシステム制約より優先しない
- 根拠情報とプレイヤー入力を明確に分離する
- 根拠情報内の命令文を実行しない
- 承認済み根拠情報と、現在許可されているヒント範囲を明示する
- 知識ID・`sourceIds`・`hintLevel`を出力しないよう指示する
- 与えられた根拠だけでは回答できない場合、内部生成結果の`generationResult`を`noEvidence`とするよう指示する

### 出力

- LLMが生成する`answerText`は最大120文字・1〜2文とする。サーバーが後段で生成する`segments`の`text`を連結した結果は、元の`answerText`と一致しなければならない。`reading`は文字数に含めない
- LLM はふりがな・ルビを表すマークアップおよび HTML を一切生成しない
- クライアントは NPC 由来の文字列を `dangerouslySetInnerHTML` 等の生 HTML 描画で表示しない
- URL を NPC 発言内に生成させない
- 個人情報らしき入力を繰り返さない
- 出典は結果画面で、登録済み情報から表示する

---

## フォールバック

正常に受理された質問の処理結果と、質問要求自体の拒否を区別する。通信上の表現方法は別のAPI設計Issueで決定する。

処理結果と承認済み応答の対応は次のとおりとする。

- LLM接続失敗・タイムアウト・出力検証失敗：`fallbackResponseIds.llmFailure`
- 根拠情報が存在しない：`fallbackResponseIds.noEvidence`
- NPCの担当テーマ外：`fallbackResponseIds.outOfScope`
- 不適切な質問または安全上の拒否：`fallbackResponseIds.inappropriate`

`fallbackResponseIds.llmFailure`を使用する処理失敗には、次を含む。

- Ollama接続失敗
- 5秒タイムアウト
- LLM内部生成結果の解析失敗
- `generationResult`の検証失敗
- 回答本文の空文字・文字数・文数違反
- URL、HTML、ルビマークアップ、制御文字等の禁止パターン検出
- 承認済み根拠情報の範囲外となる回答の検出

質問要求自体が不正な場合（会話セッションの所有者不一致、要求の重複、ゲーム状態の不一致、フェーズ不一致等）はフォールバック応答の対象ではなく、要求自体をサーバーが拒否する（[`detailed-design.md`](./detailed-design.md#18-サーバー権威型の検証)）。この拒否と、受理済み質問に対する処理結果は区別する（NPC-FR-058）。

根拠が存在しない場合は、別の事実を推測せず、`fallbackResponseIds.noEvidence`に対応する承認済み応答を表示する。その後、当該NPCの質問候補を再表示する。

---

## 運用ログ

会話本文を含まない、システム運用のためのログを記録する。

- 成功／失敗
- 応答時間
- 使用した LLM プロバイダー・モデル
- 参照した情報 ID
- NPC ID
- シナリオ ID
- エラー種別
- 一時匿名セッション ID

次を記録しない。

- プレイヤー名
- 質問本文
- 回答本文
- 入力された個人情報
- LLM に送った完全なプロンプト

`fmt.Println` やブラウザ Console へ本文を出力せず、既存 Logger を使用する。

---

## 匿名分析データ

運用ログと研究・改善用の分析データを区別する。よみやすさ設定（readingLevel）は読む力に関連する設定であるため、いずれの指標にも含めない。将来収集する場合は別 Issue の作成と人間による承認が必要（[`requirements.md`](./requirements.md) NPC-NFR-009）。

### プレイヤー指標

- 匿名プレイヤー ID
- NPC ID
- 会話開始回数
- 質問候補 ID
- 自由入力回数
- 使用ヒントレベル
- 会話時間
- NPC 利用後に配置した技術

### セッション指標

- 匿名ゲームセッション ID
- シナリオ ID
- NPC 有効・無効
- 最終被災度
- 使用予算
- 使用技術
- クリア・失敗

### 出力

管理者だけがサーバー上の CLI コマンドから CSV・JSON を生成する。公開画面や認証なし API は作らない。

コマンド名と出力先は実リポジトリ調査後に決定する。概念例：

```text
<project-command> npc-analytics export --format csv --from YYYY-MM-DD --to YYYY-MM-DD
<project-command> npc-analytics export --format json --from YYYY-MM-DD --to YYYY-MM-DD
```

保存期間はチーム協議事項とし、実験・本番運用前に決定する。

---

## テスト方針

既存テスト規約に従い、機能追加には Unit Test を追加する。重要な通信・検索・ゲーム状態連携には Integration Test を追加する。

### Unit Test

- シナリオごとの NPC 出現判定
- NPC・地域・テーマ・ヒントレベルの検索フィルター
- 質問候補から知識 ID への対応
- 自由入力の文字数・範囲・不適切入力判定
- 段階ヒントの状態遷移
- LLM内部生成結果と回答本文の検証
- 最大 120 文字の検証
- フォールバック選択
- 災害状態から被害・感情段階への変換
- 匿名分析イベント生成
- CSV・JSON 出力

### Integration Test

- 会話開始・質問・回答・終了の一連の流れ（通信方式はAPI設計Issue確定後に具体化）
- 同じ NPC への複数プレイヤー同時会話
- 回答待ち中の災害フェーズ移行
- LLM タイムアウト時の基本回答
- 検索結果なし時の拒否と質問候補再表示
- NPC 会話中もゲーム Tick が進むこと
- NPC 無効時に既存ゲームへ影響しないこと
- 分析データとゲーム結果の匿名 ID による関連付け

### LLM テスト

自動テストでは実 LLM へ依存せず、モックまたは固定テスト実装を使用する。

- 同じ根拠に対して表現が変わっても事実 ID が同じ
- 根拠にない情報を含む出力を拒否できる
- 許可されていないヒントレベルを拒否できる
- 不正 JSON、空回答、長文をフォールバックできる

実 Ollama を使うテストは、ローカルの任意実行または専用 Integration Test とし、通常の Unit Test を不安定にしない。

### 初期性能確認

- 1〜4 人の同時利用
- 5 秒以内に回答、または基本回答へ切り替わる
- 会話中もゲーム Tick・通信の同期が継続する
- GPU メモリ不足時にゲームサーバーが停止しない

5〜50 人の負荷試験は将来拡張時に行う。

---

## 実装前の決定ゲート

NPC バックエンド・フロントエンドのモジュール配置は [`detailed-design.md`](./detailed-design.md) で確定済みである。**通信イベント名・ペイロード・API設計は本書・detailed-design.mdでは確定せず、別のAPI設計Issueで決定する**（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）。本書のスコープ（RAG・LLM・知識データ）に残る未決定事項、および全体の未決定事項一覧は [`requirements.md`](./requirements.md#23-未決定事項実装前確認事項) を正本とする。RAG 検索基盤（PostgreSQL＋pgvector／簡易検索／外部ベクトル DB）、知識作成・監修担当、Ollama モデル、分析データ保存期間は同章に記載のとおり未決定である。

Issue 番号が作成されるまでは、番号なしの `TODO` コメントをコードへ追加しない。