const TUTORIAL_DONE_KEY = "civilcraft.tutorialDone";

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    // ignore
  }
}
