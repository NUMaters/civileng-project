import { describe, expect, it, vi } from "vitest";
import { createCameraFocusNotifier } from "./cameraFocusNotification";
describe("camera focus notification", () => {
  it("throttles moving frames then sends the final position without requiring another input", () => {
    const callback = vi.fn(), update = createCameraFocusNotifier(callback, 200);
    update(0, 0, 0); update(10, 20, 100); update(11, 21, 199);
    expect(callback).toHaveBeenCalledTimes(1);
    update(11, 21, 201);
    expect(callback).toHaveBeenLastCalledWith(11, 21);
    update(11, 21, 500); update(NaN, 0, 600);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
