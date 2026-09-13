# CivilCraft NPC 機能 — 詳細設計書

## 文書の状態

- 状態：詳細設計承認済み
- 対象：[`requirements.md`](./requirements.md) で定義した要件のうち、ゲーム本体との統合設計
- 位置づけ：統合構成、UI、状態遷移、型、ファイル、テストの**正本**。**API・通信方式（REST/WebSocketの使い分け、イベント名、エンドポイント、ペイロード、TypeScript型、Go DTO）は本書では確定せず、別のAPI設計Issueで決定する。本書はAPI設計Issueへ引き継ぐ制約・要件のみを記載する（19章）**。RAG・LLM・知識データ・安全性の専門設計は [`dialogue-ai-design.md`](./dialogue-ai-design.md) を参照

各項目に既存実装との関係を次のラベルで示す。

- `[既存実装]` 中身のあるコードとして既にリポジトリに存在する実装
- `[既存の空スタブ]` ファイル自体は存在するが、`package`宣言のみ、または0バイトで中身がない
- `[NPC実装前に別Issueで実装が必要]` NPC機能が前提として依存するが、NPC実装のスコープには含まれない
- `[NPC実装と同時に新規実装する候補]` NPC実装のタイミングで中身を実装してよい既存の空ファイル、または新規ファイル
- `[確定仕様]` 本設計協議でユーザーが確定させた仕様
- `[要確認]` 実装着手時にユーザー確認が必要
- `[チーム協議]` チームでの協議が必要
- `[API設計Issueで決定]` 具体的な通信方式・型・フィールド構成は別のAPI設計Issueで決定する

---

## 1. 設計方針

`[確定仕様]`

承認済み事実（`canonicalFact`）とヒントレベルは不変のまま、LLM は表現の言い換えにのみ関与する。「よみやすさ」は事実レイヤーとは独立した表記レイヤーとして扱い、LLM 出力の後段でサーバーが表示用構造（8章）へ変換し、クライアントは受け取ったデータをレベルに応じて描画するだけの薄い層とする。よみやすさレベルごとに文章を作り分けない。単一の表示用構造を 3 段階で共有し、表示側の切替のみで対応する。

表示用構造の由来は文言の種類によって異なる（13章参照）。質問候補・自己紹介・災害中定型文・フォールバックは、文言そのものが人間承認を経て確定した**承認済み文言**である。一方、LLM生成回答は、承認済みの`canonicalFact`を根拠にLLMが実行時に生成し、サーバー検証を通過した**実行時生成回答**であり、文言自体は事前に人間承認を経ていない。「単一の表示用構造を3段階で共有する」という表示切替の原則はいずれの種類にも共通して適用されるが、LLM生成回答を「承認済み」とは表現しない。

## 2. 既存アーキテクチャとの関係

`[確定仕様]`

`docs/architecture/overview.md` の依存方向（`player/room/mapdata/world → game → construction/disaster → simulation`）に対し、NPC は新規トップレベルモジュール `internal/npc/` として、`construction`・`disaster` と並列の第 3 層に置く。`game`（フェーズ・セッション・世界状態）・`mapdata`（NPC 位置検証）に依存し、`disaster` への直接依存は作らない。`construction` への直接依存も作らない（12章）。災害中の浸水状態は `game/state` が保持する集約状態から取得する想定である。

## 3. 依存関係と前提条件

`[既存の空スタブ／NPC実装前に別Issueで実装が必要]`

本設計時点で、NPC機能が依存する既存モジュールの実装状況を次のとおり確認した。いずれも中身が`package`宣言のみ、または0バイトの空スタブであり、実装済みの機能ではない。

| 対象 | 現状 | 区分 |
|---|---|---|
| `apps/server/internal/game/state/{game_state,player_state,world_state}.go` | `package state`宣言のみ | `[NPC実装前に別Issueで実装が必要]`（フェーズ管理・ゲーム状態の変化を識別する仕組み・浸水状態の保持元として必須） |
| `apps/server/internal/game/tick/{loop,scheduler}.go` | `package tick`宣言のみ | `[NPC実装前に別Issueで実装が必要]`（会話中もTickが進むことの検証に必須） |
| `apps/server/internal/game/realtime/{client,hub,reader,writer}.go` | `package realtime`宣言のみ | `[NPC実装前に別Issueで実装が必要]`（リアルタイム通信基盤そのもの。具体的な通信方式はAPI設計Issueで決定） |
| `apps/server/internal/game/session/{registry,session}.go` | `package session`宣言のみ | `[NPC実装前に別Issueで実装が必要]`（ゲームセッション・プレイヤー所属判定に必須） |
| `apps/server/internal/game/snapshot/{repository,snapshot}.go` | `package snapshot`宣言のみ | `[要確認]`（NPC機能から直接使うかは未定） |
| `apps/server/internal/construction/{domain,application,infrastructure,presentation}/*.go` | 各ファイル`package`宣言のみ | `[既存の空スタブ]`（実装パターンの参考にはなるが中身はない） |
| `apps/server/cmd/game/main.go` | ヘルスチェックのみの実装（`[既存実装]`） | `[NPC実装と同時に新規実装する候補]`（`npc`モジュールのDI配線。通信ハンドラ登録はAPI設計Issue確定後） |
| `apps/web/src/stores/{playerStore,gameStore}.ts` | 0バイト | `[NPC実装と同時に新規実装する候補]` |
| `apps/web/src/services/websocket/`・`services/storage/` | ディレクトリのみ存在、ファイルなし | `[要確認／API設計Issueで決定]`（`services/websocket/`は通信方式確定後、`services/storage/`はNPC実装と同時に新規実装する候補） |
| `apps/web/src/game/**`（Three.js層） | 0バイト | `[要確認]`（NPC接近判定の予測表示との関連は実装時に確認） |
| `packages/game-schema/websocket/{client-events,server-events,payloads}.ts` | 実データあり | `[既存実装]`（NPCイベント追加の要否・内容はAPI設計Issueで決定） |
| `packages/game-data/structures/*.json` | 実データあり | `[既存実装]`（参照パターンとして利用） |
| `packages/game-data/scenarios/*.json` | 一部空（`beginner.json`等） | `[要確認]`（NPC有効/無効フラグの追加要否を含む） |

