# リサーチ照合とMVP採用範囲

確認日：2026-09-13。

ユーザー提供の [リサーチ文書](./koriyama-flood-civil-engineering-sources.md) を基に、今回表示する内容を公式ページ・PDF本文で照合した。元文書は保持し、採用する範囲と補足をここに記録する。これは外部の専門家による監修を受けたという意味ではない。

## 登録した知識

R01、R02、R03、R06、R07、T01〜T05、D01、D02の12件を登録。会話と出典データは元の `FACT-*` IDを保持する。一次資料にある全ての数値や固有の施設名をNPCへ渡すのではなく、今回の質問で必要な事実に絞った。

| Fact          | 照合箇所・採用範囲                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FACT-R01      | [郡山市洪水ハザードマップ](https://www.city.koriyama.lg.jp/soshiki/126/2177.html)本文。想定浸水の範囲・深さという意味を採用                                                |
| FACT-R02      | [1986年洪水概要](https://www.thr.mlit.go.jp/fukushima/abukuma_gensai/pdf/20161005shiryou1.pdf#page=2) PDF 2ページ（紙面1）。郡山市の支川の破堤を採用。広域の被害数は不使用 |
| FACT-R03      | [郡山市の2024年資料](https://www.city.koriyama.lg.jp/uploaded/attachment/90344.pdf#page=3)別紙2。内水等の被害の記録を採用。浸水件数・水位の数値は不使用                    |
| FACT-R06      | [国土地理院の地形説明](https://www.gsi.go.jp/bousaichiri/bousaichiri41051.html)の氾濫平野。地形の一般論のみ                                                                |
| FACT-R07      | [郡山市内水ハザードマップ](https://www.city.koriyama.lg.jp/site/jougesuidou/5632.html)本文。洪水マップと別に存在することを採用                                             |
| FACT-T01      | [国交省の堤防説明](https://www.mlit.go.jp/river/pamphlet_jirei/kasen/jiten/yougo/03_04.htm)の役割と計画高水位の条件                                                        |
| FACT-T02      | [国交省の護岸説明](https://www.mlit.go.jp/river/pamphlet_jirei/kasen/jiten/yougo/12.htm)の侵食からの保護                                                                   |
| FACT-T03・T04 | [国交省の用語集](https://www.mlit.go.jp/river/pamphlet_jirei/kasen/jiten/yougo/05_06.htm)の遊水地・調節池・排水機場。貯留と排水の役割の違い                                |
| FACT-T05      | [国交省の河道計画資料](https://www.mlit.go.jp/river/bousai/hukkyu/shinsei/4/kadou_02.html)の土砂堆積箇所の維持掘削と安易な掘下げの問題                                     |
| FACT-D01      | [川の防災情報](https://www.river.go.jp/)の水位・雨量等の提供項目                                                                                                           |
| FACT-D02      | [内閣府ガイドライン案内](https://www.bousai.go.jp/oukyu/hinanjouhou/r3_hinanjouhou_guideline/)の警戒レベル一覧と避難行動。2026年3月改定ページとして記録                    |

## 照合で分かった補足

- FACT-R07：ゲリラ豪雨版の内水ハザードマップの想定は **74mm/h**。同じページで案内する2026年3月31日公表の **雨水出水浸水想定区域図は120mm/h**。別の地図・条件として区別する。MVP回答にはこれらの数値を入れない。
- FACT-T05：「拡幅を基本とする」という説明は災害復旧の河道計画の文脈。全ての河川で掘削が禁止されるという意味にはしない。
- FACT-R02：PDFファイルのページ番号と紙面番号が1ページずれるため、双方を記録した。
- NPCは架空の住民。1986年・1998年の水害をNPC本人が体験したことにはせず、「記録」として話す。
- FACT-T03の浜尾遊水地の実在事例、FACT-T04の実在排水機場の能力・運転条件は、今回の質問に不要なため渡さない。

## 今回登録しなかった情報

- FACT-R04：参照ページで「平成の大改修」は確認できるが、リサーチにある愛宕川の具体的対策は同ページ本文だけでは確認できなかった。今回の3問構成では不使用。
- FACT-R05：今回の質問に使用しない。「約54ha・約2%」を含む図表の個別検証を完了したとは扱わない。
- FACT-C01：ゲーム座標とのGIS照合をしていないため不使用。NPC位置を氾濫平野・旧河道等と断定しない。

この採用範囲は `npc-catalog.json` の `knowledge` と `sources` に対応する。各ヒントの文言は同じ事実を表す複数候補として管理し、Ollamaがその中から選択する。
