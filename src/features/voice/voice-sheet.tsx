"use client";
import { KeyboardIcon, Loader2Icon, MicIcon, SendIcon, SquareIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useSession } from "@/features/session/session-context";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AssistantTurn } from "./assistant-turn";
import { pickProvider, SpeechError, startListening, type ListeningSession } from "./speech";
import { useAssistantApi } from "./use-assistant";
import { useVoiceStore } from "./voice-store";

export const VOICE_EXAMPLES = ["Aaj 20 Coke biki", "Ramesh ka ₹500 payment aaya", "Kaunsa product low hai?", "Aaj ka business kaisa raha?"];

const PHASE_LABEL: Record<string, string> = {
  idle: "Tap the mic and speak",
  listening: "Listening…",
  processing: "Understanding…",
  executing: "Saving…",
};

export function useVoiceController() {
  const s = useVoiceStore();
  const me = useSession();
  const apiFns = useAssistantApi();
  const session = React.useRef<ListeningSession | null>(null);
  const [busy, setBusy] = React.useState<"confirm" | "clarify" | "cancel" | null>(null);
  const voiceEnabled = me.flags.VOICE_ENABLED;

  const handleText = React.useCallback(
    async (text: string, voice?: { provider: "browser"; language?: string; durationMs?: number }) => {
      useVoiceStore.getState().set({ phase: "processing", interim: text, error: null });
      try {
        const response = await apiFns.interpret(text, voice);
        useVoiceStore.getState().set({ phase: "result", response });
      } catch (err) {
        useVoiceStore.getState().set({ phase: "error", error: errorMessage(err) });
      }
    },
    [apiFns],
  );

  const listen = React.useCallback(async () => {
    if (!pickProvider(me.settings.voiceProvider) || !voiceEnabled) {
      useVoiceStore.getState().set({ phase: "error", error: voiceEnabled ? "Voice isn't supported on this browser. You can type instead." : "Voice is turned off. You can type instead." });
      return;
    }
    session.current?.abort();
    useVoiceStore.getState().set({ phase: "listening", interim: "", level: 0, response: null, error: null });
    navigator.vibrate?.(15);
    try {
      const sess = startListening(me.settings.voiceProvider, {
        onInterim: (t) => useVoiceStore.getState().set({ interim: t }),
        onLevel: (l) => useVoiceStore.getState().set({ level: l }),
        onProcessing: () => useVoiceStore.getState().set({ phase: "processing", level: 0 }),
        // Browser speech can't reach its servers here — keep listening via DukaanOS voice.
        onFallback: () => useVoiceStore.getState().set({ phase: "listening", interim: "", error: null }),
      });
      session.current = sess;
      const res = await sess.result;
      session.current = null;
      if (res.kind === "empty") {
        useVoiceStore.getState().set({ phase: "error", error: "I didn't hear anything. Tap the mic and try again." });
      } else if (res.kind === "text") {
        await handleText(res.text, { provider: "browser", language: res.language, durationMs: res.durationMs });
      } else {
        useVoiceStore.getState().set({ phase: "result", response: res.response, interim: res.response.inputText });
      }
    } catch (err) {
      session.current = null;
      const msg =
        err instanceof SpeechError
          ? err.code === "not-allowed"
            ? "Microphone access is blocked. Allow it in your browser settings, or type instead."
            : err.code === "network"
              ? "Voice recognition can't connect right now. Check your internet, or type instead."
              : "I couldn't hear that. Please try again."
          : errorMessage(err);
      useVoiceStore.getState().set({ phase: "error", error: msg });
    }
  }, [handleText, me.settings.voiceProvider, voiceEnabled]);

  const stop = React.useCallback(() => {
    const cur = useVoiceStore.getState();
    session.current?.stop();
    if (cur.phase === "listening") useVoiceStore.getState().set({ phase: "processing" });
  }, []);

  const abort = React.useCallback(() => {
    session.current?.abort();
    session.current = null;
  }, []);

  const run = async (kind: "confirm" | "clarify" | "cancel", fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const response = s.response;
  const handlers = {
    busy,
    onConfirm: () =>
      run("confirm", async () => {
        if (!response) return;
        useVoiceStore.getState().set({ phase: "executing" });
        try {
          const r = await apiFns.confirm(response.interactionId);
          useVoiceStore.getState().set({ phase: "done", response: r });
          navigator.vibrate?.([10, 40, 10]);
        } catch (err) {
          useVoiceStore.getState().set({ phase: "result" });
          throw err;
        }
      }),
    onClarify: (choice: { optionId?: string; text?: string }) =>
      run("clarify", async () => {
        if (!response) return;
        const r = await apiFns.clarify(response.interactionId, choice);
        useVoiceStore.getState().set({ response: r, phase: "result" });
      }),
    onCancel: () =>
      run("cancel", async () => {
        if (!response) return;
        const r = await apiFns.cancel(response.interactionId);
        useVoiceStore.getState().set({ response: r, phase: "result" });
      }),
    onEdit: () => {
      if (!response) return;
      apiFns.edit(response);
      useVoiceStore.getState().closeSheet();
    },
  };

  return { listen, stop, abort, handleText, handlers, voiceEnabled };
}

export function VoiceSheet() {
  const s = useVoiceStore();
  const { listen, stop, abort, handleText, handlers, voiceEnabled } = useVoiceController();
  const [typing, setTyping] = React.useState(!voiceEnabled);
  const [text, setText] = React.useState("");

  // Start listening as soon as the sheet opens from the mic button.
  React.useEffect(() => {
    if (s.open && s.autoListen && voiceEnabled) {
      useVoiceStore.getState().set({ autoListen: false });
      void listen();
    }
  }, [s.open, s.autoListen, voiceEnabled, listen]);

  const close = (open: boolean) => {
    if (!open) {
      abort();
      s.closeSheet();
      s.reset();
      setText("");
    }
  };

  const busyPhase = s.phase === "processing" || s.phase === "executing";
  return (
    <ResponsiveModal open={s.open} onOpenChange={close} title="Talk to DukaanOS" description={PHASE_LABEL[s.phase] ?? " "} className="md:max-w-md">
      <div className="flex flex-col gap-4 pb-2">
        {(s.phase === "idle" || s.phase === "listening" || s.phase === "processing" || s.phase === "error") && (
          <div className="flex flex-col items-center gap-3 pt-2">
            {voiceEnabled && <MicOrb phase={s.phase} level={s.level} onStart={() => void listen()} onStop={stop} />}
            <p aria-live="polite" className={cn("min-h-6 max-w-sm text-center text-[16px] font-medium", !s.interim && "text-muted-foreground")}>
              {s.interim ? `“${s.interim}”` : s.phase === "listening" ? "Boliye…" : ""}
            </p>
            {s.phase === "error" && s.error && (
              <p role="alert" className="rounded-xl bg-warning-soft px-3.5 py-2 text-center text-[13.5px] text-warning-foreground">
                {s.error}
              </p>
            )}
          </div>
        )}

        {s.response && (s.phase === "result" || s.phase === "executing" || s.phase === "done") && (
          <div>
            <p className="mb-2 text-center text-[13.5px] text-muted-foreground">“{s.response.inputText}”</p>
            <AssistantTurn response={s.response} handlers={handlers} />
          </div>
        )}

        {(s.phase === "done" || (s.phase === "result" && s.response && ["ANSWERED", "FAILED", "CANCELLED", "EXPIRED"].includes(s.response.status))) && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                s.reset();
                if (voiceEnabled) void listen();
              }}
            >
              <MicIcon /> Say more
            </Button>
          </div>
        )}

        {(s.phase === "idle" || s.phase === "error" || s.phase === "listening") && (
          <>
            {s.phase !== "listening" && (
              <div className="flex flex-wrap justify-center gap-2" aria-label="Examples">
                {VOICE_EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => void handleText(ex)} className="rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground/80 hover:bg-accent">
                    “{ex}”
                  </button>
                ))}
              </div>
            )}
            {typing ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim()) {
                    abort();
                    void handleText(text.trim());
                  }
                }}
              >
                <Input autoFocus placeholder="Type: 20 Coke biki…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Type your command" />
                <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim() || busyPhase}>
                  <SendIcon />
                </Button>
              </form>
            ) : (
              <Button
                variant="ghost"
                className="mx-auto"
                onClick={() => {
                  abort();
                  if (s.phase === "listening") useVoiceStore.getState().set({ phase: "idle", interim: "" });
                  setTyping(true);
                }}
              >
                <KeyboardIcon /> Type instead
              </Button>
            )}
          </>
        )}
      </div>
    </ResponsiveModal>
  );
}

