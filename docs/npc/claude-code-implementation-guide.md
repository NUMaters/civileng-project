# CivilCraft NPC 機能 — Claude Code 実装ガイド

## 文書の状態

- 状態：実装未承認
- 対象：[`overview.md`](./overview.md)・[`requirements.md`](./requirements.md)・[`detailed-design.md`](./detailed-design.md)・[`dialogue-ai-design.md`](./dialogue-ai-design.md) で定義した住民 NPC、およびよみやすさ設定（readingLevel）
- 実装開始条件：`requirements.md`・`detailed-design.md`・`dialogue-ai-design.md` と、Claude Code の読み取り専用調査計画をユーザーが承認すること
- 本書は「実装承認済み」「実装開始可能」の状態ではない。実装着手には、本書に従った段階的調査の結果をユーザーが承認する必要がある

この文書は、Claude Code が会話履歴を参照できない状況でも、`docs/npc/`の設計文書を参照し、必要最小限の調査と実装計画を作成できるようにするための指示書である。各設計文書の承認状態は、その文書の「文書の状態」とユーザーの最新指示を正本とし、Claude Codeが独自に承認済みと判断してはならない。

---

## 最重要ルール

1. **既存の `docs/` 文書を変更しない**
2. NPC 文書の追加・修正は `docs/npc/` 内だけで行う
3. 最初のターンは読み取り専用調査と実装計画の提示だけを行う
4. ユーザーが計画を承認するまでコード・設定・依存関係・DBを変更しない
5. AI ディレクターは実装しない
6. NPC に災害イベント、難易度、施設配置を制御させない
7. `.env`、APIキー、秘密情報を表示・読み上げ・コミットしない
8. ユーザーの既存変更を上書き・破棄しない
9. Issue 番号なしの `TODO` を追加しない
10. NPC 機能を無効にした場合、既存ゲームの動作を変えない
11. **NPCのAPI・通信方式（WebSocketイベント名、エンドポイント、ペイロード、TypeScript型、Goの通信DTO、`status`・`reasonCode`等の列挙値、`packages/game-schema`への追加ファイルを含む）は、別のAPI設計Issueが承認されるまで実装しない。** `requirements.md`・`detailed-design.md`が確定しているのは、ユーザーから見た挙動とサーバー権威型検証の要件であり、通信の具体設計ではない（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）

---

## Claude Code の読み取り調査は3段階で行う

一度にすべてのファイルを全文読み込まない。以下の3段階に分けて、各段階の範囲だけを読む。

### 段階0：最小確認

`rg`が利用できないPowerShell環境では、次を使用する。

```powershell
Get-ChildItem .\docs\npc\requirements.md,.\docs\npc\detailed-design.md,.\docs\npc\dialogue-ai-design.md | Select-String -Encoding UTF8 -Pattern '^#{1,3} '
```

全文を読むもの：

- リポジトリルートの`CLAUDE.md`・`AGENTS.md`（存在するものだけ）
- `docs/npc/overview.md`
- `docs/npc/claude-code-implementation-guide.md`

見出し一覧だけを確認し、本文はまだ読まないもの：

- `docs/npc/requirements.md`
- `docs/npc/detailed-design.md`
- `docs/npc/dialogue-ai-design.md`

見出し確認には、全文表示ではなく、次のような見出し検索を使用する。

```text
rg -n '^#{1,3} ' docs/npc/requirements.md docs/npc/detailed-design.md docs/npc/dialogue-ai-design.md
```

リポジトリについて確認するもの：

- `git status`
- 現在のブランチ
- ディレクトリ構成・ファイル一覧（内容は読まない）
- 使用言語・ワークスペースを判断するためのマニフェスト名

段階0では、`requirements.md`・`detailed-design.md`・`dialogue-ai-design.md`の全文、他の既存docs、ソースコード本文を一括で読み込まない。

### 段階1：対象選定調査

- 最初に、今回対象とするIssueまたは実装単位を確認する
- 対象Issueに関係する`requirements.md`・`detailed-design.md`・`dialogue-ai-design.md`の章を、見出し名で列挙する
- 章を読む理由と、読まない章を示す
- ユーザーが承認した章だけを読む
- 実装対象（承認されたIssueまたは実装単位）に必要な既存docsと代表ソースファイルを先に列挙する
- 各ファイルを読む理由を一覧で説明してからユーザーへ提示する
- 同種のファイルを大量に読まない（代表例を数点に絞る）
- ユーザーが承認した範囲だけを読む
- 調査の過程で追加のファイルが必要になった場合、読む前に理由を報告する

