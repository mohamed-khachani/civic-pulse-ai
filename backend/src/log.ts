import { appendFileSync, mkdirSync } from "node:fs";
mkdirSync("logs", { recursive: true });
export function log(event: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...data,
  });
  console.log(line);
  try {
    appendFileSync("logs/api.jsonl", line + "\n");
  } catch {
    /* stdout remains available */
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
