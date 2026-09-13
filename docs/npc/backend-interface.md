# CivilCraft NPC 機能 — Main Backend / AI Backend 暫定インターフェース設計

## 文書の状態

- 状態：暫定設計 v0.1
- 対象：NPC の回答生成における Main Backend / AI Backend 間の責務境界、情報要件、および LLMOps / RAGOps との連携
- 位置づけ：正式な API 仕様ではなく、Offline LLMOps / RAGOps の設計前でも Main Backend 側が先行して実装を進められるようにするための暫定契約
- 正式な通信方式、エンドポイント、イベント名、DTO、エラーコード等は本書では確定しない。最終仕様は API 設計時に決定する
- 既存文書と競合する場合は、[`requirements.md`](./requirements.md) および既存ゲーム本体の仕様を優先する

NPC 機能全体の要件は [`requirements.md`](./requirements.md)、ゲーム本体との統合設計は [`detailed-design.md`](./detailed-design.md)、RAG・LLM・LLMOps の専門設計は [`dialogue-ai-design.md`](./dialogue-ai-design.md) を参照する。通信方式の基本方針は [`docs/architecture/communication.md`](../architecture/communication.md) に従う。

---

## 1. 目的

NPC の AI 機能は、今後 Offline LLMOps / RAGOps の設計を進める中で、RAG の検索方式、Knowledge の構造、Prompt、Model、評価指標などが変更される可能性がある。

そのため、Main Backend と AI Backend の通信契約へ AI 内部実装の詳細を持ち込みすぎず、**ゲーム側から必要な変更されにくい情報だけを先に暫定定義する**。

本書の目的は、次の3点である。

1. Main Backend と AI Backend の責務を明確に分ける
2. NPC 回答生成に必要な最小限の入出力を暫定定義する
3. 将来の Game-level LLMOps 用 Telemetry を回答生成 Interface から分離し、Offline LLMOps / RAGOps の設計変更による手戻りを抑える

---

## 2. 基本方針

### 2.1 Main Backend はゲーム状態の正当性を管理する

Main Backend は、NPC へ質問を送信する前に、ゲームとして要求が正しいことを確認する。

主な責務は次のとおり。

- 対象ゲームセッションの管理
- プレイヤーのゲーム参加状態の管理
- 現在フェーズの管理
- NPC の存在・会話可否の判定
- NPC との距離判定
- 会話セッションの管理
- `hintLevel` の状態遷移管理
- 二重送信・古い要求・古い回答の判定
- AI Backend から戻った回答を現在のゲーム状態で表示してよいかの最終確認

ゲームの重要な判定は既存の通信方針どおりサーバー権威型とし、AI Backend にゲームルールの正当性判断を持たせない。

### 2.2 AI Backend は回答生成に集中する

AI Backend は、Main Backend が検証済みの要求を受け取り、次の処理に集中する。

```text
質問
  ↓
RAG 検索
  ↓
承認済み Knowledge の取得
  ↓
Prompt 構築
  ↓
LLM による回答生成
  ↓
出力 Validation
  ↓
生成結果を Main Backend へ返却
```

AI Backend はゲームセッション、プレイヤー移動、予算、ゲームフェーズ等の状態を独自に管理しない。原則として1回の生成要求に必要な情報だけを受け取る Stateless な構成とする。

### 2.3 LLMOps / RAGOps の内部情報を Main Backend へ漏らさない

次のような AI 内部設定は、原則として Main Backend から AI Backend へ渡さない。

- `topK`
- 類似度閾値
- Embedding Model
- Retriever の検索方式
- `retrieverVersion`
- `promptVersion`
- `modelVersion`
- `knowledgeVersion`
- 評価用 Scorer の設定

これらは AI Backend / LLMOps / RAGOps 側で管理する。

これにより、Offline LLMOps / RAGOps で Retriever や Prompt を変更しても、Main Backend との Interface を変更せずに改善できる構成を目指す。

---

## 3. 全体フロー

### 3.1 リリース前：Offline LLMOps / RAGOps

Offline LLMOps / RAGOps は、基本的に Main Backend へ接続せずに実行できる構成とする。

