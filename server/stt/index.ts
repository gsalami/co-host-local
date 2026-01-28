import { DeepgramProvider } from "./deepgram";
import { ElevenLabsProvider } from "./elevenlabs";
import { STTProvider } from "./types";

export type STTProviderName = "deepgram" | "elevenlabs";

export function getSTTProvider(provider: STTProviderName, apiKey: string): STTProvider {
  switch (provider) {
    case "deepgram":
      return new DeepgramProvider(apiKey);
    case "elevenlabs":
      return new ElevenLabsProvider(apiKey);
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export type { STTProvider } from "./types";
