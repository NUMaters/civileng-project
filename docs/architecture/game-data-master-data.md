# マスターデータ設計

`packages/game-data/` に配置する土木技術・ゲームルールのマスターデータ設計を定義する。

関連 Issue: [#17](https://github.com/NUMaters/civileng-project/issues/17), [#18](https://github.com/NUMaters/civileng-project/issues/18)

---

## 概要

ゲームバランスに関わる数値は **コード直書き禁止** とし、JSON マスターデータで管理する（[アーキテクチャ概要](./overview.md) 参照）。

| カテゴリ     | ディレクトリ  | 用途                           |
| ------------ | ------------- | ------------------------------ |
| 土木技術     | `structures/` | 建設費・建設時間・維持費・効果 |
| ゲームルール | `rules/`      | 勝敗条件・予算・フェーズ時間   |
| 災害         | `disasters/`  | 災害種別・降雨パターン（将来） |
| マップ       | `maps/`       | 対象範囲・初期カメラ・地形分類・計算グリッド参照 |
| シナリオ     | `scenarios/`  | プレイ条件の組み合わせ         |

---

## 土木技術（structures/）

### ファイル命名

```
packages/game-data/structures/<structure-id>.json
```

`<structure-id>` は kebab-case。MVP の 5 種類:

| id                 | 表示名   |
| ------------------ | -------- |
| `levee`            | 堤防     |
| `retention-basin`  | 遊水地   |
| `drainage-pump`    | 排水機場 |
| `revetment`        | 護岸     |
| `channel-dredging` | 河道掘削 |

### JSON スキーマ

```json
{
  "id": "levee",
  "displayName": "堤防",
  "description": "短い説明文",
  "constructionCost": 3500,
  "constructionTimeSeconds": 18,
  "maintenanceCostPerSecond": 3,
  "allowedTerrains": ["riverBank", "leveeLine"],
  "supportedDisasters": ["heavy-rain"],
  "effects": {
    "waterLevelReduction": 0,
    "overflowPrevention": 0.85,
    "drainageCapacity": 0,
    "bankProtection": 0.2,
    "channelCapacityIncrease": 0
  },
  "role": {
    "primaryHazard": "overtopping",
    "strengths": ["低岸の溢れを止める"],
    "weaknesses": ["内水・岸崩れは苦手"]
  },
  "hazardAffinity": {
    "overtopping": 1,
    "erosion": 0.3,
    "inlandPonding": 0.05,
    "capacityShortage": 0.15
  }
}
```

| フィールド                 | 型       | 説明                                  |
| -------------------------- | -------- | ------------------------------------- |
| `id`                       | string   | 技術識別子（ファイル名と一致）        |
| `displayName`              | string   | UI 表示名                             |
| `description`              | string   | 選択・配置時の短い解説                |
| `constructionCost`         | number   | 建設費（予算から即時減算）            |
| `constructionTimeSeconds`  | number   | 完成までの秒数（建設中は効果なし）    |
| `maintenanceCostPerSecond` | number   | 維持費（ゲーム中に毎秒減算）          |
| `allowedTerrains`          | string[] | 設置可能な地形タイプ                  |
| `supportedDisasters`       | string[] | 対応災害種別                          |
| `effects`                  | object   | 効果パラメータ（0.0〜1.0 の正規化値） |
| `role`                     | object   | 得意 Hazard・強み／弱みの説明         |
| `hazardAffinity`           | object   | 各 HazardKind への相性（負値は悪化）  |

### 効果パラメータ

| キー                      | 説明                     |
| ------------------------- | ------------------------ |
| `waterLevelReduction`     | 水位上昇の抑制率         |
| `overflowPrevention`      | 越水防止効果             |
| `drainageCapacity`        | 排水能力（内水氾濫対策） |
| `bankProtection`          | 河岸保護（侵食防止）     |
| `channelCapacityIncrease` | 河道容量増加             |

数値の具体値はゲームバランス調整対象（[SPR-001 人間承認](../specs/SPR-001-alpha-m1.md) 参照）。

## マップ（maps/）

`maps/koriyama/`は日本大学工学部周辺の阿武隈川を対象とし、次の情報を管理する。

| ファイル | 用途 |
| -------- | ---- |
| `metadata.json` | マップID、対象範囲、初期カメラ、使用データと出典 |
| `terrain.json` | ゲーム用地形分類または計算グリッドへの参照 |
| `objects.json` | 保護対象、河川、道路、既設施設などのゲーム用オブジェクト |

国土地理院の背景タイルそのものをリポジトリへ複製しない。加工済み標高や計算グリッドを保存する場合は、元データ、取得日、加工方法、座標系、解像度、利用条件をmetadataへ記録する。

表示用データとシミュレーション用データを分離し、CesiumJS上で見えている地形からクライアントだけで配置可否や浸水を判定しない。

---

## ゲームルール（rules/）

### victory-conditions.json

勝敗判定の閾値を定義する。

```json
{
  "clearThresholdPercent": 5,
  "failureThresholdPercent": 5,
  "description": "被災度が clearThresholdPercent 未満でクリア、以上で失敗"
}
```

[game-rules.md](../game-design/game-rules.md) の MVP 既定値（被災度 5%）に準拠。

### budget-rules.json

初期予算・時間補給・上限を定義する。

```json
{
  "initialBudgetSolo": 12000,
  "initialBudgetMultiplayerPerPlayer": 9000,
  "incomePerSecondPreparation": 80,
  "incomePerSecondDisaster": 110,
  "disasterStartGrant": 2000,
  "maxBudget": 24000,
  "description": "初期予算＋準備／災害中の補給で複数施設を置ける。維持費は毎秒差し引き、上限 maxBudget で貯めすぎを防ぐ。"
}
```

詳細な予算パラメータは [Issue #6](https://github.com/NUMaters/civileng-project/issues/6) と [game-rules.md](../game-design/game-rules.md) を参照。

### game-timing.json

1 プレイ約 90 秒（1 分半）のフェーズ配分（準備 10 / 災害 60 / 結果 20）。

```json
{
  "totalPlayTimeSeconds": 90,
  "phases": {
    "preparationSeconds": 10,
    "disasterSeconds": 60,
    "resultSeconds": 20
  }
}
```

---

## 参照方法

### server（Go）

`apps/server/internal/gamedata` が起動時に `packages/game-data/` を読み込む。パスは環境変数 `GAME_DATA_DIR`（未設定時はリポジトリ相対パスを探索）。REST では次を公開する。

- `GET /v1/game-data`
- `GET /v1/game-data/structures`
- `GET /v1/game-data/rules`

### web（TypeScript）

`@civilcraft/game-data`（`loadStructures` / `loadRules` / `loadGameData`）でビルド時に JSON を参照する。将来は API 経由取得にも切り替え可能。

---

## 関連ドキュメント

- [土木技術](../civil-engineering/techniques.md)
- [ゲームルール](../game-design/game-rules.md)
- [命名規則](../development/naming-conventions.md) — JSON は camelCase
- [地理空間アーキテクチャ](./geospatial.md)