対象選定調査で確認する観点の例（実装単位に応じて必要なものだけを選ぶ）：

- リポジトリ状態：現在のブランチ、`git status`、既存のユーザー変更、モノレポ・ワークスペース構成、ビルド・Lint・テストコマンド、Docker・DB・Redis・Ollama の起動方法
- フロントエンド：Three.js／3D ワールドの構成、プレイヤー座標・接近判定、施設配置と入力制御、ゲームフェーズ・タイマーの管理、WebSocket クライアント、UI コンポーネント・状態管理、マップデータと 3D アセットの形式
- バックエンド：モジュール・依存方向、ゲームセッション・プレイヤー・フェーズ・Tick、WebSocket ルーター・イベント配信、マップ・災害・浸水状態、マスターデータのローダーと検証、PostgreSQL・Redis・マイグレーション、Logger・設定・CLI コマンド、テスト用モック・Integration Test 基盤
- AI・RAG：既存 AI／LLM 接続コードの有無、Ollama 接続方法の候補、既存 HTTP クライアント・設定方式、embeddings／vector search の既存実装、PostgreSQL に `pgvector` を追加できるか、簡易検索で初期要件を満たせるか

対象選定調査で候補になりうる既存docsの例（実装単位に応じて必要なものだけを選ぶ。すべてを毎回読むわけではない）：

```text
docs/game-design/overview.md
docs/game-design/game-rules.md
docs/game-design/session-flow.md
docs/game-design/ui-controls.md
docs/civil-engineering/setting.md
docs/civil-engineering/techniques.md
docs/civil-engineering/disasters.md
docs/architecture/overview.md
docs/architecture/communication.md
docs/architecture/dependency-rules.md
docs/architecture/directory-rules.md
docs/architecture/package-structure.md
docs/architecture/tech-stack.md
docs/api/rest-naming.md
docs/api/websocket-naming.md
docs/agent/guide.md
docs/development/principles.md
docs/development/development-rules.md
docs/development/naming-conventions.md
docs/development/coding-standards-go.md
docs/development/coding-standards-typescript.md
docs/development/comments.md
docs/development/error-handling.md
docs/development/logging.md
docs/development/testing.md
docs/development/review-criteria.md
docs/development/ai-usage.md
docs/development/issue-management.md
docs/development/todo-rules.md
docs/git/branch-strategy.md
docs/git/commit-message.md
docs/git/pull-request.md
```

秘密情報を含む可能性があるファイルは内容を出力しない。

### 実装段階

- 承認されたIssueまたは実装単位に必要なファイルだけを読む
- 一度に全NPC機能を実装しない。`requirements.md`・`detailed-design.md`の分割方針に従い、承認された単位ごとに実装する
- 各段階で、変更したファイル一覧・追加したテスト・動作確認結果をユーザーへ報告する
- 次の段階へ進む前に、必ずユーザーの承認を待つ

---

## 変更禁止範囲

### 文書

ユーザーの明示的な再承認がない限り、次を含む既存文書を変更しない。

```text
docs/agent/
docs/api/
docs/architecture/
docs/civil-engineering/
docs/development/
docs/game-design/
docs/git/
```

`docs/npc/` だけが NPC 文書の変更可能範囲である。

### 機能

次は今回の実装範囲外である。

- AI ディレクター
- 災害の強度・発生タイミングの自動調整
- 津波・地震など既存コア外の災害
- NPC の移動・経路探索・避難
- NPC による施設配置
- 音声・音声合成
- 3D 表情アニメーション
- NPC 会話共有ボタン
- NPC 会話の永続記憶
- LLM による災害中の文章生成
- 実行時 Web 検索
- 複数クラウド LLM の自動フェイルオーバー
- 認証なしの分析データ公開 API
- 質問・回答本文の保存
- NPC 利用によるスコア加点・減点
- 具体的な最適配置の回答

---

## 読み取り専用調査後に提出する計画

NPC機能の要件・統合設計・RAG/LLM専門設計は、`requirements.md`・`detailed-design.md`・`dialogue-ai-design.md`に文書化されている。これらを確定仕様として扱えるのは、各文書の状態がユーザー承認済みとなった後に限る。API・通信方式（イベント名、ペイロード、型、DTO等）は別Issueで扱い、API設計Issueが承認されるまで実装しない（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）。本節は、承認された実装単位ごとの計画提出フォーマットとして用いる。コード変更前に、次の形式でユーザーへ提示する。

