# CivilCraft Web

CivilCraft のブラウザ向けフロントエンドです。現段階では、CesiumJS 上に福島県郡山市の地形・航空写真・PLATEAU 3D 都市モデルを表示し、指定した河川区間に沿った帯状エリアだけを表示・操作対象にしています。

## 現在の実装範囲

- 郡山市の PLATEAU 建築物 LOD1（3D Tiles）表示
- PLATEAU-Terrain の表示
- 国土地理院の航空写真表示
- 国土地理院の河川中心線から、開始地点と終了地点の間の河川経路を抽出
- 河川経路の左右へ指定距離を広げた帯状プレイエリアの生成
- 地形・航空写真・PLATEAU 建築物のプレイエリア外をクリッピング
- カメラの移動中心をプレイエリア内へ制限
- マウス・タッチ・ピンチ操作による移動、回転、傾斜、ズーム
- 河川区間中央へ視点を戻すボタン
- 読み込み中、地形フォールバック、致命的エラーの画面表示
- PC・スマートフォン向けレイアウトと Safe Area 対応

次の機能はまだ実装していません。

- 洪水・浸水シミュレーション
- 治水工事オブジェクトの配置
- タップ位置の取得と設置判定
- ユーザーアカウント、ルーム、データ保存
- ゲーム進行、予算、スコア、ステージ選択

`src/features/` や `src/game/` の一部には将来機能向けのスキャフォールドがありますが、現在の画面には接続されていません。

## 使用技術

| 用途 | 技術 |
|---|---|
| UI | React, TypeScript |
| 開発・ビルド | Vite |
| 3D 地図 | CesiumJS |
| 河川帯ポリゴン生成 | Turf |
| テスト | Vitest |
| 静的解析 | ESLint, TypeScript |

Cesium の Worker、Assets、Widgets は `vite-plugin-cesium` を通して開発環境と本番ビルドへ配置します。Cesium ion のアクセストークンは使用していません。

## セットアップ

Node.js と npm を用意し、リポジトリルートから次を実行します。

```bash
cd apps/web
npm install
npm run dev
```

Vite が表示したローカル URL をブラウザで開いてください。地形、航空写真、河川中心線、3D Tiles は外部サーバーから取得するため、起動後もインターネット接続が必要です。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | Vite 開発サーバーを起動 |
| `npm run build` | TypeScript の型チェック後、`dist/`へ本番ビルドを生成 |
| `npm run typecheck` | TypeScript の型チェック |
| `npm run lint` | ESLint を実行 |
| `npm run test` | Vitest の単体テストを実行 |

変更後は、最低限次の確認を行ってください。

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## 地図データ

| データ | URL |
|---|---|
| PLATEAU 郡山市建築物 LOD1 | `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/07203-bldg-lod1-latest/tileset.json` |
| PLATEAU-Terrain | `https://tile.plateauview.mlit.go.jp/terrain` |
| 国土地理院 航空写真 | `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` |
| 国土地理院 河川中心線 | `https://cyberjapandata.gsi.go.jp/xyz/experimental_rvrcl/{z}/{x}/{y}.geojson` |

画面には Cesium 標準のクレジット表示に加えて、PLATEAU、PLATEAU-Terrain、Mapterhorn、国土地理院の帰属を表示します。各データを利用・公開する場合は、それぞれの提供元の利用条件も確認してください。

## 河川プレイエリアの設定

設定ファイルは、リポジトリルートの次の場所にあります。

```text
packages/game-data/maps/koriyama/play-area.json
```

設定例：

```json
{
  "riverName": "阿武隈川",
  "sourceUrl": "https://cyberjapandata.gsi.go.jp/xyz/experimental_rvrcl/{z}/{x}/{y}.geojson",
  "zoomLevel": 16,
  "start": {
    "longitude": 140.384702,
    "latitude": 37.371227
  },
  "end": {
    "longitude": 140.376369,
    "latitude": 37.34183
  },
  "leftWidthMeters": 2000,
  "rightWidthMeters": 2000,
  "searchPaddingMeters": 1000,
  "maximumConnectionGapMeters": 250
}
```

| パラメーター | 内容 |
|---|---|
| `riverName` | 管理用の河川名。河川データの絞り込みには使用しない |
| `sourceUrl` | 河川中心線タイルの URL テンプレート |
| `zoomLevel` | 取得する河川中心線タイルのズームレベル。現在のデータでは `16`を使用 |
| `start` | 河川区間の開始地点。WGS84 の経度・緯度 |
| `end` | 河川区間の終了地点。WGS84 の経度・緯度 |
| `leftWidthMeters` | 開始地点から終了地点を向いたとき、左側へ広げる距離 |
| `rightWidthMeters` | 開始地点から終了地点を向いたとき、右側へ広げる距離 |
| `searchPaddingMeters` | 河川データを検索する矩形範囲の余白 |
| `maximumConnectionGapMeters` | 分割された河川線を接続可能とみなす最大距離 |

