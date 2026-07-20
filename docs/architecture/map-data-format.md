# マップデータ形式

`packages/game-data/maps/` 配下の JSON 形式と、クライアント／サーバー／`tools/map-converter` の関係を定義する。

関連 Issue: [#80](https://github.com/NUMaters/civileng-project/issues/80)  
関連: [#15](https://github.com/NUMaters/civileng-project/issues/15) MVP マップ、[#16](https://github.com/NUMaters/civileng-project/issues/16) Client 表現基盤

---

## ディレクトリ

```
packages/game-data/maps/
└── koriyama/
    ├── metadata.json   # 地図メタ・カメラ・出典
    ├── terrain.json    # 配置域・座標系（計算グリッドは将来拡張）
    └── objects.json    # 河川・道路・既存構造物などの地物一覧
```

マップ ID は `metadata.id`（例: `koriyama-abukuma`）。サーバーの `GAME_DATA_DIR` / web の `@civilcraft/game-data` から読む。

---

## `metadata.json`

| フィールド | 型 | 必須 | 説明 |
|------------|-----|:----:|------|
| `id` | string | ○ | マップ識別子 |
| `displayName` | string | ○ | UI 表示名 |
| `bounds` | `{ west, south, east, north }` | ○ | プレイ矩形（WGS84 度） |
| `initialCamera` | object | ○ | 初期カメラ（lon/lat/heading/pitch/range） |
| `sources` | string[] | ○ | データ出典の人間可読リスト |

現行の郡山マップは日本大学工学部周辺の阿武隈川区間。bounds / initialCamera は web の `PLAY_AREA` / `INITIAL_VIEW` と整合させる。

---

## `terrain.json`

| フィールド | 型 | 必須 | 説明 |
|------------|-----|:----:|------|
| `coordinateSystem` | string | ○ | 既定 `EPSG:4326` |
| `placeableRegion` | string | ○ | 配置可能域の論理名（例: `abukuma-river-corridor`） |
| `note` | string | — | 実装メモ |

### 現行プロトタイプとの関係

- **配置判定の実装ソースオブトゥルース**は web の `abukumaRiverGeometry.ts` / `riverPlacement.ts`（中心線コリドー＋水面ポリゴン）
- `placeableRegion` はマスター上の名前で、将来サーバー検証や map-converter 出力と結びつける
- ボクセル／セルグリッド（浸水計算用）は **未確定**。追加する場合は本ファイルに `grid` オブジェクトを拡張する（例）:

```json
{
  "coordinateSystem": "EPSG:4326",
  "placeableRegion": "abukuma-river-corridor",
  "grid": {
    "cellSizeMeters": 20,
    "origin": { "lon": 140.365, "lat": 37.347 },
    "width": 128,
    "height": 160,
    "elevationUri": "relative/path/or/cdn"
  }
}
```

グリッド導入は [cesium-roadmap.md](../development/cesium-roadmap.md) §5 と #101 / #104 で進める。

---

## `objects.json`

| フィールド | 型 | 説明 |
|------------|-----|------|
| `rivers` | array | 河川。`id` / `displayName` / `source` |
| `roads` | array | 道路（MVP では空可） |
| `protectedAreas` | array | 保全区域など（MVP では空可） |
| `existingStructures` | array | 既存インフラ（MVP では空可） |

幾何本体（ポリゴン座標）はファイルサイズと更新頻度の都合で、**表示用は Cesium／OSM／PLATEAU**、**ゲーム判定用は web 内の軽量ジオメトリ**に置く。objects.json はカタログと出典の索引とする。

将来、サーバー権威の河道判定を入れる場合は `rivers[].geometryRef` または GeoJSON 断片への参照を追加する。

---

## web / server の参照

| 利用者 | 参照方法 | 使うファイル |
|--------|----------|--------------|
| web | `@civilcraft/game-data` | metadata（将来 HUD）、structures / rules が主。河道は現状コード内ジオメトリ |
| server | `GAME_DATA_DIR` + Go loader | maps を一覧・検証。配置検証は今後 `placeableRegion` とグリッドへ |
| `tools/map-converter` | 入力→ `packages/game-data/maps/<id>/` | OSM / DEM から terrain・objects を生成する想定（ツール実装は別 Issue） |

---

## 互換・変更ルール

1. フィールド追加は後方互換（未知キーは無視）
2. 破壊的変更は `metadata.formatVersion`（将来）を上げ、loader で分岐
3. 座標は常に WGS84 度。高さは楕円体高（m）を別フィールドで持つ

---

## 関連ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [geospatial.md](./geospatial.md) | Cesium・DEM・配置コリドー |
| [game-data-master-data.md](./game-data-master-data.md) | マスターデータ全体 |
| [civil-engineering/setting.md](../civil-engineering/setting.md) | 舞台設定 |
