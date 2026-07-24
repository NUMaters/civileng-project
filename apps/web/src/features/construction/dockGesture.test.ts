import { describe, expect, it } from "vitest";
import { DOCK_GESTURE_LOCK_PX, resolveDockPointerIntent } from "./dockGesture";

describe("resolveDockPointerIntent", () => {
  it("閾値未満は pending", () => {
    expect(resolveDockPointerIntent(4, -4)).toBe("pending");
    expect(resolveDockPointerIntent(DOCK_GESTURE_LOCK_PX - 1, 0)).toBe("pending");
  });

  it("横移動が優勢なら scroll", () => {
    expect(resolveDockPointerIntent(30, -8)).toBe("scroll");
    expect(resolveDockPointerIntent(-24, 10)).toBe("scroll");
  });

  it("横と縦が同程度なら scroll（誤ドラッグ防止）", () => {
    expect(resolveDockPointerIntent(20, -20)).toBe("scroll");
    expect(resolveDockPointerIntent(18, 18)).toBe("scroll");
  });

  it("上方向かつ縦優勢なら drag", () => {
    expect(resolveDockPointerIntent(6, -28)).toBe("drag");
    expect(resolveDockPointerIntent(-5, -30)).toBe("drag");
  });

  it("下方向の縦移動は drag にしない", () => {
    expect(resolveDockPointerIntent(-5, 30)).toBe("scroll");
    expect(resolveDockPointerIntent(0, 20)).toBe("scroll");
  });
});
