export interface SpeechAudio {
  audio: Uint8Array;
  contentType: "audio/wav";
}

export interface SpeechSynthesizer {
  readonly enabled: boolean;
  synthesize(text: string): Promise<SpeechAudio>;
}
