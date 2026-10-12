import { describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsProvider } from "./elevenlabs";
import { MockTtsProvider } from "./mock";

const audio = () => new Response(new Uint8Array(4_096), { status: 200, headers: { "content-type": "audio/mpeg" } });

describe("ElevenLabs text to speech", () => {
  it("posts the narration with the key and returns the mp3 bytes", async () => {
    const fetchFn = vi.fn().mockResolvedValue(audio());
    const result = await new ElevenLabsTtsProvider({ apiKey: "k", voiceId: "voice 1", modelId: "eleven_multilingual_v2", fetchFn }).synthesize("안녕하세요, 오늘의 추천 메뉴입니다.");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice%201?output_format=mp3_44100_128");
    expect(init.headers["xi-api-key"]).toBe("k");
    expect(JSON.parse(init.body)).toEqual({ text: "안녕하세요, 오늘의 추천 메뉴입니다.", model_id: "eleven_multilingual_v2" });
    expect(result.audio.length).toBe(4_096);
    expect(result.characters).toBe(20);
  });

  it("needs a key and a voice, and refuses empty or oversized narration before any request", async () => {
    const fetchFn = vi.fn();
    await expect(new ElevenLabsTtsProvider({ apiKey: "", voiceId: "v", fetchFn }).synthesize("가")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(new ElevenLabsTtsProvider({ apiKey: "k", voiceId: "", fetchFn }).synthesize("가")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(new ElevenLabsTtsProvider({ apiKey: "k", voiceId: "v", fetchFn }).synthesize("   ")).rejects.toMatchObject({ code: "INVALID_TARGET" });
    await expect(new ElevenLabsTtsProvider({ apiKey: "k", voiceId: "v", fetchFn }).synthesize("가".repeat(1_300))).rejects.toMatchObject({ code: "INVALID_TARGET" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("classifies failures", async () => {
    const make = (response: Response | Error) => new ElevenLabsTtsProvider({ apiKey: "k", voiceId: "v", fetchFn: vi.fn()[response instanceof Error ? "mockRejectedValue" : "mockResolvedValue"](response) });
    await expect(make(new Response("", { status: 401 })).synthesize("가")).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(make(new Response("", { status: 503 })).synthesize("가")).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR", retryable: true });
    await expect(make(new TypeError("fetch failed")).synthesize("가")).rejects.toMatchObject({ code: "NETWORK_FAILURE" });
    await expect(make(new Response(new Uint8Array(10), { status: 200 })).synthesize("가")).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });
  });

  it("has a mock that records what it was asked to say", async () => {
    const mock = new MockTtsProvider();
    expect((await mock.synthesize("테스트")).characters).toBe(3);
    expect(mock.spoken).toEqual(["테스트"]);
  });
});
