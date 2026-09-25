/** Rate-limit camera-focus callbacks while retaining a final sub-threshold movement. */
export function createCameraFocusNotifier(notify: (x: number, z: number) => void, interval = 400) {
  let lastTime = -Infinity;
  let lastX = NaN, lastZ = NaN;
  return (x: number, z: number, now: number) => {
    if (![x, z, now].every(Number.isFinite) || now - lastTime < interval) return;
    if (Math.abs(x - lastX) < 0.01 && Math.abs(z - lastZ) < 0.01) return;
    lastX = x; lastZ = z; lastTime = now;
    notify(x, z);
  };
}
