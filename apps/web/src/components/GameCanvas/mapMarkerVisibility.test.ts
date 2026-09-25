import { describe, expect, it } from "vitest";

/**
 * CesiumGameMap のマーカー表示ゲートと同じ判定。
 * 未開始・ロビーでは設置ガイドや決壊マークを出さない。
 */
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
  it("ロビー・未開始では配置帯も決壊も出さない", () => {
    expect(shouldShowPlaceableZone({ mapActive: false, phase: "preparation" })).toBe(false);
    expect(shouldShowOverflowMarks({ mapActive: false, activeFlood: true, overflowCount: 2 })).toBe(
      false,
    );
  });

  it("準備中は配置帯を出す", () => {
    expect(shouldShowPlaceableZone({ mapActive: true, phase: "preparation" })).toBe(true);
  });

  it("決壊マークは大雨中かつ越水があるときだけ", () => {
    expect(shouldShowOverflowMarks({ mapActive: true, activeFlood: false, overflowCount: 2 })).toBe(
      false,
    );
    expect(shouldShowOverflowMarks({ mapActive: true, activeFlood: true, overflowCount: 0 })).toBe(
      false,
    );
    expect(shouldShowOverflowMarks({ mapActive: true, activeFlood: true, overflowCount: 1 })).toBe(
      true,
    );
  });
});
