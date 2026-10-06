/**
 * Client speech abstraction. Business logic never talks to a speech engine directly:
 *   - BrowserSpeechProvider: Web Speech API (fast, free, on-device/Google; Chrome/Android/Edge)
 *   - ServerSpeechProvider: records audio (MediaRecorder) and sends it to /api/ai/voice
 *     (Workers AI Whisper) — works on browsers without speech recognition (e.g. Firefox)
 */
import { api } from "@/lib/api";
import type { AssistantResponse } from "@/lib/api-types";

export type SpeechProviderId = "browser" | "server";

export interface TranscribeCallbacks {
  onInterim?: (text: string) => void;
  onLevel?: (level: number) => void;
}

/** Result of one listening session: either text to interpret, or a full server response. */
export type TranscribeResult = { kind: "text"; text: string; language: string; durationMs: number } | { kind: "response"; response: AssistantResponse } | { kind: "empty" };

export interface ListeningSession {
  /** Stop listening and resolve with what was heard. */
  stop(): void;
  /** Abort without a result. */
  abort(): void;
  result: Promise<TranscribeResult>;
}

export interface SpeechProvider {
  readonly id: SpeechProviderId;
  isSupported(): boolean;
  /** Starts listening; the returned session resolves when speech ends or stop() is called. */
  transcribe(callbacks: TranscribeCallbacks): ListeningSession;
  detectLanguage(text: string): string;
}

export class SpeechError extends Error {
  constructor(
    readonly code: "not-allowed" | "no-speech" | "network" | "unsupported" | "aborted" | "failed",
    message: string,
  ) {
    super(message);
  }
}

const detect = (text: string) => (/[ऀ-ॿ]/.test(text) ? "hi" : "en");

// ─── Browser (Web Speech API) ────────────────────────────────────────────────

interface SRResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SR {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class BrowserSpeechProvider implements SpeechProvider {
  readonly id = "browser" as const;
  constructor(private lang = "hi-IN") {}

  isSupported() {
    return getSR() !== null;
  }

  detectLanguage = detect;

  transcribe(cb: TranscribeCallbacks): ListeningSession {
    const Ctor = getSR();
    if (!Ctor) throw new SpeechError("unsupported", "Speech recognition is not supported in this browser.");
    const rec = new Ctor();
    rec.lang = this.lang; // hi-IN recognises Hindi, English and Hinglish well
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    const started = Date.now();
    let finalText = "";
    let interim = "";
    let aborted = false;
    const result = new Promise<TranscribeResult>((resolve, reject) => {
      rec.onresult = (e) => {
        interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        cb.onInterim?.((finalText + " " + interim).trim());
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech") return; // handled in onend
        if (e.error === "aborted") return;
        const code = e.error === "not-allowed" || e.error === "service-not-allowed" ? "not-allowed" : e.error === "network" ? "network" : "failed";
        reject(new SpeechError(code, e.error));
      };
      rec.onend = () => {
        if (aborted) return resolve({ kind: "empty" });
        const text = (finalText || interim).trim();
        resolve(text ? { kind: "text", text, language: detect(text), durationMs: Date.now() - started } : { kind: "empty" });
      };
    });
    rec.start();
    return {
      stop: () => rec.stop(),
      abort: () => {
        aborted = true;
        rec.abort();
      },
      result,
    };
  }
}

// ─── Server (record → Whisper) ──────────────────────────────────────────────

const MAX_RECORDING_MS = 30_000;

export class ServerSpeechProvider implements SpeechProvider {
  readonly id = "server" as const;

  isSupported() {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  detectLanguage = detect;

  transcribe(cb: TranscribeCallbacks): ListeningSession {
    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let aborted = false;
    let stopRequested = false;
    let raf = 0;
    const chunks: Blob[] = [];
    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const result = (async (): Promise<TranscribeResult> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        throw new SpeechError("not-allowed", "Microphone permission denied.");
      }
      if (stopRequested || aborted) {
        cleanup();
        return { kind: "empty" };
      }
      // Input level meter for the listening animation.
      try {
        const ac = new AudioContext();
        const analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        ac.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(buf);
          cb.onLevel?.(buf.reduce((a, b) => a + b, 0) / buf.length / 255);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* level meter is optional */
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (recorder!.onstop = () => r()));
      recorder.start();
      const timer = setTimeout(() => recorder?.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
      await done;
      clearTimeout(timer);
      cleanup();
      if (aborted || chunks.length === 0) return { kind: "empty" };
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 2000) return { kind: "empty" };
      const form = new FormData();
      form.append("audio", blob, `voice.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
      const response = await api<AssistantResponse>("/ai/voice", { method: "POST", body: form });
      return { kind: "response", response };
    })();

    return {
      stop: () => {
        stopRequested = true;
        if (recorder?.state === "recording") recorder.stop();
      },
      abort: () => {
        aborted = true;
        if (recorder?.state === "recording") recorder.stop();
        cleanup();
      },
      result,
    };
  }
}

/** Picks a provider from the user's setting ("auto" prefers the browser engine). */
export function pickProvider(pref: string): SpeechProvider | null {
  const browser = new BrowserSpeechProvider();
  const server = new ServerSpeechProvider();
  if (pref === "server") return server.isSupported() ? server : browser.isSupported() ? browser : null;
  if (pref === "browser") return browser.isSupported() ? browser : server.isSupported() ? server : null;
  return browser.isSupported() ? browser : server.isSupported() ? server : null;
}
