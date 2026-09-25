const READING_LEVEL_KEY = "civilcraft.npc.readingLevel";

type StoredReadingLevel = {
  version: 1;
  value: "standard" | "furigana";
};

export function loadFuriganaEnabled(): boolean {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(READING_LEVEL_KEY) ?? "null");
    return (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      "value" in value &&
      value.version === 1 &&
      value.value === "furigana"
    );
  } catch {
    return false;
  }
}

export function saveFuriganaEnabled(enabled: boolean): void {
  const value: StoredReadingLevel = { version: 1, value: enabled ? "furigana" : "standard" };
  try {
    localStorage.setItem(READING_LEVEL_KEY, JSON.stringify(value));
  } catch {
    // Storage may be disabled; retain the setting for this page only.
  }
}
