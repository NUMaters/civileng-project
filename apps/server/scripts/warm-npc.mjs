/** Optional warm-up; run before playing to avoid a cold model hitting the 5-second fallback. */
const model = process.env.NPC_LLM_MODEL ?? "qwen3:14b";
const base = (process.env.NPC_LLM_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
process.stdout.write(`Loading NPC model ${model}…\n`);
try {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: "10m",
      messages: [{ role: "user", content: "こんにちは、とだけ答えてください。" }],
      options: { num_ctx: 4096, num_predict: 24 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error(`Ollama HTTP ${response.status}; check that the model is installed.`);
  const body = await response.json();
  if (!body.done) throw new Error("Ollama did not complete warm-up.");
  process.stdout.write("NPC model ready. Start the game within 10 minutes.\n");
} catch (error) {
  process.stderr.write(`NPC warm-up failed: ${error.message}\nFixed answers remain available.\n`);
  process.exitCode = 1;
}
