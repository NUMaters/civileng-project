const HOWTO_SEEN_KEY = "civilcraft.howtoSeen";

export function hasSeenHowTo(): boolean {
  try {
    return localStorage.getItem(HOWTO_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markHowToSeen(): void {
  try {
    localStorage.setItem(HOWTO_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}