**前提条件**：NPC機能は `game/state`（フェーズ管理・ゲーム状態の変化を識別する仕組み・浸水状態）および `game/session`（ゲームセッション・プレイヤー所属）が実装されていることに依存する。これらは現状空スタブであり、NPC実装前または並行して別Issueでの実装が前提条件となる。本書はこれらの実装を提案するものではなく、NPC機能側から必要とするインターフェースを明示するにとどめる。

## 4. フロントエンド構成

`[NPC実装と同時に新規実装する候補]`

`apps/web/src/features/npc/`（`construction`と同型：`components/` `hooks/` `services/` `types/` `index.ts`）を新設する。NPC文言は次の3カテゴリに分離する（詳細は13章）。配信経路（通信手段）はAPI設計Issueで決定する。

| カテゴリ | データソース | 配信経路 |
|---|---|---|
| LLM生成回答（準備・自由入力） | Ollama→サーバーで一度だけ表示用構造へ変換 | API経由（通信方式はAPI設計Issueで決定） |
| 承認済みマスターデータ（質問候補・自己紹介・災害中定型文・フォールバック） | `packages/game-data/npc/*.json`（人間承認済み） | API経由（会話開始時、通信方式はAPI設計Issueで決定） |
| フロントエンド静的UIラベル（話す／閉じる／もっと詳しく聞く 等） | フロントエンドコード内の定数 | 配信なし（ビルドに同梱） |

いずれも同じ`ReadingAwareText`コンポーネントで描画するが、静的UIラベルは通信経由にしない。

## 5. バックエンド構成

`[NPC実装と同時に新規実装する候補]`

`apps/server/internal/npc/`を新設し、既存4層規約（`domain/application/infrastructure/presentation`）に従う。`domain`：NPC・会話セッション・知識レコードのエンティティ。`application`：会話開始・質問処理・災害中応答生成のユースケース、および18章のサーバー権威型検証。`infrastructure`：知識データローダー、Ollamaクライアント、ふりがな辞書アノテーター。`presentation`：通信ハンドラ（具体的な通信方式・エンドポイントはAPI設計Issueで決定、19章）。

## 6. packages/uiの汎用よみやすさ表示

`[確定仕様]`

`packages/ui/src/ReadingAwareText/`（新規。`packages/ui`は現状`package.json`自体が存在しないため新規作成）。表示ロジックを次のとおり確定する。

```text
standard  : segments を順に描画。text を表示。showRubyInStandard === true のセグメントのみ reading をルビとして重ねる。
furigana  : segments を順に描画。text を表示。reading が存在する全セグメントにルビを重ねる。
kana      : segments を順に描画。reading があれば reading を表示、なければ text をそのまま表示（漢字が残り得る）。
```

`dangerouslySetInnerHTML`は使用しない。ふりがな判定・技術用語判定のロジックは持たず、受け取った構造化データを描画するだけの薄い層とする。NPC以外への将来適用時も、呼び出し側が`segments`を用意すればそのまま再利用できる。

かな中心表示で本文の見た目の文字数が増える場合、過度な文字縮小は行わず、会話パネル内での折り返し、またはスクロールを第一候補とする。

### packages/uiの通信非依存性

`[確定仕様]`

`packages/ui`は「共通UIコンポーネント」（`docs/architecture/overview.md`）であり、通信スキーマを集約する`packages/game-schema`より下位の汎用パッケージと位置づける。`packages/ui`は`packages/game-schema`へ直接依存しない（NPC-NFR-013）。`ReadingAwareText`は、通信方式に依存しない構造的な表示型（`ReadingAwareSegment`、8章）を受け取るだけの薄い層とする。

API設計Issueで通信データの型・パッケージ配置が決定した後、アプリケーション層（`apps/web/src/features/npc`等）が、その通信データを`ReadingAwareSegment[]`へ変換して`ReadingAwareText`へ渡す責務を持つ。この変換にコードが必要か（TypeScriptの構造的型付けにより変換コードなしで渡せる場合を含む）は、通信データの型が確定するAPI設計Issueの結果を踏まえて判断する。この方針は、`docs/architecture/dependency-rules.md`が定めるバックエンドモジュールの一方向依存の原則（循環参照禁止）と同じ考え方を、フロントエンドパッケージ間の関係にも適用したものである。

## 7. ReadingLevel型

`[確定仕様]`

### 配置の判断

