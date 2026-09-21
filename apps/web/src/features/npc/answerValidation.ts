const MAX_ANSWER_CHARACTERS = 120;
const PROHIBITED_PHRASES = ["絶対", "必ず", "100%", "確実"];

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/** Mirrors the NPC Backend's display and safety checks for generated text. */
export function isDisplayableNpcAnswer(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "" || Array.from(value).length > MAX_ANSWER_CHARACTERS)
    return false;
  const lower = value.toLowerCase();
  if (
    value.includes("<") ||
    value.includes(">") ||
    lower.includes("http") ||
    lower.includes("www.") ||
    hasControlCharacter(value) ||
    PROHIBITED_PHRASES.some((phrase) => value.includes(phrase))
  )
    return false;
  return [...value].filter((character) => character === "。" || character === "！" || character === "？")
    .length <= 2;
}
