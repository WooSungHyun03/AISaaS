import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";
import { Json2VideoRenderProvider } from "./json2video";
import { renderShortVideo } from "./index";
import { MockVideoRenderProvider } from "./mock";
import { videoRenderInputSchema, type VideoRenderScene } from "./types";

const scenes: VideoRenderScene[] = [
  { text: "3초 안에 시선을 잡습니다", visualPrompt: "제품 클로즈업, 세로 9:16", durationSec: 3 },
  { text: "고객의 문제를 보여줍니다", visualPrompt: "고민하는 고객, 세로 9:16", durationSec: 4 },
  { text: "구체적인 해결 과정을 보여줍니다", visualPrompt: "서비스 사용 장면, 세로 9:16", durationSec: 5 },
  { text: "지금 확인해보세요", visualPrompt: "밝은 CTA 엔딩 카드, 세로 9:16", durationSec: 5 },
];
const voiceScript = "고객의 문제를 빠르게 확인하고 우리 서비스가 해결하는 과정을 소개합니다. 지금 확인해보세요.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("video render providers", () => {
  it("returns a deterministic MP4 URL in mock mode without a network request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const directUrl = await new MockVideoRenderProvider().renderShortVideo(scenes, voiceScript);
    const publicApiUrl = await renderShortVideo(scenes, voiceScript);

    expect(directUrl).toMatch(/^https:\/\/.*\.mp4$/);
    expect(publicApiUrl).toBe(directUrl);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps scenes to a JSON2Video template, polls, and returns a 9:16 MP4 URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, project: "project-12345678" }))
      .mockResolvedValueOnce(jsonResponse({ success: true, movie: { status: "running" } }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        movie: { status: "done", url: "https://assets.example.com/rendered/short.mp4", width: 1080, height: 1920 },
      }));
    const provider = new Json2VideoRenderProvider({
      apiKey: "test-api-key",
      templateId: "template-123",
      fetchFn: fetchMock,
      pollIntervalMs: 0,
      maxPollAttempts: 3,
    });

    const url = await provider.renderShortVideo(scenes, voiceScript);

    expect(url).toBe("https://assets.example.com/rendered/short.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [createUrl, createInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(createUrl.toString()).toBe("https://api.json2video.com/v2/movies");
    expect(createInit.headers).toMatchObject({ "x-api-key": "test-api-key" });
    const body = JSON.parse(String(createInit.body)) as {
      template: string;
      width: number;
      height: number;
      variables: { voice_script: string; scene_items: Array<Record<string, unknown>> };
    };
    expect(body).toMatchObject({ template: "template-123", width: 1080, height: 1920 });
    expect(body.variables.voice_script).toBe(voiceScript);
    expect(body.variables.scene_items[0]).toMatchObject({
      scene_text: scenes[0].text,
      visual_prompt: scenes[0].visualPrompt,
      duration_sec: scenes[0].durationSec,
      background_color: expect.any(String),
    });
  });

  it("fails before fetch when JSON2Video credentials are missing", async () => {
    const fetchMock = vi.fn();
    const provider = new Json2VideoRenderProvider({ apiKey: "", templateId: "", fetchFn: fetchMock });

    const error = await provider.renderShortVideo(scenes, voiceScript).catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops polling on an upstream error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, project: "project-12345678" }))
      .mockResolvedValueOnce(jsonResponse({ success: true, movie: { status: "error", message: "template failed" } }));
    const provider = new Json2VideoRenderProvider({
      apiKey: "test-api-key",
      templateId: "template-123",
      fetchFn: fetchMock,
      pollIntervalMs: 0,
      maxPollAttempts: 3,
    });

    const error = await provider.renderShortVideo(scenes, voiceScript).catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("UPSTREAM_SERVER_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out after a bounded number of running statuses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, project: "project-12345678" }))
      // A Response body can only be consumed once; return a fresh response
      // for every poll just like the real API does.
      .mockImplementation(() => Promise.resolve(jsonResponse({ success: true, movie: { status: "running" } })));
    const provider = new Json2VideoRenderProvider({
      apiKey: "test-api-key",
      templateId: "template-123",
      fetchFn: fetchMock,
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });

    const error = await provider.renderShortVideo(scenes, voiceScript).catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects non-portrait output and invalid render input", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, project: "project-12345678" }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        movie: { status: "done", url: "https://assets.example.com/rendered/wide.mp4", width: 1920, height: 1080 },
      }));
    const provider = new Json2VideoRenderProvider({
      apiKey: "test-api-key",
      templateId: "template-123",
      fetchFn: fetchMock,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(provider.renderShortVideo(scenes, voiceScript)).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });
    expect(videoRenderInputSchema.safeParse({ scenes: scenes.slice(0, 1), voiceScript }).success).toBe(false);
  });

  it("sends reference-image scenes as a full movie without a template and needs only the API key", async () => {
    const characterScenes: VideoRenderScene[] = scenes.map((scene, index) => ({
      ...scene,
      speaker: index === 0 ? "partner" : "main",
      motion: "pop",
      imageUrl: `https://be-celeb.org/shorts-mascot/wave.png`,
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, project: "project-12345678" }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        movie: { status: "done", url: "https://assets.example.com/rendered/skit.mp4", width: 1080, height: 1920 },
      }));
    const provider = new Json2VideoRenderProvider({ apiKey: "test-api-key", templateId: "", fetchFn: fetchMock, pollIntervalMs: 0, maxPollAttempts: 2 });

    const url = await provider.renderShortVideo(characterScenes, voiceScript);

    expect(url).toBe("https://assets.example.com/rendered/skit.mp4");
    const [, createInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(createInit.body)) as { template?: string; scenes: Array<{ elements: Array<{ type: string }> }> };
    expect(body.template).toBeUndefined();
    expect(body.scenes).toHaveLength(characterScenes.length);
    expect(body.scenes[0].elements.map((element) => element.type)).toEqual(["voice", "image", "text"]);
  });

  it("still requires the API key for reference-image renders", async () => {
    const fetchMock = vi.fn();
    const provider = new Json2VideoRenderProvider({ apiKey: "", templateId: "template-123", fetchFn: fetchMock });
    const error = await provider.renderShortVideo(
      scenes.map((scene) => ({ ...scene, imageUrl: "https://be-celeb.org/shorts-mascot/wave.png" })),
      voiceScript,
    ).catch((caught: unknown) => caught);

    expect((error as { code: string }).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
