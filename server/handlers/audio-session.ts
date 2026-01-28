import type { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { getSTTProvider, type STTProvider, type STTProviderName } from "../stt";
import { storage } from "../storage";
import type { ActiveCoHostSession } from "./cohost-session";

type AudioSessionDeps = {
  deepgramApiKey?: string;
  elevenLabsApiKey?: string;
  activeCoHostSessions: Map<number, ActiveCoHostSession>;
  generateIncrementalTranscriptChunk: (showId: number, forceRemaining?: boolean) => Promise<void>;
};

/**
 * Creates the audio WebSocket handler for STT streaming sessions.
 */
export function createAudioSessionHandler(deps: AudioSessionDeps) {
  const { deepgramApiKey, elevenLabsApiKey, activeCoHostSessions, generateIncrementalTranscriptChunk } = deps;

  return (clientWs: WebSocket, request: IncomingMessage) => {
    // Get authenticated userId from upgrade request (set during upgrade)
    const authenticatedUserId = (request as any).authenticatedUserId as string;
    console.log("WebSocket client connected, userId:", authenticatedUserId);
  
    let sttProvider: STTProvider | null = null;
    let sttProviderName: STTProviderName = "deepgram";
    let sttReady = false;
    let currentShowId: number | null = null;
    let currentLanguage: string = "de-CH";
    let isRecordingActive = false;
    const audioQueue: Buffer[] = [];
  
    // Debug counters for diagnosing connection issues
    let audioChunksSent = 0;
    let audioChunksQueued = 0;
    let transcriptsReceived = 0;
    let lastReconnectAttempt = 0; // Throttle reconnect attempts
    const MAX_CONTROL_MESSAGE_BYTES = 8 * 1024;
    const MAX_AUDIO_CHUNK_BYTES = 1024 * 1024;

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;
  
    const resolveApiKey = (provider: STTProviderName): string | undefined => {
      if (provider === "elevenlabs") return elevenLabsApiKey;
      return deepgramApiKey;
    };
  
    const sendSttStatus = (type: string, extra?: Record<string, unknown>) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(JSON.stringify({ type, provider: sttProviderName, ...extra }));
    };
  
    const closeProvider = () => {
      if (sttProvider) {
        sttProvider.close();
        sttProvider = null;
      }
      sttReady = false;
    };
  
    const initProvider = async (language: string = "de-CH", provider: STTProviderName = sttProviderName) => {
      const apiKey = resolveApiKey(provider);
      if (!apiKey) {
        console.log(`No ${provider} API key`);
        sendSttStatus("stt.error", { message: `Missing ${provider} API key` });
        return;
      }
  
      // Close existing provider if switching
      if (!sttProvider || sttProviderName !== provider) {
        closeProvider();
        sttProviderName = provider;
        sttProvider = getSTTProvider(provider, apiKey);
      }
  
      currentLanguage = language;
  
      try {
        await sttProvider.connect(currentLanguage, async (result) => {
          const transcript = result.text;
          if (!transcript || transcript.trim().length === 0) return;
  
          if (result.isFinal) transcriptsReceived++;
  
          clientWs.send(JSON.stringify({
            type: result.isFinal ? "transcript.final" : "transcript.partial",
            text: transcript,
            speaker: result.speaker ?? null,
            timestamp: result.timestamp || new Date().toISOString(),
            speechDuration: result.isFinal ? result.speechDuration : undefined,
          }));
  
          if (result.isFinal) {
            // Store transcript in database
            try {
              await storage.createTranscriptSegment({
                text: transcript,
                showId: currentShowId,
                speaker: result.speaker ?? null,
                metadata: JSON.stringify({ language: currentLanguage, provider: sttProviderName }),
              });
  
              // Trigger incremental chunk generation in background (non-blocking)
              if (currentShowId !== null) {
                generateIncrementalTranscriptChunk(currentShowId).catch((e) => {
                  console.error("Error in incremental chunk generation:", e);
                });
              }
            } catch (error) {
              console.error("Error storing transcript:", error);
            }
  
            // Forward transcript to active Co-Host session (independent of storage success)
            if (currentShowId !== null) {
              const coHostSession = activeCoHostSessions.get(currentShowId);
              if (coHostSession) {
                console.log("Forwarding transcript to Co-Host:", transcript.substring(0, 50));
                coHostSession.sendTranscript(transcript, result.speaker ?? null).catch((e) => {
                  console.error("Error forwarding transcript to Co-Host:", e);
                });
              }
            }
          }
        }, (error) => {
          console.error("STT provider error:", error);
          sttReady = false;
          sendSttStatus("stt.disconnected", { message: error.message });
        });
  
        sttReady = true;
        sendSttStatus("stt.connected");
  
        // Flush queued audio
        const queuedCount = audioQueue.length;
        if (queuedCount > 0) {
          console.log(`[STT] Flushing ${queuedCount} queued audio chunks`);
        }
        while (audioQueue.length > 0) {
          const chunk = audioQueue.shift();
          if (chunk) {
            sttProvider.sendAudio(chunk);
            audioChunksSent++;
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error("Error connecting STT provider:", err);
        sendSttStatus("stt.error", { message: err.message });
        sttReady = false;
      }
    };
  
    // Send ready signal immediately
    clientWs.send(JSON.stringify({ type: "connection.ready" }));
  
    clientWs.on("message", async (message: Buffer | ArrayBuffer | string) => {
      // Debug: Log message type
      const msgType = typeof message === "string" ? "string" : (Buffer.isBuffer(message) ? "Buffer" : "ArrayBuffer");
      const msgLen = typeof message === "string" ? message.length : (Buffer.isBuffer(message) ? message.length : (message as ArrayBuffer).byteLength);
      if (msgLen < 500 || Math.random() < 0.01) {
        console.log(`[WS] Received message: type=${msgType}, length=${msgLen}`);
      }
  
      const handleStart = async (data: Record<string, unknown>) => {
        // Validate showId if provided - verify ownership with authenticatedUserId
        const showId = typeof data.showId === "number" && Number.isInteger(data.showId) ? data.showId : null;
        if (showId !== null) {
          const show = await storage.getShow(showId, authenticatedUserId);
          if (!show) {
            console.log("Invalid or unauthorized showId:", data.showId);
            clientWs.send(JSON.stringify({ type: "error", message: "Invalid show ID or not authorized" }));
            return;
          }
          currentShowId = showId;
        } else {
          currentShowId = null;
        }

        const lang = typeof data.language === "string" && data.language.length <= 16 ? data.language : "de-CH";
        const provider = data.provider === "elevenlabs" || data.provider === "deepgram" ? data.provider : "deepgram";
        console.log("Received start command, showId:", currentShowId, "language:", lang, "provider:", provider);
        isRecordingActive = true;
        await initProvider(lang, provider);
      };
  
      const handleStop = () => {
        console.log("Received stop command");
        isRecordingActive = false;
        closeProvider();
        sendSttStatus("stt.disconnected");
      };
  
      const handleReconnect = async () => {
        console.log("Received reconnect command, reinitializing STT...");
        closeProvider();
        sendSttStatus("stt.reconnecting");
        await initProvider(currentLanguage, sttProviderName);
      };
  
      // Handle text messages (commands)
      if (typeof message === "string") {
        if (message.length > MAX_CONTROL_MESSAGE_BYTES) {
          console.warn(`[WS] Ignoring oversized control message (${message.length} bytes)`);
          return;
        }
        console.log(`[WS] String message content: ${message.substring(0, 200)}`);
        try {
          const data = JSON.parse(message);
          if (!isRecord(data)) return;
          if (data.type === "start") {
            await handleStart(data);
            return;
          }
          if (data.type === "stop") {
            handleStop();
            return;
          }
          if (data.type === "reconnect") {
            await handleReconnect();
            return;
          }
        } catch (e) {
          // Not JSON, ignore
        }
        return;
      }
  
      // Check if Buffer starts with JSON
      if (Buffer.isBuffer(message) && message.length > 0 && message[0] === 123) {
        if (message.length > MAX_CONTROL_MESSAGE_BYTES) {
          console.warn(`[WS] Ignoring oversized control buffer (${message.length} bytes)`);
          return;
        }
        try {
          const data = JSON.parse(message.toString());
          if (!isRecord(data)) return;
          if (data.type === "start") {
            await handleStart(data);
            return;
          }
          if (data.type === "stop") {
            handleStop();
            return;
          }
          if (data.type === "reconnect") {
            await handleReconnect();
            return;
          }
        } catch (e) {
          // Not JSON, treat as audio
        }
      }
  
      const buffer = Buffer.isBuffer(message) ? message : Buffer.from(new Uint8Array(message));
      if (buffer.length > MAX_AUDIO_CHUNK_BYTES) {
        console.warn(`[AUDIO] Dropping oversized audio chunk (${buffer.length} bytes)`);
        return;
      }
  
      // Log first audio chunk to confirm audio is arriving and verify format
      if (audioChunksSent === 0 && audioChunksQueued === 0) {
        console.log(`[AUDIO] First audio chunk received: ${buffer.length} bytes, sttReady=${sttReady}, provider=${sttProviderName}, isRecordingActive=${isRecordingActive}`);
        const header = buffer.slice(0, 16);
        console.log(`[AUDIO DEBUG] First chunk header (hex): ${header.toString("hex")}`);
      }
  
      if (Math.random() < 0.02) {
        console.log(`Audio chunk received: ${buffer.length} bytes, sttReady=${sttReady}, provider=${sttProviderName}`);
      }
  
      if (sttProvider) {
        sttProvider.sendAudio(buffer);
        audioChunksSent++;
        if (audioChunksSent % 100 === 0) {
          console.log(`[AUDIO] Sent ${audioChunksSent} chunks to STT | Transcripts received: ${transcriptsReceived}`);
        }
      } else {
        audioQueue.push(buffer);
        audioChunksQueued++;
        if (audioQueue.length % 50 === 0) {
          console.log(`[AUDIO] Queued ${audioQueue.length} chunks, waiting for STT provider`);
        }
  
        const now = Date.now();
        if (!sttProvider && (now - lastReconnectAttempt) > 2000) {
          console.log(`[AUDIO] Audio arriving but no STT provider, auto-starting... (wasRecordingActive=${isRecordingActive})`);
          isRecordingActive = true;
          lastReconnectAttempt = now;
          sendSttStatus("stt.reconnecting");
          await initProvider(currentLanguage, sttProviderName);
        }
      }
    });
  
    clientWs.on("close", () => {
      console.log("WebSocket client disconnected");
      isRecordingActive = false;
      closeProvider();
  
      // Finalize any remaining transcript segments for this show
      if (currentShowId !== null) {
        console.log(`Finalizing transcript chunks for show ${currentShowId}`);
        generateIncrementalTranscriptChunk(currentShowId, true).catch(err => {
          console.error(`Error finalizing transcript chunks for show ${currentShowId}:`, err);
        });
      }
    });
  
    clientWs.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  };
}
