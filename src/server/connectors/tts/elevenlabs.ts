import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import { TTS_MAX_CHARACTERS, type TtsProvider, type TtsResult } from "./types";

const REQUEST_TIMEOUT_MS = 60_000;

/** ElevenLabs text-to-speech. https://elevenlabs.io/docs/api-reference/text-to-speech/convert */
export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs" as const;
  private readonly apiKey: string | undefined;
  private readonly voiceId: string | undefined;
  private readonly modelId: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: { apiKey?: string; voiceId?: string; modelId?: string; fetchFn?: typeof fetch } = {}) {
    this.apiKey = options.apiKey ?? serverEnv.ELEVENLABS_API_KEY;
    this.voiceId = options.voiceId ?? serverEnv.TTS_VOICE_ID;
    this.modelId = options.modelId ?? serverEnv.TTS_MODEL_ID;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async synthesize(text: string): Promise<TtsResult> {
    if (!this.apiKey || !this.voiceId) {
      throw new ConnectorError("elevenlabs", "NOT_CONFIGURED", "음성 서비스 설정이 없습니다. ELEVENLABS_API_KEY와 TTS_VOICE_ID를 확인해주세요.");
    }
    const narration = text.trim();
    if (!narration || narration.length > TTS_MAX_CHARACTERS) {
      throw new ConnectorError("elevenlabs", "INVALID_TARGET", "나레이션 글이 비었거나 너무 길어요.");
    }
    let response: Response;
    try {
      response = await this.fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: narration, model_id: this.modelId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new ConnectorError("elevenlabs", "TIMEOUT", "음성 만들기가 늦어져 중단했어요.", { cause });
      }
      throw new ConnectorError("elevenlabs", "NETWORK_FAILURE", "음성 서비스에 연결하지 못했어요.", { cause });
    }
    if (!response.ok) throw new ConnectorError("elevenlabs", classifyHttpStatus(response.status), `음성을 만들지 못했어요. (HTTP ${response.status})`);
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.length < 1_000) throw new ConnectorError("elevenlabs", "UPSTREAM_SERVER_ERROR", "음성 서비스가 빈 음성을 돌려줬어요.");
    return { audio, characters: narration.length };
  }
}
