# 命名規則

## Repository

```
civilcraft
```

すべて小文字、kebab-case。

## Directory

バックエンドモジュール名は [アーキテクチャ概要](../architecture/overview.md) に準拠する。

```
player
room
game
world
construction
disaster
simulation
mapdata
```

MVP 対象外の将来拡張用モジュール（導入方針は [Issue #13](https://github.com/NUMaters/civileng-project/issues/13) 参照）：

```
auth
```

Go は小文字のみ。TypeScript も小文字推奨。

## ファイル名

**Go** — snake_case

```
room_manager.go
game_state.go
player_repository.go
```

**TypeScript** — PascalCase（コンポーネント・クラス）、camelCase（Hook）

```
RoomManager.ts
GameCanvas.tsx
useGameSocket.ts
```

## クラス

PascalCase

```
RoomManager
FloodSimulation
Player
```

## Interface

PascalCase。接頭辞 `I` は禁止。

```
RoomRepository
PlayerStore
SimulationEngine
```

禁止例:

```
IPlayer
IRoom
```

## 関数

camelCase

```
createRoom()
calculateWaterLevel()
placeConstruction()
```

## 変数

camelCase

```
playerCount
waterLevel
currentTick
```

## 定数

UPPER_SNAKE_CASE

```
MAX_ROOM_SIZE
GAME_TICK_RATE
MAX_BUILD_DISTANCE
```

## Enum

型名は PascalCase、値も PascalCase

```
ConstructionType
DisasterType

Levee
River
Flood
```

## JSON

snake_case 禁止。camelCase を使用する。

```json
{
  "roomId": "...",
  "playerId": "...",
  "waterLevel": 25
}
```
