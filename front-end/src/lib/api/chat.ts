import { z } from "zod";
import { chatResponseSchema, type ChatResponse } from "@/types";
const deltaSchema = z.object({ text: z.string() });
/** Optional SSE contract: `event: delta` with {text}, then `event: done` with ChatResponse. */
export async function readChatResponse(
  response: Response,
  onDelta?: (text: string) => void,
): Promise<ChatResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const parsed = chatResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error(
        "La respuesta de la conversación no tiene el formato esperado.",
      );
    return parsed.data;
  }
  if (!response.body)
    throw new Error("El servicio ha enviado una respuesta vacía.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ChatResponse | undefined;
  function consume(block: string) {
    const lines = block.split("\n");
    const event = lines
      .find((l) => l.startsWith("event:"))
      ?.slice(6)
      .trim();
    const raw = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!raw || !event || !["delta", "done", "error"].includes(event)) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(
        "El servicio ha enviado un fragmento de conversación no válido.",
      );
    }
    if (event === "error")
      throw new Error(
        "La conversación se ha interrumpido. Inténtalo de nuevo.",
      );
    if (event === "delta") {
      const delta = deltaSchema.safeParse(payload);
      if (!delta.success)
        throw new Error("Fragmento de conversación no válido.");
      onDelta?.(delta.data.text);
    }
    if (event === "done") {
      const complete = chatResponseSchema.safeParse(payload);
      if (!complete.success)
        throw new Error("La respuesta final no tiene el formato esperado.");
      result = complete.data;
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replaceAll(
        "\r\n",
        "\n",
      );
      if (buffer.length > 1_000_000)
        throw new Error("La respuesta supera el tamaño permitido.");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (result) return result;
      }
      if (done) {
        if (buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!result)
      throw new Error(
        "La conversación se ha interrumpido antes de completarse.",
      );
    return result;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      throw new Error("El servicio ha tardado demasiado. Inténtalo de nuevo.");
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
