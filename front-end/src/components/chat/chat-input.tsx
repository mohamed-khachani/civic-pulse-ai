"use client";
import { ArrowUp, LoaderCircle, CornerDownLeft } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useChat } from "@/hooks/use-chat";
import { useAtlas } from "@/stores/atlas-store";
const schema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(4000, "Escribe un mensaje de hasta 4.000 caracteres."),
});
export function ChatInput({ welcome = false }: { welcome?: boolean }) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { message: "" },
  });
  const messageValue = useWatch({ control, name: "message" });
  const { mutate } = useChat();
  const pending = useAtlas((s) => s.pending);
  const submit = handleSubmit(({ message }) => {
    if (!pending) {
      mutate(message);
      reset();
    }
  });
  return (
    <form
      className={`composer ${welcome ? "welcome-composer" : ""}`}
      onSubmit={submit}
    >
      <label
        htmlFor={welcome ? "welcome-message" : "chat-message"}
        className="sr-only"
      >
        Cuéntanos qué vivienda buscas
      </label>
      <textarea
        {...register("message")}
        id={welcome ? "welcome-message" : "chat-message"}
        rows={welcome ? 2 : 2}
        placeholder={
          welcome
            ? "Busco un piso de 2 habitaciones por menos de 1.200 €…"
            : "Cuéntame un poco más de lo que buscas…"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        maxLength={4000}
      />
      <div className="composer-bottom">
        <span>
          {welcome ? (
            <>
              <span className="composer-dot" />
              Tu hogar empieza con una conversación
            </>
          ) : (
            <>
              <CornerDownLeft size={12} /> Enter para enviar
            </>
          )}
        </span>
        <button
          className="send-button"
          type="submit"
          aria-label="Enviar mensaje"
          disabled={pending || !messageValue?.trim()}
        >
          {pending ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowUp size={20} />
          )}
        </button>
      </div>
      {errors.message && (
        <span className="form-error" role="alert">
          {errors.message.message}
        </span>
      )}
    </form>
  );
}
