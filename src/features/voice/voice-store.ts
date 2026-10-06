"use client";
import { create } from "zustand";
import type { AssistantResponse } from "@/lib/api-types";

/**
 * Voice interaction states (see brief §33):
 * idle → listening → processing → (clarify | confirm | answer) → executing → done · or error
 */
export type VoicePhase = "idle" | "listening" | "processing" | "result" | "executing" | "done" | "error";

interface VoiceState {
  open: boolean;
  phase: VoicePhase;
  interim: string;
  level: number;
  response: AssistantResponse | null;
  error: string | null;
  /** Set when the sheet should start listening as soon as it opens. */
  autoListen: boolean;
  openSheet: (opts?: { listen?: boolean }) => void;
  closeSheet: () => void;
  set: (patch: Partial<Omit<VoiceState, "openSheet" | "closeSheet" | "set" | "reset">>) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  open: false,
  phase: "idle",
  interim: "",
  level: 0,
  response: null,
  error: null,
  autoListen: false,
  openSheet: (opts) => set({ open: true, autoListen: opts?.listen ?? true, phase: "idle", interim: "", response: null, error: null }),
  closeSheet: () => set({ open: false, autoListen: false }),
  set: (patch) => set(patch),
  reset: () => set({ phase: "idle", interim: "", level: 0, response: null, error: null }),
}));
