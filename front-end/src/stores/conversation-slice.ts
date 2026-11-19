import type { ConversationSlice, SliceCreator } from "./types";
export const createConversationSlice: SliceCreator<ConversationSlice> = (
  set,
  get,
) => ({
  messages: [],
  pending: false,
  suggestions: [],
  updateMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setPending: (pending) => set({ pending }),
  applyChat: (revision, data) => {
    // Manual edits win over filter/map changes from an older conversational request.
    if (get().searchRevision !== revision) {
      set({
        conversationId: data.conversation_id,
        suggestions: data.suggestions,
      });
      return false;
    }
    // One atomic update keeps search, conversation, result reference and map action aligned.
    set((s) => ({
      filters: data.filters
        ? data.filters_mode === "replace"
          ? data.filters
          : { ...s.filters, ...data.filters }
        : s.filters,
      searchRevision: s.searchRevision + 1,
      conversationId: data.conversation_id,
      resultSetId: data.result_set_id,
      suggestions: data.suggestions,
      ...(data.map_action
        ? {
            mapAction: data.map_action,
            mapActionVersion: s.mapActionVersion + 1,
          }
        : {}),
    }));
    return true;
  },
});
