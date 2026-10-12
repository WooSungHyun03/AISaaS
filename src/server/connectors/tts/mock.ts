import type { TtsProvider, TtsResult } from "./types";

export class MockTtsProvider implements TtsProvider {
  readonly name = "mock" as const;
  readonly spoken: string[] = [];

  async synthesize(text: string): Promise<TtsResult> {
    this.spoken.push(text);
    return { audio: new Uint8Array(2_048), characters: text.length };
  }
}
