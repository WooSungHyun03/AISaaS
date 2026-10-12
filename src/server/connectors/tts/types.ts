export interface TtsResult {
  /** MP3 bytes (44.1 kHz). */
  audio: Uint8Array;
  characters: number;
}

export interface TtsProvider {
  readonly name: "mock" | "elevenlabs";
  synthesize(text: string): Promise<TtsResult>;
}

/** Longest narration sent in one request (a 30 s Korean narration is well under this). */
export const TTS_MAX_CHARACTERS = 1_200;