```text
Eval Dataset
    ↓
RAG
    ↓
Knowledge
    ↓
Prompt / LLM
    ↓
NPC 回答
    ↓
Evaluation
    ↓
RAG / Prompt / Model / Knowledge を改善
```

Offline 評価では、Retrieval Quality と Generation Quality を分けて評価する。

### 3.2 実ゲーム：回答生成

```text
Frontend
    ↓
Main Backend
    ├─ ゲーム状態・会話可否を検証
    └─ AI 生成要求を作成
    ↓
AI Backend
    ├─ RAG
    ├─ Prompt
    ├─ LLM
    └─ Validation
    ↓
Main Backend
    ├─ 現在も回答を表示可能か再確認
    └─ 古い回答は破棄
    ↓
Frontend
```

### 3.3 リリース後：Game-level LLMOps

Game-level LLMOps では、AI Backend 側の Trace と、Main Backend が持つゲーム側 Telemetry を後から関連付ける。

```text
AI Trace
    ├─ Prompt / Model / Retriever / Knowledge Version
    ├─ Retrieval Result
    ├─ Generation Result
    └─ Evaluation Result

        ＋

Main Backend Telemetry
    ├─ NPC 利用状況
    ├─ 会話後の行動
    ├─ 予算
    ├─ 被災度
    └─ clear / fail

        ↓
Game-level Evaluation
```

回答生成用 Interface と Game-level LLMOps 用 Telemetry は別のデータ経路として扱い、相関 ID によって後から関連付ける。

---

## 4. 責務境界

| 領域 | Main Backend | AI Backend |
|---|---|---|
| ゲームセッション管理 | 担当 | 担当しない |
| フェーズ管理 | 担当 | 担当しない |
| NPC 会話可能距離判定 | 担当 | 担当しない |
| `hintLevel` の状態管理 | 担当 | 受け取った値を生成条件として使用 |
| 質問種別の管理 | 担当 | 受け取った種別に応じて処理 |
| 承認済み Knowledge の検索 | 担当しない | 担当 |
| RAG | 担当しない | 担当 |
| Prompt 構築 | 担当しない | 担当 |
| LLM 推論 | 担当しない | 担当 |
| LLM 出力 Validation | 担当しない | 担当 |
| 古い回答の最終破棄判定 | 担当 | 相関 ID を返却 |
| 承認済み Fallback 文言の表示 | 担当 | 処理結果のみ返却 |
| AI Trace | 担当しない | 担当 |
| ゲーム側 Telemetry | 担当 | 担当しない |

---

## 5. Main Backend → AI Backend 暫定入力 v0.1

本章では、正式な API フィールドではなく、Main Backend から AI Backend へ渡す必要がある**意味上の情報要件**を定義する。

| 項目 | 必須 | 内容 |
|---|---|---|
| `interactionId` | 必須 | 1回の質問と回答を一意に対応付けるための不透明な相関 ID。正式 API での名称は変更可能 |
| `gameSessionId` | 必須 | ゲーム単位で Trace / Telemetry を後から関連付けるための不透明なセッション ID。個人を直接識別する情報を含めない |
| `npcId` | 必須 | 質問対象 NPC の識別子 |
| `scenarioId` | 必須 | 対象シナリオの識別子 |
| `question.type` | 必須 | 登録質問または自由入力を識別する値。概念上 `preset` / `freeText` を想定 |
| `question.questionId` | 条件付き必須 | 登録質問の場合の質問候補 ID |
| `question.text` | 条件付き必須 | 自由入力の場合の質問本文。生成処理にのみ利用し、永続保存しない |
| `hintLevel` | 必須 | Main Backend が管理する現在のヒントレベル |

概念例：

```json
{
  "interactionId": "opaque-interaction-id",
  "gameSessionId": "opaque-game-session-id",
  "npcId": "npc-example-resident",
  "scenarioId": "scenario-example",
  "question": {
    "type": "freeText",
    "text": "この辺は水がたまりやすいの？"
  },
  "hintLevel": 1
}
```