/** Big animated microphone with listening rings and live input level. */
export function MicOrb({ phase, level, onStart, onStop, size = "lg" }: { phase: string; level: number; onStart: () => void; onStop: () => void; size?: "lg" | "md" }) {
  const listening = phase === "listening";
  const processing = phase === "processing" || phase === "executing";
  const dim = size === "lg" ? "size-24" : "size-16";
  return (
    <div className="relative flex items-center justify-center py-3">
      {listening && (
        <>
          <span aria-hidden="true" className={cn("absolute rounded-full bg-primary/25 animate-pulse-ring", dim)} />
          <span aria-hidden="true" className={cn("absolute rounded-full bg-primary/20 animate-pulse-ring [animation-delay:0.5s]", dim)} />
          <span aria-hidden="true" className={cn("absolute rounded-full bg-primary/15 transition-transform duration-100", dim)} style={{ transform: `scale(${1 + Math.min(level * 2.2, 0.6)})` }} />
        </>
      )}
      <button
        type="button"
        onClick={listening ? onStop : onStart}
        disabled={processing}
        aria-label={listening ? "Stop listening" : "Start speaking"}
        aria-pressed={listening}
        className={cn(
          "relative flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform active:scale-95 disabled:opacity-80",
          dim,
        )}
      >
        {processing ? <Loader2Icon className="size-9 animate-spin" /> : listening ? <SquareIcon className="size-8 fill-current" /> : <MicIcon className="size-10" />}
      </button>
    </div>
  );
}