`readingLevel`は通信へ送信しないため（NPC-NFR-007）、通信型を集約する`packages/game-schema`へ置く必然性はない。配置候補を比較する。

| 案 | 長所 | 短所 |
|---|---|---|
| `packages/ui`の公開型として配置 | `ReadingAwareText`コンポーネント自身がこの型を必要とし、型の所有者をコンポーネント提供パッケージに一致させられる。`apps/web`が`packages/ui`をimportする既存の依存方向と整合する | `packages/ui`は現状パッケージとして未整備（新規作成が必要） |
| `apps/web`の設定型として配置 | 影響範囲が最も狭い | `packages/ui`の`ReadingAwareText`自体がこの型を必要とするため、`apps/web`内に置くと`packages/ui`が`apps/web`に依存する逆転が生じ、依存ルール上望ましくない |
| `packages/game-schema`の共通型として配置 | 「共通型はgame-schemaに集約」という既存の分かりやすいルールに従える | `game-schema`は「REST API・WebSocketイベントの型定義」パッケージであり、通信されない値を置くと責務が曖昧になる |

**結論**：`ReadingLevel`は`packages/ui`の公開型として配置する。`apps/web`側は`packages/ui`をimportして型を参照する。この決定は通信方式の選定と独立しており、API設計Issueの結果に関わらず変わらない。

```ts
// packages/ui/src/ReadingAwareText/reading-level.ts（新規作成候補）
export type ReadingLevel = "kana" | "furigana" | "standard";
```

既存の段階ヒント（`hintLevel`）とは明確に別の型・別のフィールド名とする。UI文言・ログ・変数名のいずれでも「レベル」を単独で使わず、必ず`readingLevel`／`hintLevel`と明示する。

## 8. 表示用データ構造

`[確定仕様（構造）／API設計Issueで決定（通信経路上の型・パッケージ配置）]`

`ReadingAwareText`（6章）が受け取る表示用データの構造を次のとおり確定する。これは`packages/ui`が所有する、通信方式に依存しない構造型である。

```ts
// packages/ui/src/ReadingAwareText/types.ts（新規作成候補）
export type ReadingAwareSegment = {
  text: string;
  reading?: string;             // 辞書照合で確定した読み。確定しない場合は省略
  showRubyInStandard?: boolean; // 標準モードでもルビを表示する対象か
  glossaryTermId?: string;      // 承認済みグロッサリーとの対応がある場合のみ設定
};
```

「技術用語であること」と「標準モードでルビ表示すること」を同一のbooleanで表現しない。`glossaryTermId`を持つセグメントは通常`showRubyInStandard: true`になるが、地名や一般難語など`glossaryTermId`を持たずに`showRubyInStandard: true`のみのセグメントも許容する。

この構造が、API設計Issueで決定する通信データの型（`packages/game-schema`配下の型を含む）とどう対応するか、両者を同一の型として扱うか変換を挟むかは、API設計Issueで決定する。本文の文字数制限（原則1〜2文、`text`部分の合計を基準とし`reading`は含めない）という方針は維持するが、通信上どの型・どの層でこの制限を検証するかもAPI設計Issueで決定する。セグメントの生成・検証（辞書照合、最長一致、付与率計測等）は25章「ふりがな生成・検証」を参照。

## 9. ローカル保存

`[確定仕様]`

| 項目 | 内容 |
|---|---|
| localStorageキー | `civilcraft.npc.readingLevel`（新規作成候補、正式名は命名規則確認後に確定） |
| 保存値のバージョン | `{ version: 1, value: ReadingLevel }`のようにバージョン付きで保存し、将来のスキーマ変更に備える |
| 未設定時のデフォルト | `standard` |
| 不正な保存値 | パース失敗・不明な値・バージョン不一致の場合は`standard`へフォールバックする |
| localStorage利用不可 | `try/catch`で握りつぶし、メモリ内デフォルト`standard`で動作を継続する（ゲームを停止させない） |
| 反映範囲 | 変更は同一ブラウザ内のUIへ即時反映。会話画面を開いたまま変更した場合も、再通信・LLM再実行なしで即時再描画する |
| 同期範囲 | 他プレイヤー・他端末・他ブラウザへは同期しない |
| サーバー送信 | サーバー側`player`ドメイン、会話セッション、NPC関連の通信データのいずれにも`readingLevel`を追加しない |

`apps/web/src/services/storage/readingLevelStorage.ts`（新規作成候補）に実装する。

## 10. ロビーと常時メニュー

`[要確認]`

ロビー画面・常時メニューへの具体的なコンポーネント配置は未定（`requirements.md`23章の未決定事項を参照）。

## 11. NPCマスターデータ・配置・マップ表示

`[NPC実装と同時に新規実装する候補]`

NPCマスターデータ（`packages/game-data/npc/npc-definitions.json`等、新規作成候補）は、少なくとも次の項目を持つ。

- NPC ID、シナリオID、有効・無効フラグ
- 表示名（`displayName`、表示用セグメント配列）
- 職業表示（`occupationLabel`、表示用セグメント配列）
- 性格（LLMへの内部指示用文字列。プレイヤーへ直接表示しない）
- 担当テーマ（NPC-FR-003、NPC-FR-054）
- 座標（マップ上の位置）
- 会話可能距離（プレイヤーが「話す」ボタンを表示できる範囲、NPC-FR-004・NPC-FR-039）
- 自宅または関連地点の位置（役割テンプレートとの対応）
- 建設禁止範囲（NPC・自宅・会話範囲、NPC-FR-036・NPC-FR-039。具体的な設計は12章）
- 質問候補ID一覧（3件、NPC-FR-007）
- 処理結果別フォールバック応答ID（`fallbackResponseIds`。`llmFailure`・`noEvidence`・`outOfScope`・`inappropriate`）

