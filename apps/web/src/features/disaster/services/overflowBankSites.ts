import { ABUKUMA_RIVER_CENTERLINE } from "../../../components/GameCanvas/abukumaRiverGeometry";
import type { HazardKind } from "@civilcraft/game-data/types";

export type { HazardKind };

export type OverflowCandidate = {
  id: string;
  longitude: number;
  latitude: number;
  outflowHeadingDegrees: number;
  /**
   * 相対的な岸の高さ（m）。低いほど越水しやすい。
   * DEM 取得前は教育用の初期値。取得後は実標高で上書きされる。
   */
  bankElevationMeters: number;
  /** 湾曲・歴史的弱点などの基礎係数。 */
  structuralVulnerability: number;
  /** この地点で主に発生する災害・弱点の種類。 */
  primaryHazard: HazardKind;
};

/**
 * キャンパス周辺の既知弱点（中心線から右岸＝市街地方向へ約 55 m）。
 * 配置可能コリドー内に置き、河岸での防護が意味を持つようにする。
 */
const MANUAL_CANDIDATES: OverflowCandidate[] = [
  {
    id: "campus-south",
    longitude: 140.37492,
    latitude: 37.357985,
    outflowHeadingDegrees: 156,
    bankElevationMeters: 19.2,
    structuralVulnerability: 1.05,
    primaryHazard: "overtopping",
  },
  {
    id: "campus-core",
    longitude: 140.37776,
    latitude: 37.359853,
    outflowHeadingDegrees: 141,
    bankElevationMeters: 18.4,
    structuralVulnerability: 1.25,
    primaryHazard: "overtopping",
  },
  {
    id: "campus-north",
    longitude: 140.38349,
    latitude: 37.364066,
    outflowHeadingDegrees: 129,
    bankElevationMeters: 20.1,
    structuralVulnerability: 0.95,
    primaryHazard: "overtopping",
  },
  {
    id: "mid-east",
    longitude: 140.3725,
    latitude: 37.356392,
    outflowHeadingDegrees: 120,
    bankElevationMeters: 19.8,
    structuralVulnerability: 0.85,
    primaryHazard: "overtopping",
  },
  {
    id: "north-bend",
    longitude: 140.385275,
    latitude: 37.371045,
    outflowHeadingDegrees: 111,
    bankElevationMeters: 21.2,
    structuralVulnerability: 0.8,
    primaryHazard: "erosion",
  },
  // 市街地側の内水点（越水後に水が溜まる想定）。排水機場の主な対象。
  {
    id: "inland-campus",
    longitude: 140.3791,
    latitude: 37.36035,
    outflowHeadingDegrees: 141,
    bankElevationMeters: 17.8,
    structuralVulnerability: 1.1,
    primaryHazard: "inlandPonding",
  },
  {
    id: "inland-south",
    longitude: 140.3762,
    latitude: 37.3584,
    outflowHeadingDegrees: 150,
    bankElevationMeters: 18.1,
    structuralVulnerability: 0.95,
    primaryHazard: "inlandPonding",
  },
];

/** DEM で上書きされた標高（id → m）。 */
const terrainElevationOverrides = new Map<string, number>();

/**
 * 中心線から右岸（市街地方向）へ約 52 m オフセットした追加弱点候補。
 * 湾曲部は侵食、直線低岸は越水として分類する。
 */
function buildSampledBankCandidates(): OverflowCandidate[] {
  const samples: OverflowCandidate[] = [];
  for (let index = 5; index < ABUKUMA_RIVER_CENTERLINE.length - 5; index += 7) {
    const prev = ABUKUMA_RIVER_CENTERLINE[index - 1];
    const point = ABUKUMA_RIVER_CENTERLINE[index];
    const next = ABUKUMA_RIVER_CENTERLINE[index + 1];
    if (prev === undefined || point === undefined || next === undefined) {
      continue;
    }
    const bearing = bearingRadians(prev, next);
    // 中心線進行（南→北）に対し右側＝市街地側。
    const bank = offsetMeters(point, bearing + Math.PI / 2, 55);
    const turn = Math.abs(bearingRadians(prev, point) - bearingRadians(point, next));
    const bendFactor = turn > 0.18 ? 0.95 : turn > 0.1 ? 0.8 : 0.65;
    // 南寄り・工学部周辺を低めに。
    const bankElevationMeters = 18.6 + (point.lat - 37.355) * 80 + (1 - bendFactor) * 1.2;
    samples.push({
      id: `bank-${index}`,
      longitude: bank.lon,
      latitude: bank.lat,
      outflowHeadingDegrees: normalizeDegrees((bearing * 180) / Math.PI + 90),
      bankElevationMeters,
      structuralVulnerability: bendFactor,
      primaryHazard: bendFactor >= 0.85 ? "erosion" : "overtopping",
    });
  }
  return samples;
}

const SAMPLED_CANDIDATES = buildSampledBankCandidates();

export function listOverflowCandidates(): OverflowCandidate[] {
  return [...MANUAL_CANDIDATES, ...SAMPLED_CANDIDATES];
}

/**
 * Cesium / DEM から得た岸の標高を反映する。
 * 低い地点ほど vulnerability が上がる。
 */
export function applyOverflowTerrainElevations(
  samples: ReadonlyArray<{ id: string; heightMeters: number }>,
): void {
  for (const sample of samples) {
    if (Number.isFinite(sample.heightMeters)) {
      terrainElevationOverrides.set(sample.id, sample.heightMeters);
    }
  }
}

export function clearOverflowTerrainElevations(): void {
  terrainElevationOverrides.clear();
}

/** 標高差を織り込んだ弱点係数（おおよそ 0.55〜1.45）。 */
export function resolveCandidateVulnerability(candidate: OverflowCandidate): number {
  const elevation = terrainElevationOverrides.get(candidate.id) ?? candidate.bankElevationMeters;
  const all = listOverflowCandidates().map(
    (item) => terrainElevationOverrides.get(item.id) ?? item.bankElevationMeters,
  );
  const minElev = Math.min(...all);
  const maxElev = Math.max(...all);
  const span = Math.max(0.8, maxElev - minElev);
  // 低い岸ほど 1 に近い elevationFactor。
  const elevationFactor = 1.15 - ((elevation - minElev) / span) * 0.55;
  return clamp(candidate.structuralVulnerability * elevationFactor, 0.55, 1.45);
}

export function getCandidateBankElevationMeters(candidate: OverflowCandidate): number {
  return terrainElevationOverrides.get(candidate.id) ?? candidate.bankElevationMeters;
}

function bearingRadians(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function offsetMeters(
  point: { lon: number; lat: number },
  bearingRadiansValue: number,
  distanceMeters: number,
): { lon: number; lat: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  const north = Math.cos(bearingRadiansValue) * distanceMeters;
  const east = Math.sin(bearingRadiansValue) * distanceMeters;
  return {
    lon: point.lon + east / metersPerDegreeLon,
    lat: point.lat + north / metersPerDegreeLat,
  };
}

function normalizeDegrees(degrees: number): number {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
