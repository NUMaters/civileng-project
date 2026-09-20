export type AnimationClock = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

/** Keeps the caller's visual state alive while removing paused time from its clock. */
export function createPausableAnimation(
  draw: (time: number) => void,
  clock: AnimationClock,
  initiallyPaused = false,
) {
  let handle: number | null = null;
  let pausedAt: number | null = initiallyPaused ? clock.now() : null;
  let pausedDuration = 0;
  let disposed = false;
  let generation = 0;
  const schedule = () => {
    if (disposed || pausedAt !== null || handle !== null) return;
    const token = generation;
    handle = clock.request(time => {
      if (disposed || pausedAt !== null || token !== generation) return;
      handle = null;
      draw(time - pausedDuration);
      schedule();
    });
  };
  const cancel = () => {
    generation++;
    if (handle !== null) clock.cancel(handle);
    handle = null;
  };
  schedule();
  return {
    setPaused(paused: boolean) {
      if (disposed || paused === (pausedAt !== null)) return;
      if (paused) {
        pausedAt = clock.now();
        cancel();
      } else {
        pausedDuration += Math.max(0, clock.now() - pausedAt!);
        pausedAt = null;
        schedule();
      }
    },
    dispose() { disposed = true; cancel(); },
  };
}