開始地点と終了地点は、同じ河川の中心線付近に指定してください。指定座標は最寄りの河川中心線へ吸着され、その間の最短経路を対象区間として使用します。

開始地点と終了地点を逆にすると左右の基準も逆になります。`searchPaddingMeters` や `maximumConnectionGapMeters` を大きくしすぎると、近接する支流や別の水路へ接続する可能性があります。

## 処理の流れ

```text
play-area.json
  ↓
周辺の河川中心線 GeoJSON タイルを取得
  ↓
開始・終了地点を最寄りの河川ノードへ吸着
  ↓
河川ネットワーク上の最短経路を抽出
  ↓
左右幅を反映した帯状ポリゴンを生成・簡略化
  ↓
Globe と PLATEAU 3D Tiles に同じクリッピング範囲を適用
  ↓
カメラの画面中心をポリゴン内へ制限
```

## 主なディレクトリ

```text
apps/web/
├── public/                         # 静的ファイル
├── src/
│   ├── app/                        # React アプリケーション入口
│   ├── components/KoriyamaMap/     # 地図UI、状態表示、スタイル
│   ├── features/                   # ユーザー機能単位の処理
│   ├── game/map/                   # Cesium制御、河川経路、性能設定
│   ├── stores/                     # 状態管理用スキャフォールド
│   └── styles/                     # グローバルスタイル
├── vite.config.ts                  # React・Cesiumビルド設定
└── package.json
```

主要ファイル：

- `src/components/KoriyamaMap/KoriyamaMap.tsx` — React UI と読み込み・エラー状態
- `src/game/map/KoriyamaMapController.ts` — Cesium 初期化、データ読み込み、クリッピング、カメラ制約
- `src/game/map/riverPlayArea.ts` — 河川タイル取得、経路探索、帯状ポリゴン生成、範囲内判定
- `src/game/map/cesiumPerformance.ts` — PC・モバイル別の描画設定
- `vite.config.ts` — Cesium アセットを含む Vite 設定

## エラー処理

- PLATEAU-Terrain の取得に失敗した場合は、楕円体地形へフォールバックして建物表示を継続します。
- 河川中心線、PLATEAU 3D Tiles、Cesium 初期化の失敗は致命的エラーとして画面に表示します。
- WebGL を利用できない場合は、地図の代わりにエラー表示を出します。
- 詳細なエラーはブラウザの開発者コンソールへ出力します。

## 既知の制約

- Cesium のポリゴンクリッピングには WebGL 2 が必要です。
- 国土地理院の河川中心線は試験提供データであり、属性の河川名が空の場合があります。そのため、現在は座標で河川を指定します。
- 画面上ではプレイエリア外を非表示にしますが、元の地形・画像・3D Tiles は正方形タイル単位です。表示範囲に交差するタイルの通信まで完全に除外するものではありません。
- 開始・終了地点を大きく離すと、取得対象タイル数と経路探索コストが増加します。検索範囲が内部上限を超えた場合はエラーになります。
- 現在は外部河川タイルを起動時に解析します。安定運用やオフライン利用が必要になった場合は、生成済みプレイエリアを静的データとして配布する構成を検討してください。

## トラブルシューティング

### 河川経路が見つからない

- 開始・終了座標が同じ河川付近にあるか確認する
- `searchPaddingMeters` を少し広げる
- データの短い欠損がある場合のみ `maximumConnectionGapMeters` を少し広げる
- 近くに支流がある場合は、開始・終了座標を目的の本流へ近づける

### 地形だけ平坦になる

PLATEAU-Terrain の取得に失敗すると楕円体地形へフォールバックします。ネットワークとブラウザコンソールを確認してください。

### 画面に初期化エラーが表示される

WebGL 2 が有効か、外部データURLへ接続できるか、ブラウザコンソールに CORS・通信・WebGL エラーがないか確認してください。

## 関連ドキュメント

- [プロジェクト全体の README](../../README.md)
- [ゲーム概要](../../docs/game-design/overview.md)
- [アーキテクチャ概要](../../docs/architecture/overview.md)
- [開発ガイド](../../docs/agent/guide.md)
