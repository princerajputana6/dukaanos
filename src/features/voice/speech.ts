/**
 * Client speech abstraction. Business logic never talks to a speech engine directly:
 *   - BrowserSpeechProvider: Web Speech API (fast, free, on-device/Google; Chrome/Android/Edge)
 *   - ServerSpeechProvider: records audio (MediaRecorder) and sends it to /api/ai/voice
 *     (Workers AI Whisper) — works on browsers without speech recognition (e.g. Firefox)
 */
import { api } from "@/lib/api";
import type { AssistantResponse } from "@/lib/api-types";

/** Stop after this much silence once the user has started speaking. */
const END_OF_SPEECH_SILENCE_MS = 1_800;
/** Give up if nothing is said at all. */
const NO_SPEECH_TIMEOUT_MS = 8_000;
/** Minimum RMS treated as speech, even in a very quiet room. */
const MIN_SPEECH_RMS = 0.02;
/** Speech must be this many times louder than the room's background noise. */
const SPEECH_OVER_NOISE = 2.5;
/** Hard cap on one utterance once speech started (a TV in the background can't keep us recording). */
const MAX_UTTERANCE_MS = 15_000;

export type SpeechProviderId = "browser" | "server";

export interface TranscribeCallbacks {
  onInterim?: (text: string) => void;
  onLevel?: (level: number) => void;
  /** Recording finished; audio is being sent for recognition (server engine). */
  onProcessing?: () => void;
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
    // Continuous mode so a short pause mid-sentence doesn't cut the user off; we stop
    // ourselves after a real silence (or when the user taps stop).
    rec.continuous = true;
    rec.maxAlternatives = 1;
    const started = Date.now();
    let finalText = "";
    let interim = "";
    let aborted = false;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    const armSilence = (ms: number) => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => rec.stop(), ms);
    };
    armSilence(NO_SPEECH_TIMEOUT_MS);
    const result = new Promise<TranscribeResult>((resolve, reject) => {
      rec.onresult = (e) => {
        interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += `${r[0].transcript} `;
          else interim += r[0].transcript;
        }
        cb.onInterim?.((finalText + interim).trim());
        armSilence(END_OF_SPEECH_SILENCE_MS);
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech") return; // handled in onend
        if (e.error === "aborted") return;
        const code = e.error === "not-allowed" || e.error === "service-not-allowed" ? "not-allowed" : e.error === "network" ? "network" : "failed";
        reject(new SpeechError(code, e.error));
      };
      rec.onend = () => {
        clearTimeout(silenceTimer);
        if (aborted) return resolve({ kind: "empty" });
        const text = (finalText + interim).trim();
        resolve(text ? { kind: "text", text, language: detect(text), durationMs: Date.now() - started } : { kind: "empty" });
      };
    });
    rec.start();
    return {
      stop: () => {
        clearTimeout(silenceTimer);
        rec.stop();
      },
      abort: () => {
        aborted = true;
        clearTimeout(silenceTimer);
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
    let vadTimer: ReturnType<typeof setTimeout> | undefined;
    let audioCtx: AudioContext | null = null;
    const chunks: Blob[] = [];
    const cleanup = () => {
      clearTimeout(vadTimer);
      void audioCtx?.close().catch(() => undefined);
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
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (recorder!.onstop = () => r()));
      recorder.start();
      // Level meter: drives the listening animation and ends the recording after a pause.
      try {
        const ac = new AudioContext();
        audioCtx = ac;
        if (ac.state === "suspended") void ac.resume(); // iOS/Safari start suspended → silent readings
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        ac.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const startedAt = Date.now();
        // Adaptive voice-activity detection: track the background noise floor (slowly rising,
        // quickly falling) and treat only clearly-louder frames as speech, so a noisy shop
        // still ends the recording when the shopkeeper stops talking.
        let noise = 0;
        let speechStartedAt = 0;
        let heardAt = 0;
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
          const rms = Math.sqrt(sum / buf.length);
          const now = Date.now();
          noise = noise === 0 ? rms : rms < noise ? noise * 0.8 + rms * 0.2 : noise * 0.995 + rms * 0.005;
          const threshold = Math.max(MIN_SPEECH_RMS, noise * SPEECH_OVER_NOISE);
          cb.onLevel?.(Math.min(1, rms / (threshold * 2)));
          if (rms > threshold && now - startedAt > 200) {
            heardAt = now;
            speechStartedAt ||= now;
          }
          const finished = heardAt
            ? now - heardAt > END_OF_SPEECH_SILENCE_MS || now - speechStartedAt > MAX_UTTERANCE_MS
            : now - startedAt > NO_SPEECH_TIMEOUT_MS;
          if (finished) {
            if (recorder?.state === "recording") recorder.stop();
            return;
          }
          if (recorder?.state === "recording") vadTimer = setTimeout(tick, 50);
        };
        tick();
      } catch {
        /* level meter is optional — the user taps stop instead */
      }
      const timer = setTimeout(() => recorder?.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
      await done;
      clearTimeout(timer);
      cleanup();
      if (aborted || chunks.length === 0) return { kind: "empty" };
      cb.onProcessing?.();
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

const BROWSER_STT_BROKEN_KEY = "dukaan:browser-stt-broken-until";

/**
 * The browser engine (Chrome's Web Speech API) streams audio to Google. In Brave, some
 * Edge/Android builds, behind VPNs or firewalls it fails with a "network" error. When that
 * happens we remember it on this device for a week and use DukaanOS server speech instead.
 */
function browserSttBroken(): boolean {
  try {
    return Number(localStorage.getItem(BROWSER_STT_BROKEN_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}
function markBrowserSttBroken() {
  try {
    localStorage.setItem(BROWSER_STT_BROKEN_KEY, String(Date.now() + 7 * 86_400_000));
  } catch {
    /* storage unavailable — we'll just fall back again next time */
  }
}

/** Picks a provider from the user's setting ("auto" prefers the browser engine when it works here). */
export function pickProvider(pref: string): SpeechProvider | null {
  const browser = new BrowserSpeechProvider();
  const server = new ServerSpeechProvider();
  if (pref === "server") return server.isSupported() ? server : browser.isSupported() ? browser : null;
  if (pref === "browser") return browser.isSupported() ? browser : server.isSupported() ? server : null;
  if (browserSttBroken() && server.isSupported()) return server;
  return browser.isSupported() ? browser : server.isSupported() ? server : null;
}

/**
 * Starts listening with the preferred engine. If the browser engine fails for network /
 * service reasons, transparently retries with server speech recognition (same callbacks),
 * so the user just keeps talking.
 */
export function startListening(pref: string, cb: TranscribeCallbacks & { onFallback?: () => void }): ListeningSession & { provider: SpeechProviderId } {
  const first = pickProvider(pref);
  if (!first) throw new SpeechError("unsupported", "Voice isn't supported in this browser.");
  let current = first.transcribe(cb);
  let aborted = false;
  const handle = {
    provider: first.id as SpeechProviderId,
    stop: () => current.stop(),
    abort: () => {
      aborted = true;
      current.abort();
    },
    result: current.result.catch((err: unknown) => {
      const server = new ServerSpeechProvider();
      const recoverable = err instanceof SpeechError && (err.code === "network" || err.code === "failed");
      if (first.id !== "browser" || !recoverable || !server.isSupported() || aborted) throw err;
      markBrowserSttBroken();
      cb.onFallback?.();
      handle.provider = "server";
      current = server.transcribe(cb);
      return current.result;
    }),
  };
  return handle;
}