NPCの表示名と職業表示は、プレイヤーへ表示する承認済み文言であるため、単純な文字列ではなく8章の表示用セグメント配列として保持する。LLMへNPC名・職業を渡す場合は、各セグメントの`text`を連結した標準表記を使用する。`readingLevel`はLLMへ渡さない。性格はLLMの話し方を制約する内部情報であり、表示用セグメントにはしない。

NPCの位置はマップ上に常時アイコンで表示する（NPC-FR-035）。NPCはフィールド内の決められた位置から移動せず（NPC-FR-033）、プレイヤーへ自分から接近しない（NPC-FR-034）。**NPCドメインモデルは移動処理（経路探索・速度・目的地等）を一切持たない**。これはNPCの範囲外機能（`docs/npc/overview.md`のスコープ外）を実装で誤って持ち込まないための明示的な制約である。

**浸水しにくい配置の検証方法**：NPCの座標が極端に浸水しにくい地点であること（NPC-FR-038）は、マップデータ登録時の静的検証と、人間によるレビューで保証する。`docs/civil-engineering/disasters.md`は災害設計上の参照資料であり、現時点で実装済みの浸水シミュレーションを意味しない。前提Issueで、地点ごとの浸水リスクを算出または参照できる仕組みが実装された後、その結果が所定の閾値以下であることを検証する。前提機能が未実装の間はNPC座標を仮値として扱い、本番用配置として承認しない。閾値の具体値と参照方法は前提Issueの設計確定後に決定する。

## 12. 建設禁止範囲の設計

`[推奨設計]`

NPC・自宅・会話範囲への施設配置禁止（NPC-FR-036・NPC-FR-037）を実現するにあたり、`internal/npc/`モジュールと`internal/construction/`モジュールを直接依存させる設計は避ける。`docs/architecture/dependency-rules.md`の依存方向（循環参照禁止）に照らすと、`npc`と`construction`はいずれも`game`に依存する第3層の並列モジュールであり、両者間の直接依存（`npc`→`construction`または`construction`→`npc`）は新たな依存を生み、将来の循環参照リスクを高める。

**推奨方式**：NPC・自宅・会話範囲を、マップデータまたはゲーム状態が提供する汎用的な「建設禁止領域」として登録する。現時点では`construction`および関連するゲーム状態が空スタブであり、この汎用建設禁止領域の検証はまだ実装されていない。前提Issueでは、`construction`モジュールがNPCの存在を直接知ることなく、汎用建設禁止領域リストだけを検証できる仕組みを実装する。NPC側は、NPCマスターデータに基づく座標・自宅・会話範囲を汎用建設禁止領域として提供する。両モジュールは`mapdata`または`game/state`が公開する汎用領域の仕組みに依存し、`npc`と`construction`の直接依存は作らない。

建設禁止判定は、クライアント側の入力制御に加えサーバー側でも検証する（NPC-FR-037）。

## 13. 静的文言と動的文言の正本

`[確定仕様]`

| カテゴリ | 正本 | 生成タイミング | 配信経路 |
|---|---|---|---|
| LLM回答 | `canonicalFact`を根拠にLLMが生成した本文を、サーバーが一度だけ表示用構造（8章）へ変換したもの | 質問のたびに生成、レベル別には生成しない | API経由（通信方式はAPI設計Issueで決定） |
| NPCの表示名・職業表示・質問候補・自己紹介・災害中定型文・フォールバック | `packages/game-data/npc/`の承認済み単一表示用構造 | 事前登録、人間承認後に確定 | API経由（会話開始時、通信方式はAPI設計Issueで決定） |
| 「話す」「閉じる」等のUIラベル | フロントエンドの静的セグメント定数 | ビルド時に確定、配信なし | 配信なし（ビルドに同梱） |
| 土木用語・地名・重要語の読み | 承認済みグロッサリー（`npc-glossary.json`） | 事前登録、人間承認後に確定 | データ登録時に他文言へ反映（配信対象ではない） |

readingLevelごとの文章バリアントはいずれのカテゴリにおいても作成しない。

## 14. 準備フェーズの回答処理

`[推奨設計]`

準備フェーズでは、正常に受理され、かつ承認済みの根拠情報が取得できた質問について、登録質問・自由入力のいずれもLLMによる言語化を経る（NPC-FR-043）。範囲外・不適切・根拠なしの場合はLLMを呼び出さず、NPC定義に対応付けられた承認済み応答を表示する。

- **登録質問**：質問候補に対応付けられた承認済み知識IDを直接取得し（NPC-FR-044）、LLMへ渡す
- **自由入力**：承認済み知識をRAG検索した結果を取得し（NPC-FR-045）、LLMへ渡す

いずれの経路でも、LLMは承認済み`canonicalFact`の言語化だけを行い、`canonicalFact`にない事実を追加しない（[`dialogue-ai-design.md`](./dialogue-ai-design.md)「LLMが行ってはいけないこと」）。災害フェーズ中はこの処理を使用しない（NPC-FR-046、21章）。

