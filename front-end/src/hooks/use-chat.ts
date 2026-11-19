"use client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAtlas } from "@/stores/atlas-store";
export function useChat() {
  return useMutation({
    mutationFn: async (message: string) => {
      const s = useAtlas.getState();
      if (s.pending) return;
      const revision = s.searchRevision;
      s.setPending(true);
      s.addMessage({ id: crypto.randomUUID(), role: "user", content: message });
      const responseId = crypto.randomUUID();
      let streamed = "";
      let hasStream = false;
      try {
        const data = await api.chat(
          {
            message,
            filters: s.filters,
            conversation_id: s.conversationId,
            selected_listing_id: s.selectedId,
            result_set_id: s.resultSetId,
          },
          undefined,
          (delta) => {
            streamed += delta;
            if (!hasStream) {
              s.addMessage({
                id: responseId,
                role: "assistant",
                content: streamed,
              });
              hasStream = true;
            } else {
              s.updateMessage(responseId, streamed);
            }
          },
        );
        const applied = useAtlas.getState().applyChat(revision, data);
        const content =
          data.message +
          (applied
            ? ""
            : "\nHas cambiado los filtros durante la consulta; hemos conservado tus ajustes más recientes.");
        if (hasStream) s.updateMessage(responseId, content);
        else s.addMessage({ id: responseId, role: "assistant", content });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "No se ha podido enviar el mensaje.";
        toast.error(message);
        const content = message + " Puedes volver a enviar tu consulta.";
        if (hasStream) s.updateMessage(responseId, content);
        else s.addMessage({ id: responseId, role: "assistant", content });
      } finally {
        s.setPending(false);
      }
    },
  });
}
