import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Simulates a browser whose Web Speech API can't reach Google's servers (Brave, some
 * Edge/Android builds, VPNs/firewalls): it fails with error "network". The app must keep
 * listening via Suvakta server speech (MediaRecorder → /api/ai/voice) and remember it.
 */
class FailingRecognition {
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    setTimeout(() => {
      this.onerror?.({ error: "network" });
      this.onend?.();
    }, 5);
  }
  stop() {}
  abort() {}
}

class FakeRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("webkitSpeechRecognition", FailingRecognition);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: { interactionId: "i1", inputText: "20 Coke biki", status: "PROPOSED" } }), { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("voice: browser speech network failure", () => {
  it("falls back to server speech, keeps listening, and remembers it on this device", async () => {
    const { startListening, pickProvider } = await import("@/features/voice/speech");
    expect(pickProvider("auto")?.id).toBe("browser");
    const onFallback = vi.fn();
    const onProcessing = vi.fn();
    const session = startListening("auto", { onFallback, onProcessing });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
    expect(session.provider).toBe("server");
    session.stop(); // user taps stop (no level meter in this fake environment)
    const res = await session.result;
    expect(res.kind).toBe("response");
    expect(onProcessing).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/ai/voice", expect.objectContaining({ method: "POST" }));
    // Next time on this device, go straight to server speech.
    expect(pickProvider("auto")?.id).toBe("server");
  });

  it("does not fall back when microphone permission is denied (server speech would be denied too)", async () => {
    class Denied extends FailingRecognition {
      override start() {
        setTimeout(() => this.onerror?.({ error: "not-allowed" }), 5);
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", Denied);
    const { startListening, SpeechError } = await import("@/features/voice/speech");
    const s = startListening("auto", {});
    await expect(s.result).rejects.toBeInstanceOf(SpeechError);
  });
});

/** A recognition engine that produces no transcript — mimics iOS/flaky-Android Web Speech. */
class EmptyRecognition extends FailingRecognition {
  override start() {
    setTimeout(() => this.onend?.(), 5);
  }
}

describe("voice: mobile routing", () => {
  const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
  const withUA = (ua: string) => vi.stubGlobal("navigator", { userAgent: ua, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });

  it("uses server speech upfront on iOS (Web Speech API is unreliable there)", async () => {
    withUA(IPHONE_UA);
    const { pickProvider } = await import("@/features/voice/speech");
    expect(pickProvider("auto")?.id).toBe("server");
    // An explicit browser preference is still honoured.
    expect(pickProvider("browser")?.id).toBe("browser");
  });

  it("keeps the browser engine upfront on Android, then switches to server after it hears nothing", async () => {
    withUA(ANDROID_UA);
    vi.stubGlobal("webkitSpeechRecognition", EmptyRecognition);
    const { pickProvider, startListening } = await import("@/features/voice/speech");
    expect(pickProvider("auto")?.id).toBe("browser");
    const res = await startListening("auto", {}).result;
    expect(res.kind).toBe("empty");
    // The flaky empty result is remembered, so the next tap uses reliable server speech.
    expect(pickProvider("auto")?.id).toBe("server");
  });
});