### 1. 現状整理

- NPC 実装に利用できる既存機能
- 不足している機能
- 既存仕様との競合
- ユーザーの未コミット変更への影響

### 2. 推奨アーキテクチャ

- フロントエンド配置
- バックエンド配置
- モジュール間の依存方向
- マスターデータ構成
- 会話セッション管理
- Ollama 接続
- RAG検索基盤
- 匿名分析データ
- CLI エクスポート

### 3. 代替案と判断理由

特に RAG 検索基盤について、次を比較する。

- PostgreSQL＋pgvector
- 小規模実証向け簡易検索
- 外部ベクトル DB

追加依存関係、起動手順、テスト容易性、1〜4 人での実証、5〜50 人への拡張性を比較し、1案を推奨する。

### 4. 実装分割

Claude Code がリポジトリ構造を踏まえて分割を提案する。各段階について次を示す。

- 目的
- 変更ファイル
- 新規ファイル
- DB・設定変更
- テスト
- 動作確認手順
- ロールバック可能な境界

### 5. 未決定事項

全体の未決定事項一覧は [`requirements.md`](./requirements.md#23-未決定事項実装前確認事項) を正本とする。当該実装単位に固有の新たな未決定事項があれば、ここに追加で提示する。

- チーム判断が必要な項目
- 実装を止める項目
- 仮値で進められる項目
- Issue を作成すべき項目

### 6. リスク

- ゲーム Tick への影響
- LLM 応答遅延
- GPU メモリ
- 同時質問要求の処理
- LLM の根拠外回答
- 個人情報・子どもの自由入力
- 分析データの保存期間
- NPC 無効時の既存ゲームへの影響

この計画を提示した時点で停止し、ユーザーの承認を待つ。

---

## 実装時に満たす機能

実装時に満たすべき機能要件・非機能要件・受け入れ条件は [`requirements.md`](./requirements.md) を正本とする。統合構成・状態遷移・サーバー権威型検証は [`detailed-design.md`](./detailed-design.md) を、RAG・LLM・知識データ・グロッサリー・安全性・匿名分析の専門設計は [`dialogue-ai-design.md`](./dialogue-ai-design.md) を参照する。**通信イベント・ペイロード・型定義は、別のAPI設計Issueで決定するまで未確定である**（[`detailed-design.md`](./detailed-design.md#19-api設計issueへの引き継ぎ条件)）。本書では、これらの正本と重複する要件一覧を保持しない。

---

## データ作成時の承認ゲート

Claude Code が次の仮データを提案したら、ファイルへ確定する前にユーザーへ提示する。

- NPC の名前
- 職業
- 性格
- 自己紹介
- 質問候補 3 件
- 段階ヒント
- 基本回答
- 技術用語グロッサリー（土木用語・地名・NPC が頻繁に使う語の読み）

地域・災害知識は、公的資料から作成し、次を提示する。

- 元資料
- 出典 URL
- 対象地点
- 元資料から読み取れる事実
- 小学校高学年向けの簡略化案
- 対応シナリオ・NPC・テーマ・ヒントレベル

ユーザーまたは担当者の承認前に `approved = true` にしない。LLM が生成した未確認の地域情報を使用しない。

---

## テスト・完了条件

### 必須テスト

- 変更した Go／TypeScript の Unit Test
- NPC 出現・非出現
- 会話開始・終了
- 接近距離と施設配置禁止
- 質問候補と自由入力
- 段階ヒント
- 検索フィルター
- LLM 出力検証
- タイムアウト・フォールバック
- フェーズ変更中の未完了要求
- 複数プレイヤー同時会話
- 災害中の状態・感情定型文
- 匿名分析イベント
- CSV・JSON 出力
- NPC無効時の回帰テスト

### 完了条件

- Linter、Formatter、Build、Unit Test が成功する
- 重要処理の Integration Test が成功する
- 1〜4 人相当の同時会話でゲーム Tick が止まらない
- 5 秒以内に回答またはフォールバックを表示する
- NPC が根拠外の情報を表示しない
- 会話本文がサーバー・ブラウザのログへ残らない
- NPC を無効にすると既存ゲームの画面・通信・結果が変わらない
- 既存 `docs/` が変更されていない
- 変更一覧と動作確認結果をユーザーへ提示する

---

## Issue・ブランチ

既存規約に従い、実装前に Issue を作成する。Issue 番号決定後の例：

```text
feature/<issue番号>-npc-dialogue
```

実装分割が複数 Issue になる場合は、Claude Code の調査計画で提案し、ユーザーとチームが決定する。

Issue 番号がない状態でブランチ作成や `TODO` コメント追加を行わない。

---

## Claude Code へ最初に渡すプロンプト

Claude Codeは設計文書の承認状態を独自に推測せず、段階0では概要・実装ガイドと各設計文書の見出しだけを確認する。その後、対象Issueに必要な章を提示し、ユーザー承認後に段階1の読み取りへ進む。

```text
CivilCraft に、docs/npc/で定義された「地域情報提供型・住民NPC」機能（およびよみやすさ設定）を追加する予定です。

このターンでは実装・編集・依存関係追加・DB変更を一切行わず、読み取り専用の調査と実装計画の提示だけを行ってください。計画提示後は、私が明示的に承認するまで停止してください。

段階0として、次だけを確認してください。

全文を読んでよいもの：
- リポジトリルートのCLAUDE.md・AGENTS.md（存在するものだけ）
- docs/npc/overview.md
- docs/npc/claude-code-implementation-guide.md

見出し一覧だけを確認し、本文をまだ読まないもの：
- docs/npc/requirements.md
- docs/npc/detailed-design.md
- docs/npc/dialogue-ai-design.md

リポジトリについて確認するもの：
- git status
- 現在のブランチ
- ディレクトリ構成・ファイル一覧
- package.json・go.mod等のマニフェスト名

続いて段階1として、今回対象とするIssueまたは実装単位に必要な章と既存ファイルを、理由付きで一覧化してください。まだ本文は読まず、私の承認を待ってください。私が承認した章とファイルだけを読んでください。

重要な禁止事項：
- docs/npc/ 以外の既存docsを変更しない
- AIディレクターを実装しない
- NPCに災害難易度・災害イベント・施設配置を制御させない
- .env、APIキー、秘密情報を表示・コミットしない
- 私の既存変更を破棄しない
- Issue番号なしのTODOを追加しない
- 承認前にコードを変更しない

調査結果として、次を提示してください。
1. 今回の実装単位に関する現在のアーキテクチャの状況（既存実装／既存の空スタブ／前提Issue の区別を含む）
2. 既存ゲームへの影響範囲
3. 新規作成・変更が必要なファイル一覧（理由付き、requirements.md・detailed-design.mdとの対応を含む）
4. 実行するUnit Test・Integration Test・動作確認計画
5. 今回の実装単位に固有の未決定事項（全体の未決定事項はrequirements.mdを参照）
6. 実装リスクと回避策

NPCの名前・性格・自己紹介・質問候補、公的資料から作る簡略化知識、技術用語グロッサリーは仮案として提示してください。私が承認するまでは本番用マスターデータとして確定しないでください。

実装計画を提示したら停止し、承認を待ってください。
```

---

## 計画承認後の実装プロンプトに含める内容

計画承認後は、Claude Code が提示した実装分割のうち、承認した段階だけを指定する。プロンプトには次を含める。

- 対象 Issue 番号
- 対象ブランチ
- 今回実装する段階
- 承認済みファイル一覧
- 承認済み NPC データ
- 承認済み知識データ
- 採用した検索基盤
- 使用する Ollama 接続設定名
- 実行すべきテスト
- 今回実装しない項目
- 完了時の報告形式

一度に全機能を実装させず、Claude Code の調査結果とユーザー承認に基づいて安全な単位に分割する。

---

## チーム協議事項

全体の未決定事項・実装前確認事項は [`requirements.md`](./requirements.md#23-未決定事項実装前確認事項) を正本とする。次は実装前または実験前に Issue 化する。

- NPC 数・位置（マップ確定後）
- NPC 名・性格・質問候補（Claude Code 仮案のユーザー確認後）
- 知識作成・監修担当、技術用語グロッサリー作成（チーム協議後）
- 簡略化した公的情報（人間レビュー後）
- RAG 検索基盤（DB・コード調査後）
- Ollama モデル（GPU 上の日本語品質・速度試験後）
- 匿名データ保存期間（実験・運用方針の協議後）
- 研究利用時の説明・同意（実験実施前）
- 5〜50 人向けクラウド LLM（将来負荷試験後）