この JSON は正式 API スキーマではなく、情報要件を共有するための概念例である。

### 5.1 v0.1 では含めない情報

次の情報は、現時点では回答生成要求へ含めない。

- プレイヤー名
- `readingLevel`
- プレイヤーの生座標
- 残り予算
- ゲーム全体 State
- `topK`
- 類似度閾値
- Embedding Model
- Prompt / Model / Retriever / Knowledge の Version

プレイヤー座標、予算、ゲーム結果等は、将来 Game-level LLMOps で利用価値がある。ただし、回答生成用 Interface へ混在させず、ゲーム側 Telemetry として別経路で扱う。

### 5.2 `areaId`・`themeId` の扱い

自由入力の RAG 検索では、地域・担当テーマによる検索範囲の制限が必要である。

ただし、`areaId` や `themeId` を Main Backend から毎回送るか、`npcId` / `scenarioId` をもとに AI Backend 側の承認済み設定から解決するかは、Offline RAG 設計と責務境界を確認した後に決定する。

手戻りを防ぐため、v0.1 の必須項目には含めない。

---

## 6. AI Backend → Main Backend 暫定出力 v0.1

| 項目 | 必須 | 内容 |
|---|---|---|
| `interactionId` | 必須 | Main Backend から受け取った相関 ID |
| `result` | 必須 | AI 処理結果を表す論理状態 |
| `answerText` | 条件付き | 正常回答時に表示する本文。Main Backend / AI Backend の永続ログへ保存しない |
| `sourceIds` | 条件付き | 回答根拠として実際に使用した承認済み出典の識別子 |
| `traceId` | 推奨 | AI Backend 側の LLMOps / RAGOps Trace と関連付けるための識別子 |

`result` は概念上、少なくとも次の状態を区別できる必要がある。

- 正常回答
- 根拠なし
- NPC 担当範囲外
- 不適切または安全上の拒否
- LLM / RAG / Validation 等の処理失敗

正式な列挙値、フィールド名、HTTP / WebSocket 上の表現方法は API 設計時に決定する。

概念例：

```json
{
  "interactionId": "opaque-interaction-id",
  "result": "success",
  "answerText": "この辺りには、大雨のときに水が集まりやすい低い場所があるんだ。",
  "sourceIds": ["source-example-001"],
  "traceId": "ai-trace-id"
}
```

### 6.1 Fallback の責務

AI Backend は処理結果を Main Backend へ返す。

プレイヤーへ表示する承認済み Fallback 文言そのものは NPC ゲーム仕様側で管理し、Main Backend が AI Backend から受け取った処理結果に応じて選択する方針を基本とする。

これにより、AI Backend にゲーム表示文言の正本を持たせない。

---

## 7. AI Backend / LLMOps 側で管理する情報

次の情報は、原則として Main Backend の回答生成 Request / Response に含めず、AI Backend の Trace として管理する。

- `promptVersion`
- `modelVersion`
- `knowledgeVersion`
- `retrieverVersion`
- 検索対象 Knowledge ID
- 実際に取得した Knowledge ID
- Retrieval Score
- RAG 処理時間
- LLM 処理時間
- 総処理時間
- LLM 内部生成結果
- Output Validation 結果
- Hard Gate 評価結果
- Quality Score
- Offline Eval Dataset Version

Offline LLMOps / RAGOps では、これらを利用して Prompt、Model、Knowledge、Retriever の変更前後を比較する。

---

## 8. Game-level LLMOps 用 Main Backend Telemetry

Game-level LLMOps は初期回答生成 Interface の必須範囲には含めない。

NPC が実ゲームへ統合された後、AI Trace とゲーム側の状態・行動を関連付けて「AI として良い回答か」だけでなく「ゲーム体験に良い影響を与えたか」を補助的に評価する。

候補となる Telemetry は次のとおり。

