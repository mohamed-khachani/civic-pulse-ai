import { describe, it, expect } from "vitest";
import { readChatResponse } from "@/lib/api/chat";
const complete = {
  message: "Encontré viviendas.",
  conversation_id: "c",
  filters: { max_price: 1000 },
  map_action: { type: "none" },
  suggestions: [],
};
function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("Streaming boundary", () => {
  it("streams text and validates the final structured response across chunk boundaries", async () => {
    const deltas: string[] = [];
    const response = await readChatResponse(
      sse([
        "event: del",
        'ta\r\ndata: {"text":"Hola"}\r\n\r',
        "\nevent: done\ndata: " + JSON.stringify(complete) + "\n\n",
      ]),
      (s) => deltas.push(s),
    );
    expect(deltas).toEqual(["Hola"]);
    expect(response.filters?.max_price).toBe(1000);
  });
  it("rejects an interrupted stream without a final response", async () => {
    await expect(
      readChatResponse(sse(['event: delta\ndata: {"text":"Hola"}\n\n'])),
    ).rejects.toThrow("interrumpido");
  });
  it("rejects invalid actions in the final event", async () => {
    await expect(
      readChatResponse(
        sse([
          "event: done\ndata: " +
            JSON.stringify({ ...complete, map_action: { type: "execute" } }) +
            "\n\n",
        ]),
      ),
    ).rejects.toThrow("formato");
  });
  it("supports ordinary JSON from the same endpoint", async () =>
    expect((await readChatResponse(Response.json(complete))).message).toBe(
      complete.message,
    ));
});