具体的な検索・LLM呼び出しの実装、RAG検索基盤の選定は`dialogue-ai-design.md`を参照。通信上どのタイミング・どの手段でクライアントへ結果を返すかはAPI設計Issueで決定する（19章）。

## 15. 会話セッション

`[NPC実装と同時に新規実装する候補]`

会話セッションは、ドメイン・アプリケーション層の状態として次を管理する。具体的な通信手段・フィールド名はAPI設計Issueで決定する（19章）。

- プレイヤー・NPCごとに独立した一時セッションを持つ（NPC-FR-010）
- 回答待ち状態を持ち、回答待ち中は次の質問送信を受け付けない（NPC-FR-047）
- 1プレイヤーにつき同時に処理する質問要求は1件までとする（NPC-FR-048）
- 二重タップ等による重複要求を防止する（NPC-FR-049）
- 回答表示後2秒間は次の送信を受け付けない（NPC-FR-050）
- 会話を閉じた時点で会話履歴を破棄する（NPC-FR-051）
- 接続切断、ゲーム終了、フェーズ変更のいずれかが発生した場合も会話セッションを終了する（NPC-FR-052）
- 会話画面を開いている間はプレイヤーが移動できないため、会話中に接近距離を繰り返し判定しない（NPC-FR-055）

これらはセッションの状態機械（16章 状態遷移）およびサーバー権威型の検証（18章）と連動する。

## 16. 状態遷移

`[確定仕様]`

```text
未接触 → 話す可能 → 会話中 → 回答待ち → 回答表示 → 終了
```

「準備フェーズから災害フェーズへ移行した」というイベントを検知した場合、`回答待ち`または`回答表示`のいずれの状態からも強制的に`終了`へ遷移し、未完了のLLM回答は破棄する。

## 17. ゲームフェーズ連携

`[NPC実装前に別Issueで実装が必要（前提部分）／NPC実装と同時に新規実装する候補（NPC側の対応部分）]`

`game`モジュールが管理するフェーズの変更を検知した時点で、当該プレイヤーの会話画面を閉じ、未完了要求を無効化する（16章・18章と整合）。フェーズ変更を識別できる安定した仕組み（現在のフェーズ・ゲーム状態が古いか新しいかを判別する手段）を設ける必要があるが、その具体的なメカニズム（バージョン番号、タイムスタンプ等）はAPI設計Issueで決定する（19章）。

## 18. サーバー権威型の検証

`[確定仕様]`

クライアント側は、操作性のためにNPCへの接近を予測して「話す」ボタンを表示してよいが、これは表示上の予測であり、サーバーの検証を代替しない。

### 会話開始時の検証

サーバーは会話を開始する前に、次をすべて検証する（NPC-FR-031）。

- シナリオでNPC機能が有効か
- NPCが存在するか
- NPCに承認済み知識があるか
- プレイヤーとNPCが会話可能距離内か
- 現在のゲームフェーズで会話可能か
- プレイヤーが対象ゲームセッションへ所属しているか
- 重複または不正な会話要求ではないか

いずれかを満たさない場合、会話を開始しない。

### 質問処理時の検証

サーバーは質問を処理する前に、次をすべて検証する（NPC-FR-032）。

- 会話の所有者
- NPC
- ゲームフェーズ
- 質問種別
- 入力文字数（最大100文字）
- ヒントレベルの遷移が許可された範囲内か
- 同時要求数（1件のみ）
- 送信間隔（回答後2秒）

いずれかを満たさない場合、要求自体が不正であるとして拒否する。この拒否は、正常に受理された質問の処理結果（LLM障害等を含む）とは区別する（NPC-FR-058、27章）。

### 会話中の移動・施設配置停止

クライアントUIでは会話中の移動・施設配置操作を無効化するが、これは操作性のための制御であり、サーバー側の防御を代替しない。サーバーは、会話中のプレイヤーから移動・施設配置要求を受け取った場合、これを受理せず拒否する。要求を拒否時にエラー応答を返すか、要求を無視して黙って破棄するかは`[検証後決定]`とする。

### 非同期回答の対応付けと破棄

質問の処理結果（LLM生成回答を含む）は非同期に返る可能性があるため、サーバーおよびクライアントは、回答を送信元の会話・質問要求と安全に対応付けられる仕組みを持つ（NPC-FR-056）。現在の会話・質問・ゲームフェーズに対応しない古い回答は表示せず破棄する（NPC-FR-057）。ただし、通常のTick進行によるゲーム状態の変化を「古い」と誤判定し、正常なLLM回答まで誤って破棄しないよう、フェーズ変更のような意味のある変化とTickごとの微小な変化を区別できる設計とする。具体的な対応付け・判定の仕組み（識別子の構成、比較方法等）はAPI設計Issueで決定する（19章）。

以上の検証項目・区別要件は、API設計Issueが満たすべき制約として19章へ引き継ぐ。

## 19. API設計Issueへの引き継ぎ条件

`[API設計Issueで決定]`

NPC機能のAPI・通信方式の詳細設計は、本書の対象範囲外とし、別のAPI設計Issueで行う。次は今回のNPC要件定義書・詳細設計書では確定しない。