| 項目 | 用途 |
|---|---|
| `gameSessionId` | AI Trace とゲーム結果の相関 |
| `interactionId` | 個々の NPC 回答と後続行動の相関 |
| 匿名プレイヤー ID | 同一ゲームセッション内のプレイヤー単位集計 |
| NPC 利用回数 | NPC 機能利用状況 |
| 会話時間 | 情報取得に要した時間 |
| 追加ヒント要求 | 初期ヒントの情報量が適切かを見る補助指標 |
| 会話後に配置した土木技術 ID | NPC 情報と後続行動の関係を見る補助指標 |
| 残り予算 | 意思決定結果を見る補助指標 |
| 最終被災度 | ゲーム結果指標 |
| clear / fail | ゲーム結果指標 |

勝敗や被災度は NPC 回答以外の要因にも強く影響されるため、NPC 品質を単独で決める指標には使用しない。回答品質評価の補助データとして扱う。

### 8.1 プレイヤー座標

生のプレイヤー座標を LLMOps へ常時保存することは初期要件としない。

会話後の位置変化を評価したい場合は、まず `areaId`、`zoneId`、NPC からの距離など、分析目的に必要な特徴量へ変換して利用できるかを検討する。

---

## 9. Offline LLMOps / RAGOps と Interface の変更方針

Offline LLMOps / RAGOps の開発中に、次のような変更が発生しても Main Backend Interface は原則変更しない。

- Vector Search から Hybrid Search への変更
- `topK` の変更
- 類似度閾値の変更
- Embedding Model の変更
- Prompt の変更
- LLM Model の変更
- Judge / Scorer の追加
- Eval Dataset の追加
- Knowledge の Version 更新

Main Backend Interface へ新しい項目を追加するのは、**AI Backend 内部から導出できず、Main Backend が正本として保持するゲーム情報が生成または評価に本当に必要であると確認された場合だけ**とする。

---

## 10. データ保護と保存方針

既存要件に従い、次の情報は永続保存しない。

- プレイヤーが自由入力した質問本文
- NPC が生成または表示した回答本文
- プレイヤー名
- 入力された個人情報

`readingLevel` は回答生成の語彙・情報量を変更する設定ではないため AI Backend へ送信しない。また、現時点では匿名分析対象にも含めない。

LLMOps / RAGOps の本番 Trace は、原則として本文を保存せず、次のようなメタデータ中心で構成する。

- 相関 ID
- NPC / Scenario ID
- `hintLevel`
- Knowledge / Source ID
- Prompt / Model / Retriever / Knowledge Version
- 処理結果
- 処理時間
- Evaluation 結果

---

## 11. 未決定事項

本書では次を確定しない。

- Main Backend / AI Backend 間を REST、WebSocket、その他の方式のどれで接続するか
- エンドポイント・イベント名
- TypeScript / Go 等の DTO
- HTTP Status / Error Code
- Retry 方針
- Timeout の責務分担
- `interactionId` の正式名称・生成方式
- `areaId` / `themeId` をどちらの Backend が正本として解決するか
- AI Trace の具体的な保存先
- LLMOps / RAGOps 製品
- Game-level Telemetry の保存方式

これらは Offline LLMOps / RAGOps の設計結果を踏まえ、Main Backend / AI Backend 担当者との API 設計協議で確定する。

---

## 12. 今後の進め方

大きな設計順序は次のとおりとする。

```text
B. AI / RAG / LLMOps 設計
    ↓
C. Main Backend / AI Backend Interface 案
    ↓
Backend 担当者と協議
    ↓
C. Interface 確定
    ↓
A. NPC のゲーム統合設計
    ↓
全体整合
    ↓
設計書完成
    ↓
実装
```

ただし Main Backend 側の先行実装に必要なため、B の設計途中で本書の v0.1 を暫定共有する。

次の順で更新する。

1. 本書 v0.1 の最小情報要件を Main Backend 担当者へ共有する
2. Offline LLMOps / RAGOps の Eval Dataset、Knowledge、RAG、Prompt、LLM、Evaluation を設計する
3. Main Backend 由来でしか取得できない追加情報の必要性を確認する
4. 必要な場合のみ本書を v0.2 へ更新する
5. Backend 担当者と正式な API / 通信 Interface を確定する

この順序により、Main Backend の開発を止めず、同時に Offline LLMOps / RAGOps の設計変更による手戻りを最小化する。
