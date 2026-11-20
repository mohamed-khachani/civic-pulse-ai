import "dotenv/config";
export const config = {
  databaseUrl: process.env.DATABASE_URL,
  apiKey: process.env.ANTHROPIC_API_KEY,
  model:
    process.env.ANTHROPIC_MODEL ||
    process.env.CLAUDE_MODEL ||
    "claude-haiku-5-5",
  port: Number(process.env.PORT || 8000),
  host: process.env.HOST || "127.0.0.1",
  maxBatches: Math.max(
    1,
    Math.min(20, Number(process.env.CHAT_MAX_BATCHES || 6)),
  ),
  target: Math.max(
    1,
    Math.min(100, Number(process.env.CHAT_TARGET_RESULTS || 50)),
  ),
  chatTimeout: Math.max(
    10000,
    Math.min(290000, Number(process.env.CHAT_TIMEOUT_MS || 240000)),
  ),
  maxInputChars: Number(process.env.CLAUDE_MAX_INPUT_CHARS || 380000),
};