- REST と WebSocket の具体的な使い分け
- WebSocket イベント名
- API エンドポイント
- リクエスト・レスポンスのペイロード
- TypeScript 型
- Go の通信 DTO
- `requestId`、`conversationId` 等の具体的なフィールド構成
- `gameStateVersion`、`phaseVersion` 等の相関方式
- `status`、`reasonCode` の列挙値
- エラーイベントの分割
- `packages/game-schema` へ追加するファイル

API設計Issueでは、次の条件を必ず満たす。

- ゲーム中の通信は既存アーキテクチャの通信方針（`docs/architecture/communication.md`）に従う
- プレイヤーIDをクライアント申告から信用しない（NPC-NFR-012）
- 会話開始前にサーバー権威型の検証を行う（18章、NPC-FR-031）
- 質問処理前にサーバー権威型の検証を行う（18章、NPC-FR-032）
- 同一プレイヤーの同時質問要求は1件まで（NPC-FR-048）
- 二重送信を防止できる（NPC-FR-049）
- 回答後2秒間の送信制限を検証できる（NPC-FR-050）
- 非同期回答を元の会話・質問へ安全に対応付けられる（NPC-FR-056、18章）
- 準備中の回答を災害開始後に表示しない（NPC-FR-057、NPC-FR-011）
- ゲーム状態が通常のTickで変化しても、正常なLLM回答を誤って破棄しない（18章）
- フェーズ変更を識別できる安定した仕組みを設ける（17章）
- 災害中はLLM・RAG・段階ヒントを使用しない（21章）
- LLM障害時は登録済み基本回答を表示する（NPC-FR-059、27章）
- 要求拒否と、受理済み質問の処理失敗を区別できる（NPC-FR-058）
- 内部エラーを子どもへ直接表示しない（NPC-FR-060）
- `readingLevel`を通信へ含めない（NPC-NFR-007）
- 質問文・回答文を永続ログへ保存しない（NPC-NFR-003）
- プレイヤー名をLLMへ送らない（[`dialogue-ai-design.md`](./dialogue-ai-design.md)）

具体的なイベント名、フィールド、DTO、`status`、`reasonCode`はAPI設計Issueで決定し、決定後に本書および`requirements.md`の該当箇所を更新する。

## 20. 結果画面への出典情報配信

`[確定仕様（表示範囲・一時保持）／API設計Issueで決定（配信経路）]`

結果画面へは、参照した`sourceId`をもとに承認済み出典メタデータを表示する。配信経路（既存のゲーム結果配信経路、WebSocketスナップショット、結果イベント、REST等のいずれを採用するか）はAPI設計Issueで決定する。決定時は`docs/architecture/communication.md`の通信方針に従う。

### 出典情報の一時保持

`[確定仕様]`

結果画面へ出典を表示するため、質問文・回答文は一切永続化しない。ゲームセッション中は、参照した`sourceId`のみをサーバー側でゲームセッションスコープの一時データとして保持する。結果画面表示時に、保持していた`sourceId`から承認済み出典メタデータ（知識レコードの`source`フィールド）を取得して表示する。ゲームセッション終了後は、この一時保持データを破棄する。分析ログ（29章）へも出典本文・回答本文を保存しない。

マルチプレイでは、ゲームセッション中にチーム全体が参照した`sourceId`をサーバー側で重複排除して一時保持する。結果画面では、その重複なし一覧から承認済み出典メタデータを表示する。プレイヤー別の質問文・回答文・参照履歴は保持しない。

## 21. 災害中の挙動

`[確定仕様]`

災害フェーズ中のNPC会話は、次のとおりユーザーから見た挙動を確定する。具体的にどの通信手段・APIで実現するかはAPI設計Issueで決定する（19章）。

- 災害中にNPCへ話しかけると、NPC周辺の現在状況を表示する（NPC-FR-012）
- 災害中は質問候補を表示しない
- 災害中は自由入力を表示しない
- 災害中は段階ヒントを使用しない
- 災害中はLLM・RAGを使用しない
- NPC周辺のサーバー権威型ゲーム状態と承認済み定型文を使用する（[`dialogue-ai-design.md`](./dialogue-ai-design.md)）
- 結果フェーズではNPCと会話できない

## 22. RAG検索

`[チーム協議]`

`docs/npc/dialogue-ai-design.md`の未決定事項のまま（pgvector／簡易検索／外部ベクトルDB）。

## 23. LLMプロンプト

`[NPC実装と同時に新規実装する候補]`

LLMへは`canonicalFact`・人格・`hintLevel`・文字数制約を渡す。`readingLevel`は渡さない（語彙・言い回しは3段階で共通のため、LLM出力は常に「標準相当」のプレーン文で統一する）。LLMにふりがな・ルビ・HTMLの生成を指示しない。

## 24. LLM出力検証

`[NPC実装と同時に新規実装する候補]`

LLM呼び出し前に、サーバーは検索または登録質問から得られた知識レコードが承認済みであり、現在のNPC・シナリオ・地域・担当テーマ・ヒントレベルの範囲内であることを検証する。根拠となる`sourceIds`はこの時点でサーバーが確定し、LLMに決定・申告させない。`hintLevel`も会話セッションの状態からサーバーが確定する。

LLMからは、APIレスポンスとは独立した内部生成結果として、回答本文と最小限の生成結果だけを受け取る。LLMは`sourceIds`、`hintLevel`、表示用`segments`、`readingLevel`、API上の状態を出力しない。

