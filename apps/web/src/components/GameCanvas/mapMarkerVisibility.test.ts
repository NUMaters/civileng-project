import { describe, expect, it } from "vitest";

/**
 * CesiumGameMap のマーカー表示ゲートと同じ判定。
 * 未開始・ロビー・未配置では弱点／設置ガイドを出さない。
 */
function shouldShowWeaknessTargets(input: {
  mapActive: boolean;
  phase: "idle" | "preparation" | "disaster" | "result" | "review";
  influenceCount: number;
}): boolean {
  const playable =
    input.mapActive && (input.phase === "preparation" || input.phase === "disaster");
  return playable && input.influenceCount > 0;
}

function shouldShowPlaceableZone(input: {
  mapActive: boolean;
  phase: "idle" | "preparation" | "disaster" | "result" | "review";
}): boolean {
  return input.mapActive && (input.phase === "preparation" || input.phase === "disaster");
}

function shouldShowOverflowMarks(input: {
  mapActive: boolean;
  activeFlood: boolean;
  overflowCount: number;
}): boolean {
  return input.mapActive && input.activeFlood && input.overflowCount > 0;
}

describe("map marker visibility gates", () => {
  it("ロビー・未開始では弱点も配置帯も決壊も出さない", () => {
    expect(
      shouldShowWeaknessTargets({ mapActive: false, phase: "idle", influenceCount: 3 }),
    ).toBe(false);
    expect(shouldShowPlaceableZone({ mapActive: false, phase: "preparation" })).toBe(false);
    expect(
      shouldShowOverflowMarks({ mapActive: false, activeFlood: true, overflowCount: 2 }),
    ).toBe(false);
    expect(
      shouldShowWeaknessTargets({ mapActive: true, phase: "idle", influenceCount: 1 }),
    ).toBe(false);
  });

  it("準備中でも未配置なら弱点マーカーは出さない", () => {
    expect(
      shouldShowWeaknessTargets({ mapActive: true, phase: "preparation", influenceCount: 0 }),
    ).toBe(false);
    expect(shouldShowPlaceableZone({ mapActive: true, phase: "preparation" })).toBe(true);
  });

  it("ドラッグ／仮配置があれば弱点ヒントを出す", () => {
    expect(
      shouldShowWeaknessTargets({ mapActive: true, phase: "preparation", influenceCount: 1 }),
    ).toBe(true);
  });

  it("決壊マークは大雨中かつ越水があるときだけ", () => {
    expect(
      shouldShowOverflowMarks({ mapActive: true, activeFlood: false, overflowCount: 2 }),
    ).toBe(false);
    expect(
      shouldShowOverflowMarks({ mapActive: true, activeFlood: true, overflowCount: 0 }),
    ).toBe(false);
    expect(
      shouldShowOverflowMarks({ mapActive: true, activeFlood: true, overflowCount: 1 }),
    ).toBe(true);
  });
});
