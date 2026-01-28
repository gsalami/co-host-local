import WebSocket from "ws";
import { ErrorCallback, STTProvider, TranscriptCallback } from "./types";

const ELEVENLABS_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const DEFAULT_MODEL_ID = "scribe_v2_realtime";
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_AUDIO_FORMAT = "pcm_16000";
const COMMIT_INTERVAL_MS = 20000;

type ElevenLabsWord = {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
};

type ElevenLabsMessage = {
  message_type?: string;
  text?: string;
  words?: ElevenLabsWord[];
  speaker?: number;
  error?: string;
  message?: string;
};

export class ElevenLabsProvider implements STTProvider {
  private readonly apiKey: string;
  private ws: WebSocket | null = null;
  private ready = false;
  private currentLanguage = "en";
  private onTranscript: TranscriptCallback | null = null;
  private onError: ErrorCallback | null = null;
  private audioQueue: Buffer[] = [];
  private active = false;
  private reconnecting = false;
  private lastCommitAt = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async connect(
    language: string,
    onTranscript: TranscriptCallback,
    onError: ErrorCallback
  ): Promise<void> {
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.active = true;

    if (this.ws && this.currentLanguage !== language) {
      this.close();
    }

    if (this.ws) return;

    if (!this.apiKey) {
      throw new Error("Missing ElevenLabs API key");
    }

    this.currentLanguage = language;
    await this.openWebSocket();
  }

  sendAudio(chunk: Buffer): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.sendAudioChunk(chunk);
      return;
    }

    this.audioQueue.push(chunk);
  }

  close(): void {
    this.active = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.ready = false;
  }

  private async openWebSocket(): Promise<void> {
    const languageCode = this.mapLanguage(this.currentLanguage);
    const params = new URLSearchParams({
      model_id: DEFAULT_MODEL_ID,
      audio_format: DEFAULT_AUDIO_FORMAT,
      include_timestamps: "true",
      commit_strategy: "manual",
    });

    if (languageCode) {
      params.set("language_code", languageCode);
    }

    const wsUrl = `${ELEVENLABS_WS_URL}?${params.toString()}`;

    this.ws = new WebSocket(wsUrl, {
      headers: {
        "xi-api-key": this.apiKey,
      },
    });

    console.log(`[ElevenLabs] Connecting to: ${wsUrl}`);
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("ElevenLabs WebSocket not initialized"));
      this.ws.once("open", () => {
        console.log("[ElevenLabs] WebSocket connected!");
        resolve();
      });
      this.ws.once("error", (err) => {
        console.error("[ElevenLabs] WebSocket connection error:", err);
        reject(err);
      });
    });

    if (!this.ws) return;

    this.ready = true;
    console.log("[ElevenLabs] Ready to receive audio");
    this.lastCommitAt = Date.now();
    this.flushAudioQueue();

    this.ws.on("message", (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on("error", (error) => {
      this.ready = false;
      if (this.onError) this.onError(error instanceof Error ? error : new Error(String(error)));
      this.forceClose();
    });

    this.ws.on("close", () => {
      this.ready = false;
      this.ws = null;
      if (this.active && !this.reconnecting) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("unexpected-response", (_req, res) => {
      const error = new Error(
        `ElevenLabs unexpected response: ${res.statusCode} ${res.statusMessage}`
      );
      if (this.onError) this.onError(error);
    });
  }

  private handleMessage(data: Buffer): void {
    let response: ElevenLabsMessage;
    try {
      response = JSON.parse(data.toString()) as ElevenLabsMessage;
      console.log(`[ElevenLabs] Received: ${response.message_type} | text: ${(response.text || "").substring(0, 80)}`);
    } catch (error) {
      if (this.onError) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.onError(err);
      }
      return;
    }

    const messageType = response.message_type ?? "";
    if (messageType.toLowerCase().includes("error")) {
      const errText = response.error || response.message || "ElevenLabs STT error";
      if (this.onError) this.onError(new Error(errText));
      return;
    }

    if (messageType === "partial_transcript") {
      this.emitTranscript(response.text, false, response, undefined, response.speaker);
      return;
    }

    if (messageType === "committed_transcript") {
      // Skip - we handle committed_transcript_with_timestamps instead to avoid duplicates
      return;
    }

    if (messageType === "committed_transcript_with_timestamps") {
      const speechDuration = this.calculateSpeechDuration(response.words);
      this.emitTranscript(response.text, true, response, speechDuration, response.speaker);
    }
  }

  private emitTranscript(
    text: string | undefined,
    isFinal: boolean,
    raw: ElevenLabsMessage,
    speechDuration?: number,
    speaker?: number
  ): void {
    if (!text || text.trim().length === 0) return;

    this.onTranscript?.({
      text,
      isFinal,
      speaker: speaker ?? null,
      timestamp: new Date().toISOString(),
      speechDuration: isFinal ? speechDuration : undefined,
      raw,
    });
  }

  private calculateSpeechDuration(words?: ElevenLabsWord[]): number | undefined {
    if (!words || words.length === 0) return undefined;
    let duration = 0;
    for (const word of words) {
      if (word.type === "word" && typeof word.start === "number" && typeof word.end === "number") {
        duration += word.end - word.start;
      }
    }
    return duration > 0 ? duration : undefined;
  }

  private chunksSent = 0;
  private sendAudioChunk(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const shouldCommit = now - this.lastCommitAt >= COMMIT_INTERVAL_MS;
    if (shouldCommit) {
      this.lastCommitAt = now;
    }

    // Check if audio is all zeros
    if (this.chunksSent === 0) {
      const isAllZeros = chunk.every(b => b === 0);
      console.log(`[ElevenLabs] First audio chunk: ${chunk.length} bytes, allZeros=${isAllZeros}, first16=${chunk.slice(0, 16).toString("hex")}`);
    }

    const payload = {
      message_type: "input_audio_chunk",
      audio_base_64: chunk.toString("base64"),
      sample_rate: DEFAULT_SAMPLE_RATE,
      commit: shouldCommit,
    };

    this.ws.send(JSON.stringify(payload));
    this.chunksSent++;
    if (this.chunksSent % 100 === 0) {
      console.log(`[ElevenLabs] Sent ${this.chunksSent} chunks to STT`);
    }
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk) {
        this.sendAudioChunk(chunk);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.forceClose();
    setTimeout(() => {
      this.reconnecting = false;
      if (this.active) {
        this.openWebSocket().catch((error) => {
          if (this.onError) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.onError(err);
          }
        });
      }
    }, 500);
  }

  private forceClose(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.ready = false;
  }

  private mapLanguage(language: string): string {
    if (!language) return "";
    const normalized = language.toLowerCase();
    if (normalized.startsWith("de")) return "de";
    if (normalized.startsWith("en")) return "en";
    if (normalized === "gsw") return "de";
    return normalized;
  }
}