LLM出力後、サーバーは内部生成結果の形式、回答本文の空文字、1〜2文、最大120文字、禁止パターン、URL、HTML・ルビマークアップ、制御文字、個人情報の反復を検証する。検証後に回答本文を8章の表示用セグメント配列へ変換する。非同期処理完了時には、現在も同じゲーム・フェーズ・会話セッション・質問要求であることを再検証する。通信上のフィールド、DTO、状態値はAPI設計Issueで決定する。

## 25. ふりがな生成・検証

`[NPC実装と同時に新規実装する候補]`

**辞書照合方式**：形態素解析エンジンは新規重量依存となるため導入せず、ルールベースの3段階処理とする。

1. 承認済みグロッサリー（`npc-glossary.json`）に対する最長一致：長い語から先に一致を試みる（例：「排水機場」が登録済みなら4文字単位でヒットさせ、「排水」「機場」に分割しない）
2. 基礎語彙の読み仮名辞書に対する完全一致
3. いずれにも一致しない文字列は、`reading`を付与しない1つのセグメントとして残す（漢字のまま表示される）

**セグメント分割単位**：文字列を上記の辞書照合結果に基づいて分割する。文の区切り（句読点等）は独立したセグメントとする。

**誤認防止**：「かな中心」設定の説明文言には「読みが分かっている語をひらがなで表示します。一部の言葉はそのまま表示されることがあります」等、完全変換を約束しない表現を用いる。

**優先登録**：技術用語・地名・NPCが頻繁に使う語は承認済みグロッサリーへ優先登録する。

**付与率計測テスト**：承認済み文言コーパスに対する`reading`付与率を計測するテストを用意する（NPC-NFR-010）。閾値はチーム協議。

**重要語欠落検出**：`glossaryTermId`を持つべき語が本文中に出現するのに対応するセグメントに`reading`が付与されていないデータを検出するバリデーションをマスターデータ登録パイプラインに組み込む（NPC-NFR-011）。

## 26. Ollama接続

`[チーム協議]`

`docs/npc/dialogue-ai-design.md`の環境変数案（`NPC_LLM_*`）を踏襲。

## 27. LLMフォールバックの挙動

`[確定仕様（挙動）／API設計Issueで決定（表現方式）]`

次のいずれかが発生した場合、NPC定義の`fallbackResponseIds`から処理結果に対応するIDを解決し、`npc-fallback-responses.json`に登録された承認済みフォールバック応答を表示する。

- LLMタイムアウト
- LLM接続失敗（Ollama接続失敗を含む）
- LLM内部生成結果の解析失敗
- 回答本文の空文字・文字数・文数・禁止パターン等の出力検証失敗
- 承認済み根拠情報の範囲外となる回答の検出

これらの障害は、正当に受理された質問の処理結果として扱う（18章、NPC-FR-059）。障害の種類は、質問文・回答文を含まない運用ログ（30章）に記録できるようにする。具体的な`status`・エラーコード・レスポンス型はAPI設計Issueで決定する（19章）。

## 28. 同時実行制御

`[NPC実装と同時に新規実装する候補]`

15章「会話セッション」の並行制御（同時要求1件、二重送信防止、回答後2秒制限）を実装レベルで担保する。具体的な冪等性の実現方式（識別子の構成等）はAPI設計Issueで決定する。

## 29. 匿名分析

`[確定仕様]`

`readingLevel`は匿名分析データへ含めない（NPC-NFR-009）。

## 30. CSV・JSON出力と管理者CLI

`[チーム協議]`

管理者CLI（`apps/server/cmd/npc-analytics/`、新規作成候補）から出力する。管理者CLIは公開Web APIではない。

- NPC分析データを取得する公開REST APIや公開ダウンロード画面を作らない
- エクスポートはサーバー環境で実行する管理者CLIに限定する
- CLIの利用可否はサーバー・OS・運用上のアクセス権限で管理する
- CLI自体へ独自認証を実装するかは運用方針が決まるまで確定しない（未決定事項）

コマンド名は実装時決定。

## 31. ログ

`[要確認]`

既存Loggerの実装状況が本調査で確認できなかった。実装着手時にLoggerが存在しない場合でも`fmt.Println`等へ直接依存せず、`npc`モジュール内にロガーインターフェース（最小限の抽象）を定義し、既存Loggerが整備され次第差し替え可能な設計とする。Issue番号がないため、これに関するTODOコメントはコード・文書へ追加しない。

## 32. セキュリティ

`[確定仕様]`

LLMはふりがな・ルビ・HTMLを生成しない。クライアントは`dangerouslySetInnerHTML`等の生HTML描画を行わない。プレイヤー名はLLMへ渡さない。18章のサーバー権威型検証をすべての会話関連要求に適用する。

## 33. テスト

`[NPC実装と同時に新規実装する候補]`

- Unit：ふりがな辞書アノテーターの正誤判定、`ReadingAwareText`のレベル別描画（6章のロジックどおり）、`readingLevel`と`hintLevel`の型分離、文字数検証（`text`のみ集計）、ふりがな付与率の計測、グロッサリー登録語の`reading`欠落検出、ローカル保存の不正値フォールバック・利用不可時の継続動作、`packages/ui`が`packages/game-schema`をimportしていないことの静的検証
- Integration：会話フロー全体（開始→質問→回答→終了）、複数プレイヤー異なる`readingLevel`での同時会話、会話画面を開いたままの`readingLevel`切替でLLM再実行が発生しないこと、準備→災害移行時の会話強制終了・未完了回答破棄、18章のサーバー権威型検証（会話開始・質問処理それぞれの不正条件での拒否）、LLM障害時に登録済み基本回答が表示されること、ゲームセッション終了後の出典参照情報（`sourceId`）の破棄、偽装した`playerId`を含む要求の拒否、非同期回答の対応付けと古い回答の破棄

