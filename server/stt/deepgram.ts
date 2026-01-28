import WebSocket from "ws";
import { ErrorCallback, STTProvider, TranscriptCallback } from "./types";

type DeepgramAlt = {
  transcript?: string;
  words?: Array<{ start?: number; end?: number; speaker?: number }>;
};

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: DeepgramAlt[];
  };
};

const DEEPGRAM_HEALTH_TIMEOUT_MS = 120000;
const KEEPALIVE_INTERVAL_MS = 5000;

export class DeepgramProvider implements STTProvider {
  private readonly apiKey: string;
  private ws: WebSocket | null = null;
  private ready = false;
  private currentLanguage = "de-CH";
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private lastResponseAt = Date.now();
  private audioQueue: Buffer[] = [];
  private active = false;
  private onTranscript: TranscriptCallback | null = null;
  private onError: ErrorCallback | null = null;
  private reconnecting = false;

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
      throw new Error("Missing Deepgram API key");
    }

    this.currentLanguage = language;
    await this.openWebSocket();
  }

  sendAudio(chunk: Buffer): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      return;
    }

    this.audioQueue.push(chunk);
  }

  close(): void {
    this.active = false;
    this.stopKeepalive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.ready = false;
  }

  private async openWebSocket(): Promise<void> {
    const deepgramLanguage = this.currentLanguage === "gsw" ? "de-CH" : this.currentLanguage;
    const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=${deepgramLanguage}&diarize=true`;

    this.ws = new WebSocket(dgUrl, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("Deepgram WebSocket not initialized"));
      this.ws.once("open", () => resolve());
      this.ws.once("error", (err) => reject(err));
    });

    if (!this.ws) return;

    this.ready = true;
    this.flushAudioQueue();
    this.startKeepalive();

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
      this.stopKeepalive();
      this.ws = null;
      if (this.active && !this.reconnecting) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("unexpected-response", (_req, res) => {
      const error = new Error(`Deepgram unexpected response: ${res.statusCode} ${res.statusMessage}`);
      if (this.onError) this.onError(error);
    });
  }

  private handleMessage(data: Buffer): void {
    this.lastResponseAt = Date.now();

    let response: DeepgramMessage;
    try {
      response = JSON.parse(data.toString()) as DeepgramMessage;
    } catch (error) {
      if (this.onError) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.onError(err);
      }
      return;
    }

    if (response.type === "KeepAlive") {
      return;
    }

    const alternative = response.channel?.alternatives?.[0];
    const transcript = alternative?.transcript;
    const isFinal = Boolean(response.is_final);

    const words = alternative?.words ?? [];
    let speaker: number | null = null;
    if (words.length > 0 && words[0].speaker !== undefined) {
      speaker = words[0].speaker ?? null;
    }

    let speechDuration = 0;
    for (const word of words) {
      if (typeof word.start === "number" && typeof word.end === "number") {
        speechDuration += word.end - word.start;
      }
    }

    if (transcript && transcript.trim().length > 0) {
      this.onTranscript?.({
        text: transcript,
        isFinal,
        speaker,
        timestamp: new Date().toISOString(),
        speechDuration: isFinal ? speechDuration : undefined,
        raw: response,
      });
    }
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(chunk);
      }
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastResponseAt = Date.now();
    this.keepaliveInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (this.active) {
          this.scheduleReconnect();
        }
        return;
      }

      this.ws.send(JSON.stringify({ type: "KeepAlive" }));

      const timeSinceLastResponse = Date.now() - this.lastResponseAt;
      if (timeSinceLastResponse > DEEPGRAM_HEALTH_TIMEOUT_MS) {
        this.scheduleReconnect();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
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
    this.stopKeepalive();
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
}
