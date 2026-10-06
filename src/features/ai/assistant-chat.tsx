"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon, SparklesIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/features/session/session-context";
import { AssistantTurn } from "@/features/voice/assistant-turn";
import { pickProvider, SpeechError, type ListeningSession } from "@/features/voice/speech";
import { useAssistantApi } from "@/features/voice/use-assistant";
import { MicOrb, VOICE_EXAMPLES } from "@/features/voice/voice-sheet";
import { apiGet, errorMessage } from "@/lib/api";
import type { AssistantResponse } from "@/lib/api-types";
import { formatTime } from "@/lib/dates";

/** Conversational assistant: a history of turns, each with its answer or confirmation card. */
export function AssistantChat() {
  const me = useSession();
  const qc = useQueryClient();
  const apiFns = useAssistantApi();
  const history = useQuery({ queryKey: ["ai", "history"], queryFn: ({ signal }) => apiGet<AssistantResponse[]>("/ai/interactions", signal), staleTime: 0 });
  const [turns, setTurns] = React.useState<AssistantResponse[] | null>(null);
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "listening" | "processing">("idle");
  const [level, setLevel] = React.useState(0);
  const [busy, setBusy] = React.useState<{ id: string; kind: "confirm" | "clarify" | "cancel" } | null>(null);
  const session = React.useRef<ListeningSession | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const list = turns ?? history.data ?? [];

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [list.length, pending]);

  const upsert = (r: AssistantResponse) =>
    setTurns((cur) => {
      const base = cur ?? history.data ?? [];
      return base.some((t) => t.interactionId === r.interactionId) ? base.map((t) => (t.interactionId === r.interactionId ? r : t)) : [...base, r];
    });

  const send = async (msg: string, voice?: { provider: "browser"; language?: string; durationMs?: number }) => {
    const t = msg.trim();
    if (!t) return;
    setPending(t);
    setText("");
    setPhase("processing");
    try {
      upsert(await apiFns.interpret(t, voice));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
      setPhase("idle");
    }
  };

  const listen = async () => {
    const provider = pickProvider(me.settings.voiceProvider);
    if (!provider || !me.flags.VOICE_ENABLED) return void toast.error("Voice isn't available here — please type.");
    setPhase("listening");
    try {
      const s = provider.transcribe({ onInterim: (x) => setPending(x || null), onLevel: setLevel });
      session.current = s;
      const r = await s.result;
      session.current = null;
      if (r.kind === "text") await send(r.text, { provider: "browser", language: r.language, durationMs: r.durationMs });
      else if (r.kind === "response") upsert(r.response);
      else toast.message("I didn't hear anything.");
    } catch (err) {
      toast.error(err instanceof SpeechError && err.code === "not-allowed" ? "Allow microphone access to speak." : errorMessage(err));
    } finally {
      setPending(null);
      setPhase("idle");
    }
  };

  const handlersFor = (r: AssistantResponse) => {
    const run = async (kind: "confirm" | "clarify" | "cancel", fn: () => Promise<AssistantResponse>) => {
      setBusy({ id: r.interactionId, kind });
      try {
        upsert(await fn());
      } catch (err) {
        toast.error(errorMessage(err));
        void qc.invalidateQueries({ queryKey: ["ai", "history"] });
      } finally {
        setBusy(null);
      }
    };
    return {
      busy: busy?.id === r.interactionId ? busy.kind : null,
      onConfirm: () => void run("confirm", () => apiFns.confirm(r.interactionId)),
      onClarify: (c: { optionId?: string; text?: string }) => void run("clarify", () => apiFns.clarify(r.interactionId, c)),
      onCancel: () => void run("cancel", () => apiFns.cancel(r.interactionId)),
      onEdit: () => apiFns.edit(r),
    };
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-2xl flex-col">
      <div className="mb-4">
        <h1 className="text-[22px] font-semibold tracking-tight">AI Assistant</h1>
        <p className="text-[14px] text-muted-foreground">Ask about your shop, or tell it what happened. Nothing is saved until you confirm.</p>
      </div>
      <div className="flex-1 space-y-5 pb-4" aria-live="polite">
        {history.isLoading && !turns ? (
          <p className="text-sm text-muted-foreground">Loading conversation…</p>
        ) : list.length === 0 && !pending ? (
          <div className="rounded-3xl border bg-card p-6 text-center">
            <SparklesIcon className="mx-auto size-8 text-primary" aria-hidden="true" />
            <p className="mt-2 text-[16px] font-semibold">Namaste! Main aapki dukaan sambhalne mein madad karunga.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try one of these:</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[...VOICE_EXAMPLES, "Is month ka profit kitna hai?", "Ramesh ka kitna baki hai?"].map((ex) => (
                <button key={ex} type="button" onClick={() => void send(ex)} className="rounded-full border bg-background px-3 py-1.5 text-[13px] font-medium hover:bg-accent">
                  “{ex}”
                </button>
              ))}
            </div>
          </div>
        ) : (
          list.map((r) => (
            <div key={r.interactionId} className="space-y-2">
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
                  {r.inputText}
                  <span className="mt-0.5 block text-right text-[10.5px] opacity-70">{formatTime(r.createdAt)}</span>
                </p>
              </div>
              <div className="max-w-[95%]">
                <AssistantTurn response={r} handlers={handlersFor(r)} compact />
              </div>
            </div>
          ))
        )}
        {pending && (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/70 px-4 py-2.5 text-[15px] text-primary-foreground">{pending}…</p>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t bg-background/95 px-4 pt-3 pb-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border md:px-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          {me.flags.VOICE_ENABLED && (
            <div className="-my-3">
              <MicOrb size="md" phase={phase} level={level} onStart={() => void listen()} onStop={() => session.current?.stop()} />
            </div>
          )}
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={phase === "listening" ? "Listening…" : "Type: aaj 20 Coke biki…"} aria-label="Message" disabled={phase !== "idle"} className="h-12" />
          <Button type="submit" size="icon" className="size-12" aria-label="Send" disabled={!text.trim() || phase !== "idle"}>
            <SendIcon />
          </Button>
        </form>
      </div>
    </div>
  );
}