具体的な通信イベント・ペイロードを前提とするテスト（例：特定のイベント名を送受信するテスト）は、API設計Issueで通信方式が確定してから実装する。

## 34. 環境変数

`[チーム協議]`

`docs/npc/dialogue-ai-design.md`の案を踏襲。`readingLevel`はローカル保存のみのため環境変数は不要。

## 35. 新規作成・変更予定ファイル

### 確定している新規作成ファイル（API設計に依存しない）

```text
apps/server/internal/npc/domain/*.go
apps/server/internal/npc/application/*.go
apps/server/internal/npc/infrastructure/*.go
apps/server/internal/npc/module.go

apps/web/src/features/npc/components/*
apps/web/src/features/npc/hooks/*
apps/web/src/features/npc/services/*
apps/web/src/features/npc/types/*
apps/web/src/features/npc/index.ts

packages/ui/package.json
packages/ui/src/ReadingAwareText/*

packages/game-data/npc/npc-definitions.json
packages/game-data/npc/npc-knowledge.json
packages/game-data/npc/npc-questions.json
packages/game-data/npc/npc-fallback-responses.json
packages/game-data/npc/npc-glossary.json

apps/web/src/services/storage/readingLevelStorage.ts

apps/server/cmd/npc-analytics/main.go
```

`apps/server/internal/npc/presentation/*.go`（通信ハンドラの実装）は、下記のとおりAPI設計Issue確定後に着手する。

### API設計Issueで決定する変更候補（通信方式確定後）

```text
apps/server/internal/npc/presentation/*.go（通信ハンドラの具体実装）
packages/game-schema/websocket/client-events.ts（またはAPI設計Issueが選定する通信方式に応じた同等ファイル）
packages/game-schema/websocket/server-events.ts（同上）
packages/game-schema/websocket/payloads.ts（同上）
packages/game-schema/common/furigana-segment.ts（通信データとしての型。8章のReadingAwareSegmentとの対応関係を含めAPI設計Issueで決定）
```

### 変更が必要な既存ファイルの候補（統合時の変更候補、正確な要否は実装着手時に確認）

| ファイル | 現状の区分 | 変更候補の理由 |
|---|---|---|
| `apps/web/src/App.tsx` | `[既存実装]`（最小限） | NPC会話UI・よみやすさ設定メニューのルーティング/マウント統合 |
| `apps/web/src/main.tsx` | `[既存実装]`（最小限） | 新規Provider（設定状態など）の追加 |
| `apps/web/src/stores/gameStore.ts` | `[既存の空スタブ]` | フェーズ等、NPC機能が参照する状態の実装 |
| `apps/web/src/stores/playerStore.ts` | `[既存の空スタブ]` | プレイヤー状態の実装 |
| `apps/server/internal/game/state/world_state.go` | `[既存の空スタブ]` | 災害中応答に必要な浸水状態フィールドの実装（3章の前提Issueに該当する可能性） |
| `apps/server/cmd/game/main.go` | `[既存実装]`（ヘルスチェックのみ） | `npc`モジュールのDI配線。通信ハンドラ登録はAPI設計Issue確定後 |
| `packages/game-data/scenarios/*.json` | 一部空 | シナリオ単位のNPC有効/無効フラグ追加 |
| `packages/game-schema/package.json`またはエクスポート定義 | `[既存実装]`（内容未確認） | API設計Issueで決定する新規型の公開設定変更 |
| `pnpm-workspace.yaml` | `[既存実装]`（内容未確認） | `packages/ui`の新規`package.json`がワークスペース定義に含まれるか要確認 |

**制約の整理**：「既存docsを変更しない」制約は`docs/npc/`以外の既存docsに限定され、既存コードの変更を禁止するものではない。今回の制約は、(1) `docs/npc/`以外の既存docsを変更しない、(2) 既存コードはNPC統合に必要な最小限の変更を許容する、(3) ユーザーの既存変更を上書き・破棄しない、の3点である。

## 36. 実装分割

`[チーム協議]`

本書はコード変更を伴わない。API・通信方式に関わる実装（`presentation`層、`packages/game-schema`へのNPC関連ファイル追加等）は、API設計Issueが承認されるまで着手しない。それ以外（`domain`・`application`層のロジック、マスターデータ、`ReadingAwareText`等の表示コンポーネント）は、3章の前提Issue（game/state・game/tick・game/session・game/realtime）の状況を踏まえ、[`claude-code-implementation-guide.md`](../agent/claude-code-implementation-guide.md)（AI Agent 向け実装ガイド、`docs/agent/`で管理）の段階的調査プロセスに従ってユーザー承認後に決定する。

## 37. 未決定事項・実装前確認事項

マルチプレイでは、ゲームセッション中にチーム全体が参照した`sourceId`をサーバー側で重複排除して一時保持する。結果画面では、その重複なし一覧から承認済み出典メタデータを表示する。プレイヤー別の質問文・回答文・参照履歴は保持しない。