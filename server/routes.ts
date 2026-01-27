import type { Express } from "express";
import { createServer, type Server, type IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./auth";
import {
  chunkSourceText,
  generateEmbedding,
  retrieveRelevantSourceChunks
} from "./gemini-service";
import { sql, eq } from "drizzle-orm";
import { db } from "./db";
import { sessions } from "@shared/models/auth";
import cookieSignature from "cookie-signature";

// Helper function to extract authenticated userId from WebSocket upgrade request cookies
async function extractUserIdFromRequest(request: IncomingMessage): Promise<string | null> {
  try {
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      console.error("SESSION_SECRET not configured");
      return null;
    }
    
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;
    
    // Parse cookies to find session ID (connect.sid)
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, val] = cookie.trim().split('=');
      if (key && val) acc[key] = decodeURIComponent(val);
      return acc;
    }, {} as Record<string, string>);
    
    // Session cookie is typically 's:sessionId.signature' encoded
    const sessionCookie = cookies['connect.sid'];
    if (!sessionCookie) return null;
    
    // Check for signed cookie format (starts with 's:')
    if (!sessionCookie.startsWith('s:')) {
      console.log("Session cookie is not signed, rejecting");
      return null;
    }
    
    // Extract the signed value (remove 's:' prefix)
    const signedValue = sessionCookie.slice(2);
    
    // Validate signature using cookie-signature
    const sessionId = cookieSignature.unsign(signedValue, sessionSecret);
    if (sessionId === false) {
      console.log("Session cookie signature verification failed");
      return null;
    }
    
    // Query the sessions table for this session ID
    const sessionRows = await db
      .select({ sess: sessions.sess, expire: sessions.expire })
      .from(sessions)
      .where(eq(sessions.sid, sessionId))
      .limit(1);
    
    if (sessionRows.length === 0) {
      console.log("Session not found in database");
      return null;
    }
    
    // Check if session has expired
    const sessionRow = sessionRows[0];
    if (sessionRow.expire && new Date(sessionRow.expire) < new Date()) {
      console.log("Session has expired");
      return null;
    }
    
    const sessionData = sessionRow.sess as any;

    // Extract userId from passport session data (simple local auth)
    const userId = sessionData?.passport?.user;
    if (!userId) {
      console.log("No userId found in session data");
      return null;
    }
    
    return userId;
  } catch (error) {
    console.error("Error extracting userId from WebSocket request:", error);
    return null;
  }
}

// Minimum tokens needed to create a new transcript chunk
const MIN_TOKENS_FOR_CHUNK = 200;
const TARGET_TOKENS_PER_CHUNK = 450;

// Helper function to generate chunks for all available transcript segments
// Loops until all segments above minimum threshold are processed
// forceRemaining: if true, process all remaining segments even if below threshold (for session end)
async function generateIncrementalTranscriptChunk(showId: number, forceRemaining: boolean = false): Promise<void> {
  try {
    const { generateEmbedding } = await import("./gemini-service");
    
    // Keep processing until we run out of segments or fall below minimum threshold
    while (true) {
      // Get the last segment ID that was chunked
      const lastChunkedId = await storage.getLastChunkedSegmentId(showId);
      
      // Get all segments after the last chunked one (or all if no chunks exist)
      const newSegments = lastChunkedId 
        ? await storage.getSegmentsAfter(showId, lastChunkedId)
        : await storage.getAllTranscriptSegments(showId);
      
      if (newSegments.length === 0) return;
      
      // Combine text from new segments
      const combinedText = newSegments.map(s => s.text).join(" ");
      
      // Check if we have enough text for a chunk (rough estimate: 4 chars per token)
      const estimatedTokens = Math.ceil(combinedText.length / 4);
      
      // If below threshold and not forcing, wait for more segments
      if (estimatedTokens < MIN_TOKENS_FOR_CHUNK && !forceRemaining) {
        return;
      }
      
      // Skip only truly empty content (empty string after trim)
      if (combinedText.trim().length === 0) {
        return;
      }
      
      // Find how many segments to use for this chunk (target ~450 tokens)
      let chunkText = combinedText;
      let lastSegmentIndex = newSegments.length - 1;
      
      if (estimatedTokens > TARGET_TOKENS_PER_CHUNK) {
        let accumulatedText = "";
        for (let i = 0; i < newSegments.length; i++) {
          const testText = accumulatedText + " " + newSegments[i].text;
          const testTokens = Math.ceil(testText.length / 4);
          if (testTokens > TARGET_TOKENS_PER_CHUNK && i > 0) {
            lastSegmentIndex = i - 1;
            break;
          }
          accumulatedText = testText.trim();
          lastSegmentIndex = i;
        }
        chunkText = accumulatedText;
      }
      
      console.log(`Creating incremental chunk for show ${showId}: segments ${newSegments[0].id}-${newSegments[lastSegmentIndex].id}${forceRemaining ? " (finalization)" : ""}`);
      
      // Get the next chunk index
      const chunkIndex = await storage.getNextChunkIndex(showId);
      
      try {
        // Generate embedding
        const embeddingResult = await generateEmbedding(chunkText);
        
        // Create chunk with correct segment range
        await storage.createTranscriptChunk({
          showId,
          chunkIndex,
          text: chunkText,
          startSegmentId: newSegments[0].id,
          endSegmentId: newSegments[lastSegmentIndex].id,
          embedding: JSON.stringify(embeddingResult.embedding),
          tokenCount: embeddingResult.tokenCount
        });
        
        console.log(`Created transcript chunk ${chunkIndex} for show ${showId} (${embeddingResult.tokenCount} tokens)`);
      } catch (err) {
        console.error(`Error creating transcript chunk for show ${showId}:`, err);
        return; // Stop on error to avoid infinite loop
      }
      
      // If we processed all segments, we're done
      if (lastSegmentIndex === newSegments.length - 1) {
        return;
      }
      // Otherwise, loop to process remaining segments
    }
  } catch (err) {
    console.error(`Error in incremental chunk generation for show ${showId}:`, err);
  }
}

// Helper function to generate embeddings for a source
async function generateSourceEmbeddings(sourceId: number, textContent: string): Promise<void> {
  if (!textContent || textContent.trim().length === 0) {
    console.log(`Source ${sourceId} has no content, skipping embedding generation`);
    return;
  }

  console.log(`Generating embeddings for source ${sourceId}...`);
  
  // Delete existing chunks for this source
  await storage.deleteSourceChunks(sourceId);
  
  // Chunk the text
  const chunks = await chunkSourceText(textContent);
  console.log(`Created ${chunks.length} chunks for source ${sourceId}`);
  
  // Create chunks and generate embeddings
  for (const chunk of chunks) {
    const created = await storage.createSourceChunk({
      sourceId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
      embedding: null,
    });
    
    // Generate embedding
    try {
      const embeddingResult = await generateEmbedding(chunk.text);
      await storage.updateSourceChunkEmbedding(created.id, JSON.stringify(embeddingResult.embedding));
    } catch (err) {
      console.error(`Error generating embedding for chunk ${chunk.chunkIndex} of source ${sourceId}:`, err);
    }
  }
  
  console.log(`Finished generating embeddings for source ${sourceId}`);
}

// Shared state for real-time transcript sync between audio and Co-Host sessions
// Maps showId -> { geminiSession, sendTranscript function }
interface ActiveCoHostSession {
  sendTranscript: (text: string, speaker: number | null) => Promise<void>;
}
const activeCoHostSessions = new Map<number, ActiveCoHostSession>();

// In-memory store for large context payloads (to bypass WebSocket size limits)
// Maps contextId -> contextData, expires after 5 minutes
interface StoredContext {
  text?: string;
  files?: Array<{ name: string; type: string; data: string }>;
  sourceIds?: number[];
  createdAt: number;
}
const contextStore = new Map<string, StoredContext>();
const CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 minutes (increased for reliability)
const MAX_CONTEXT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB max per context
const MAX_CONTEXT_ENTRIES = 20; // Max concurrent contexts in store

// Clean up expired contexts every minute (runs once globally, not per route registration)
let contextCleanupStarted = false;
function startContextCleanup() {
  if (contextCleanupStarted) return;
  contextCleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    const entries = Array.from(contextStore.entries());
    for (const [id, ctx] of entries) {
      if (now - ctx.createdAt > CONTEXT_TTL_MS) {
        console.log(`Cleaning up expired context ${id}`);
        contextStore.delete(id);
      }
    }
  }, 60 * 1000);
}
startContextCleanup();

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const googleAiApiKey = process.env.GOOGLE_AI_API_KEY;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});


// Admin middleware - checks if user has admin role
const isAdmin = async (req: any, res: any, next: any) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(403).json({ message: "Access denied. User not found." });
  }
  
  const user = await storage.getUser(userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: "Access denied. Admin privileges required." });
  }
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication (must be before other routes)
  setupAuth(app);

  // WebSocket server for audio streaming
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (clientWs: WebSocket, request: IncomingMessage) => {
    // Get authenticated userId from upgrade request (set during upgrade)
    const authenticatedUserId = (request as any).authenticatedUserId as string;
    console.log("WebSocket client connected, userId:", authenticatedUserId);
    
    let deepgramWs: WebSocket | null = null;
    let deepgramReady = false;
    let currentShowId: number | null = null;
    let currentLanguage: string = "de-CH";
    let isRecordingActive = false; // Track if recording is in progress
    let keepaliveInterval: NodeJS.Timeout | null = null;
    let lastDeepgramResponse: number = Date.now(); // Track last response for health check
    let isHealthCheckReconnect = false; // Prevent double reconnect from health check + close handler
    const DEEPGRAM_HEALTH_TIMEOUT_MS = 120000; // 2 minutes timeout (silence during pauses is normal)
    const audioQueue: Buffer[] = [];
    
    // Debug counters for diagnosing connection issues
    let audioChunksSent = 0;
    let audioChunksQueued = 0;
    let transcriptsReceived = 0;
    let keepalivesSent = 0;
    let keepalivesReceived = 0;
    let lastMessageType = "none";
    let lastReconnectAttempt = 0; // Throttle reconnect attempts

    const stopKeepalive = () => {
      if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
      }
    };

    const closeDeepgram = () => {
      stopKeepalive();
      if (deepgramWs) {
        deepgramWs.close();
        deepgramWs = null;
        deepgramReady = false;
      }
    };

    const initDeepgram = (language: string = "de-CH") => {
      // Close existing connection if language changed
      if (deepgramWs && currentLanguage !== language) {
        console.log("Language changed, closing existing Deepgram connection");
        closeDeepgram();
      }
      
      if (deepgramWs) return;
      if (!deepgramApiKey) {
        console.log("No Deepgram API key");
        return;
      }
      
      currentLanguage = language;
      
      // Map language codes to Deepgram-supported codes
      // gsw (Swiss German dialect) is not supported by Deepgram, use de-CH instead
      const deepgramLanguage = language === "gsw" ? "de-CH" : language;
      console.log("Connecting to Deepgram with language:", deepgramLanguage, "(original:", language, ")");
      
      // Direct WebSocket connection to Deepgram with speaker diarization
      // encoding=webm tells Deepgram to expect WebM container format (not raw opus)
      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=${deepgramLanguage}&diarize=true&encoding=webm`;
      deepgramWs = new WebSocket(dgUrl, {
        headers: {
          Authorization: `Token ${deepgramApiKey}`,
        },
      });

      deepgramWs.on("open", () => {
        console.log("Deepgram WebSocket opened");
        deepgramReady = true;
        
        // Notify client that Deepgram is connected
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "deepgram.connected" }));
        }
        
        // Immediately flush queued audio
        const queuedCount = audioQueue.length;
        console.log(`[DEEPGRAM] Flushing ${queuedCount} queued audio chunks`);
        while (audioQueue.length > 0) {
          const chunk = audioQueue.shift();
          if (chunk && deepgramWs?.readyState === WebSocket.OPEN) {
            deepgramWs.send(chunk);
            audioChunksSent++;
          }
        }
        if (queuedCount > 0) {
          console.log(`[DEEPGRAM] Flushed ${queuedCount} chunks, audioChunksSent now: ${audioChunksSent}`);
        }
        
        // Start keepalive interval - send KeepAlive message every 5 seconds
        // Also check health: if no response in 2 minutes, reconnect (silence during pauses is normal)
        stopKeepalive();
        lastDeepgramResponse = Date.now(); // Reset on connection
        isHealthCheckReconnect = false; // Reset flag on new connection
        keepaliveInterval = setInterval(() => {
          // PROACTIVE CHECK: Detect if connection died silently (no close event)
          if (!deepgramWs || deepgramWs.readyState !== WebSocket.OPEN) {
            const wsState = deepgramWs?.readyState;
            const stateNames: { [key: number]: string } = {
              0: "CONNECTING",
              1: "OPEN", 
              2: "CLOSING",
              3: "CLOSED"
            };
            console.warn(`[HEALTH] Deepgram WebSocket is not open (ready=${deepgramReady}, state=${wsState}/${stateNames[wsState ?? -1] || 'null'}, wsExists=${!!deepgramWs})`);
            
            // Skip reconnect if still connecting (give it time)
            if (wsState === WebSocket.CONNECTING) {
              console.log("[HEALTH] Still connecting, waiting...");
              return;
            }
            
            // Reconnect if recording is active but connection is dead/null/closing/closed
            if (isRecordingActive && clientWs.readyState === WebSocket.OPEN) {
              console.log("[HEALTH] Connection lost or not open, forcing reconnect...");
              deepgramReady = false;
              
              // Clean up existing dead connection if it exists
              if (deepgramWs) {
                try {
                  deepgramWs.close();
                } catch (e) {
                  // Ignore close errors on dead connection
                }
                deepgramWs = null;
              }
              
              clientWs.send(JSON.stringify({ type: "deepgram.reconnecting" }));
              initDeepgram(currentLanguage);
            }
            return; // Skip rest of keepalive
          }
          
          // Send Deepgram KeepAlive message (JSON format)
          deepgramWs.send(JSON.stringify({ type: "KeepAlive" }));
          keepalivesSent++;
          const timeSinceLastResponse = Date.now() - lastDeepgramResponse;
          console.log(`[DEEPGRAM STATUS] KeepAlive #${keepalivesSent} | Last response: ${Math.round(timeSinceLastResponse / 1000)}s ago | Last msg type: ${lastMessageType} | Audio sent: ${audioChunksSent} | Queued: ${audioChunksQueued} | Transcripts: ${transcriptsReceived} | KA received: ${keepalivesReceived}`);
          
          // Health check: if no response in 2 minutes, trigger reconnect
          if (timeSinceLastResponse > DEEPGRAM_HEALTH_TIMEOUT_MS) {
            console.warn(`Deepgram health check failed: no response for ${Math.round(timeSinceLastResponse / 1000)}s, forcing reconnect`);
            
            // Notify client about health timeout
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ 
                type: "deepgram.health_timeout",
                lastResponseSeconds: Math.round(timeSinceLastResponse / 1000)
              }));
            }
            
            // Set flag to prevent double reconnect from close handler
            isHealthCheckReconnect = true;
            
            // Force close and reconnect
            closeDeepgram();
            
            if (isRecordingActive && clientWs.readyState === WebSocket.OPEN) {
              console.log("Recording active, reconnecting after health timeout...");
              setTimeout(() => {
                if (isRecordingActive && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ type: "deepgram.reconnecting" }));
                  initDeepgram(currentLanguage);
                }
              }, 500);
            }
          }
        }, 5000);
      });

      deepgramWs.on("message", async (data: Buffer) => {
        try {
          // Update last response timestamp for health check
          lastDeepgramResponse = Date.now();
          
          const response = JSON.parse(data.toString());
          
          // Track message type for debugging
          lastMessageType = response.type || (response.channel ? "transcript" : "unknown");
          
          // Handle KeepAlive response from Deepgram
          if (response.type === "KeepAlive") {
            keepalivesReceived++;
            console.log(`[DEEPGRAM] KeepAlive response received (#${keepalivesReceived})`);
            return;
          }
          
          // Log all non-transcript messages for debugging
          if (!response.channel) {
            console.log(`[DEEPGRAM] Received message type: ${response.type || 'unknown'}`, JSON.stringify(response).substring(0, 200));
          }
          
          const alternative = response.channel?.alternatives?.[0];
          const transcript = alternative?.transcript;
          const isFinal = response.is_final;
          
          // Extract speaker info from words
          const words = alternative?.words || [];
          let speaker: number | null = null;
          if (words.length > 0 && words[0].speaker !== undefined) {
            speaker = words[0].speaker;
          }
          
          // Calculate speech duration by summing individual word durations
          // This excludes pauses/silence between words - only actual speech is counted
          let speechDuration = 0;
          for (const word of words) {
            if (typeof word.start === 'number' && typeof word.end === 'number') {
              speechDuration += word.end - word.start;
            }
          }
          
          if (transcript) {
            if (isFinal) transcriptsReceived++;
            console.log(`[DEEPGRAM] Transcript #${transcriptsReceived}: "${transcript.substring(0, 50)}${transcript.length > 50 ? '...' : ''}" | Speaker: ${speaker} | Final: ${isFinal} | Duration: ${speechDuration.toFixed(2)}s`);
          }
          
          if (transcript && transcript.trim().length > 0) {
            clientWs.send(JSON.stringify({
              type: isFinal ? "transcript.final" : "transcript.partial",
              text: transcript,
              speaker: speaker,
              timestamp: new Date().toISOString(),
              speechDuration: isFinal ? speechDuration : undefined, // Only send duration for final transcripts
            }));

            if (isFinal) {
              // Store transcript in database
              try {
                await storage.createTranscriptSegment({
                  text: transcript,
                  showId: currentShowId,
                  speaker: speaker,
                  metadata: JSON.stringify({ language: currentLanguage }),
                });
                
                // Trigger incremental chunk generation in background (non-blocking)
                if (currentShowId !== null) {
                  generateIncrementalTranscriptChunk(currentShowId).catch(e => {
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
                  coHostSession.sendTranscript(transcript, speaker).catch(e => {
                    console.error("Error forwarding transcript to Co-Host:", e);
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error("Error parsing Deepgram message:", error);
        }
      });

      deepgramWs.on("error", (error) => {
        console.error("[DEEPGRAM ERROR]", error);
        deepgramReady = false;
        
        // Force close on error - this triggers the close handler for proper cleanup
        if (deepgramWs) {
          try {
            deepgramWs.close();
          } catch (e) {
            console.error("[DEEPGRAM ERROR] Error closing WebSocket:", e);
          }
          deepgramWs = null;
        }
      });

      deepgramWs.on("close", (code, reason) => {
        const reasonStr = reason?.toString() || "unknown";
        console.log(`[DEEPGRAM CLOSED] Code: ${code} | Reason: ${reasonStr} | Audio sent: ${audioChunksSent} | Transcripts: ${transcriptsReceived} | KA sent/received: ${keepalivesSent}/${keepalivesReceived}`);
        
        // Log common close codes
        const closeCodeMeaning: { [key: number]: string } = {
          1000: "Normal closure",
          1001: "Going away",
          1002: "Protocol error",
          1003: "Unsupported data",
          1006: "Abnormal closure (no close frame)",
          1007: "Invalid payload",
          1008: "Policy violation",
          1009: "Message too big",
          1011: "Server error",
          1015: "TLS handshake failure"
        };
        if (closeCodeMeaning[code]) {
          console.log(`Close code ${code} means: ${closeCodeMeaning[code]}`);
        }
        
        deepgramReady = false;
        deepgramWs = null;
        stopKeepalive();
        
        // Notify client about disconnection with details
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ 
            type: "deepgram.disconnected", 
            code, 
            reason: reasonStr,
            meaning: closeCodeMeaning[code] || "Unknown"
          }));
        }
        
        // Auto-reconnect if recording is still active
        // Skip if health check already triggered a reconnect (prevent double reconnect)
        if (isRecordingActive && clientWs.readyState === WebSocket.OPEN && !isHealthCheckReconnect) {
          console.log("Recording active, auto-reconnecting to Deepgram in 1 second...");
          setTimeout(() => {
            if (isRecordingActive && clientWs.readyState === WebSocket.OPEN) {
              console.log("Attempting Deepgram reconnect...");
              initDeepgram(currentLanguage);
              // Notify client about reconnection
              clientWs.send(JSON.stringify({ type: "deepgram.reconnecting" }));
            }
          }, 1000);
        } else if (isHealthCheckReconnect) {
          console.log("Close triggered by health check - reconnect already handled");
        }
        
        // Reset flag after processing close
        isHealthCheckReconnect = false;
      });
      
      deepgramWs.on("unexpected-response", (req, res) => {
        console.error("Deepgram unexpected response:", res.statusCode, res.statusMessage);
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => { console.error("Response body:", body); });
      });
    };
    
    // Send ready signal immediately
    clientWs.send(JSON.stringify({ type: "connection.ready" }));

    clientWs.on("message", async (message: Buffer | ArrayBuffer | string) => {
      // Debug: Log message type
      const msgType = typeof message === 'string' ? 'string' : (Buffer.isBuffer(message) ? 'Buffer' : 'ArrayBuffer');
      const msgLen = typeof message === 'string' ? message.length : (Buffer.isBuffer(message) ? message.length : (message as ArrayBuffer).byteLength);
      if (msgLen < 500 || Math.random() < 0.01) {
        console.log(`[WS] Received message: type=${msgType}, length=${msgLen}`);
      }
      
      // Handle text messages (commands)
      if (typeof message === 'string') {
        console.log(`[WS] String message content: ${message.substring(0, 200)}`);
        try {
          const data = JSON.parse(message);
          if (data.type === "start") {
            // Validate showId if provided - verify ownership with authenticatedUserId
            if (data.showId) {
              const show = await storage.getShow(data.showId, authenticatedUserId);
              if (!show) {
                console.log("Invalid or unauthorized showId:", data.showId);
                clientWs.send(JSON.stringify({ type: "error", message: "Invalid show ID or not authorized" }));
                return;
              }
              currentShowId = data.showId;
            } else {
              currentShowId = null;
            }
            const lang = data.language || "de-CH";
            console.log("Received start command, showId:", currentShowId, "language:", lang, "initializing Deepgram...");
            isRecordingActive = true;
            initDeepgram(lang);
            return;
          }
          if (data.type === "stop") {
            console.log("Received stop command");
            isRecordingActive = false;
            closeDeepgram();
            return;
          }
          if (data.type === "reconnect") {
            console.log("Received reconnect command, reinitializing Deepgram...");
            closeDeepgram();
            initDeepgram(currentLanguage);
            return;
          }
        } catch (e) {
          // Not JSON, ignore
        }
        return;
      }
      
      // Check if Buffer starts with JSON
      if (Buffer.isBuffer(message) && message.length > 0 && message[0] === 123) {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === "start") {
            // Validate showId if provided - verify ownership with authenticatedUserId
            if (data.showId) {
              const show = await storage.getShow(data.showId, authenticatedUserId);
              if (!show) {
                console.log("Invalid or unauthorized showId:", data.showId);
                clientWs.send(JSON.stringify({ type: "error", message: "Invalid show ID or not authorized" }));
                return;
              }
              currentShowId = data.showId;
            } else {
              currentShowId = null;
            }
            const lang = data.language || "de-CH";
            console.log("Received start command, showId:", currentShowId, "language:", lang, "initializing Deepgram...");
            isRecordingActive = true;
            initDeepgram(lang);
            return;
          }
          if (data.type === "stop") {
            console.log("Received stop command");
            isRecordingActive = false;
            closeDeepgram();
            return;
          }
          if (data.type === "reconnect") {
            console.log("Received reconnect command, reinitializing Deepgram...");
            closeDeepgram();
            initDeepgram(currentLanguage);
            return;
          }
        } catch (e) {
          // Not JSON, treat as audio
        }
      }
      
      const buffer = Buffer.isBuffer(message) ? message : Buffer.from(new Uint8Array(message));
      
      // Log first audio chunk to confirm audio is arriving and verify format
      if (audioChunksSent === 0 && audioChunksQueued === 0) {
        console.log(`[AUDIO] First audio chunk received: ${buffer.length} bytes, deepgramReady=${deepgramReady}, wsState=${deepgramWs?.readyState}, isRecordingActive=${isRecordingActive}`);
        // Debug: Log first 16 bytes as hex to verify WebM format
        const header = buffer.slice(0, 16);
        console.log(`[AUDIO DEBUG] First chunk header (hex): ${header.toString('hex')}`);
        console.log(`[AUDIO DEBUG] WebM magic should start with: 1a45dfa3`);
      }
      
      // Debug: Log audio chunk receipt (every 50th chunk to avoid spam)
      if (Math.random() < 0.02) {
        console.log(`Audio chunk received: ${buffer.length} bytes, deepgramReady=${deepgramReady}, wsState=${deepgramWs?.readyState}`);
      }
      
      // Send or queue audio
      if (deepgramReady && deepgramWs?.readyState === WebSocket.OPEN) {
        deepgramWs.send(buffer);
        audioChunksSent++;
        // Log every 100th chunk for visibility
        if (audioChunksSent % 100 === 0) {
          console.log(`[AUDIO] Sent ${audioChunksSent} chunks to Deepgram | Transcripts received: ${transcriptsReceived}`);
        }
      } else {
        // Queue for when connection opens
        audioQueue.push(buffer);
        audioChunksQueued++;
        if (audioQueue.length % 50 === 0) {
          console.log(`[AUDIO] Queued ${audioQueue.length} chunks, waiting for Deepgram (deepgramReady=${deepgramReady}, wsState=${deepgramWs?.readyState})`);
        }
        
        // PROACTIVE RECONNECT: If audio is arriving but no Deepgram connection, start one immediately
        // This handles the case where start command was lost or client resumed without explicit start
        // Throttle: only reconnect if last attempt was > 2 seconds ago
        const now = Date.now();
        if (!deepgramWs && (now - lastReconnectAttempt) > 2000) {
          console.log(`[AUDIO] Audio arriving but no Deepgram connection, auto-starting... (wasRecordingActive=${isRecordingActive})`);
          // Audio arriving means recording is happening, set the flag
          isRecordingActive = true;
          lastReconnectAttempt = now;
          clientWs.send(JSON.stringify({ type: "deepgram.reconnecting" }));
          initDeepgram(currentLanguage);
        }
      }
    });

    clientWs.on("close", () => {
      console.log("WebSocket client disconnected");
      isRecordingActive = false;
      closeDeepgram();
      
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
  });

  // WebSocket server for Co-Host (Gemini 2.5 Flash Live API)
  // Set maxPayload to 10MB to handle large context payloads
  const cohostWss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });
  
  // Handle upgrade events manually for both WebSocket paths
  httpServer.on("upgrade", async (request, socket, head) => {
    const pathname = request.url;
    
    if (pathname === "/ws/audio") {
      console.log("Upgrading to Audio WebSocket");
      // Extract authenticated userId before upgrade
      const userId = await extractUserIdFromRequest(request);
      if (!userId) {
        console.log("Rejecting unauthenticated Audio WebSocket connection");
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      (request as any).authenticatedUserId = userId;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else if (pathname === "/ws/cohost") {
      console.log("Upgrading to Co-Host WebSocket");
      // Extract authenticated userId before upgrade
      const userId = await extractUserIdFromRequest(request);
      if (!userId) {
        console.log("Rejecting unauthenticated Co-Host WebSocket connection");
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      (request as any).authenticatedUserId = userId;
      cohostWss.handleUpgrade(request, socket, head, (ws) => {
        cohostWss.emit("connection", ws, request);
      });
    }
    // Other upgrade requests (like Vite HMR) are handled by their respective handlers
  });

  cohostWss.on("connection", async (clientWs: WebSocket, request: IncomingMessage) => {
    // Get authenticated userId from upgrade request (set during upgrade)
    const authenticatedUserId = (request as any).authenticatedUserId as string;
    console.log("Co-Host WebSocket client connected, userId:", authenticatedUserId);
    
    let geminiSession: any = null;
    let currentShowId: number | null = null;
    let currentUserId: string | null = authenticatedUserId; // Use authenticated userId from session
    let sessionActive = false;
    let turnCounter = 0; // Turn counter for audio sequencing
    let isInterrupted = false; // Flag to track if current turn was interrupted
    let interruptTimeout: NodeJS.Timeout | null = null; // Timeout to clear interrupt flag
    let sessionStartTime: number | null = null; // Track when session started (for elapsed timer)
    let voiceElapsedInterval: NodeJS.Timeout | null = null; // Interval to send elapsed time
    
    // Speech-only usage tracking
    let voiceInSeconds = 0; // Accumulated user speaking time
    let voiceOutSeconds = 0; // Accumulated AI speaking time
    let lastAudioReceiveTime: number | null = null; // Track when last audio chunk was received
    const AUDIO_CHUNK_TIMEOUT_MS = 500; // If no audio for 500ms, user stopped speaking
    
    // Gemini outputs audio at 24kHz, 16-bit PCM, mono = 48000 bytes/second
    const GEMINI_SAMPLE_RATE = 24000;
    const GEMINI_BYTES_PER_SAMPLE = 2; // 16-bit
    const GEMINI_CHANNELS = 1;
    const GEMINI_BYTES_PER_SECOND = GEMINI_SAMPLE_RATE * GEMINI_BYTES_PER_SAMPLE * GEMINI_CHANNELS;
    
    // Helper function to save voice usage and cleanup
    const saveVoiceUsageAndCleanup = async () => {
      // Clear the elapsed time interval
      if (voiceElapsedInterval) {
        clearInterval(voiceElapsedInterval);
        voiceElapsedInterval = null;
      }
      
      const totalVoiceSeconds = Math.round(voiceInSeconds) + Math.round(voiceOutSeconds);
      console.log(`Voice session ended: ${Math.round(voiceInSeconds)}s user speech, ${Math.round(voiceOutSeconds)}s AI speech`);
      
      // Reset counters
      voiceInSeconds = 0;
      voiceOutSeconds = 0;
      sessionStartTime = null;
    };

    const initGeminiLive = async (showId: number | null, customSystemPrompt?: string, language: string = "de-CH", contextData?: { text?: string; files?: Array<{ name: string; type: string; data: string }>; sourceIds?: number[] }, voicePreference: string = "Kore") => {
      // Guard against duplicate sessions
      if (sessionActive || geminiSession) {
        console.log("Gemini session already active, ignoring start request");
        return;
      }
      
      if (!googleAiApiKey) {
        console.log("No Google AI API key configured");
        clientWs.send(JSON.stringify({ type: "error", message: "No Google AI API key configured" }));
        return;
      }

      try {
        const ai = new GoogleGenAI({ apiKey: googleAiApiKey });
        
        // Map language codes for Gemini
        // Note: Gemini Live API only supports certain language codes
        // Swiss German dialect (gsw) uses de-DE as base, with dialect handled via system prompt
        const languageCodeMap: Record<string, string> = {
          "de-CH": "de-DE",
          "en": "en-US",
          "gsw": "de-DE"  // Swiss German dialect - use de-DE, dialect via system prompt
        };
        const geminiLanguageCode = languageCodeMap[language] || "de-DE";
        
        // Build system instruction based on language
        let systemInstruction = "";
        if (language === "en") {
          systemInstruction = `You are a helpful podcast co-host assistant. 
You help the podcast host with questions during recording.
You have access to web search to find current information.
IMPORTANT: When you have searched for information online, start your response with "I found online" or "According to my research" - so the host knows the information is current.
Keep your answers short and concise (maximum 2-3 sentences).`;
        } else if (language === "gsw") {
          systemInstruction = `Du bist ein hilfreicher Podcast Co-Host Assistent. 
WICHTIG: Du sprichst Schweizerdeutsch (Züritüütsch/Dialekt). Verwende echten Schweizer Dialekt in deinen Antworten.
Du hilfst dem Podcast-Host bei Fragen während der Aufnahme.
Du hast Zugriff auf Web-Suche um aktuelle Informationen zu finden.
WICHTIG: Wenn du Informationen aus dem Internet geholt hast, beginne deine Antwort mit "Ich han im Internet gluegt" oder "Lut minere Recherche" - so weiss der Host, dass die Information aktuell ist.
Halte deine Antworten kurz und präzise (maximal 2-3 Sätze).`;
        } else {
          systemInstruction = `Du bist ein hilfreicher Podcast Co-Host Assistent. 
WICHTIG: Du sprichst IMMER Hochdeutsch mit Schweizer Rechtschreibung (kein ß, stattdessen ss). Kein Dialekt, nur Standarddeutsch.
Du hilfst dem Podcast-Host bei Fragen während der Aufnahme.
Du hast Zugriff auf Web-Suche um aktuelle Informationen zu finden.
WICHTIG: Wenn du Informationen aus dem Internet geholt hast, beginne deine Antwort mit "Ich habe im Internet nachgeschaut" oder "Laut meiner Recherche" - so weiss der Host, dass die Information aktuell ist.
Halte deine Antworten kurz und präzise (maximal 2-3 Sätze).`;
        }

        // Add pronunciation vocabulary for English words (if user is authenticated)
        const pronunciationVocab = currentUserId ? await storage.getPronunciationVocab(currentUserId) : [];
        if (pronunciationVocab.length > 0) {
          const englishWords = pronunciationVocab.filter(v => v.language === "en").map(v => v.word);
          if (englishWords.length > 0) {
            if (language === "en") {
              // No special handling needed for English
            } else {
              systemInstruction += `\n\nWICHTIG - Englische Aussprache: Die folgenden Wörter und Abkürzungen sollst du IMMER auf Englisch aussprechen (nicht eindeutschen): ${englishWords.join(", ")}`;
            }
          }
        }

        // Add custom system prompt if provided
        if (customSystemPrompt && customSystemPrompt.trim()) {
          systemInstruction += `\n\nZusätzliche Anweisungen vom Host:\n${customSystemPrompt}`;
        }

        // Add text context if provided
        if (contextData?.text && contextData.text.trim()) {
          systemInstruction += `\n\nZusätzlicher Kontext vom Host:\n${contextData.text}`;
        }

        // Add source documents via semantic search (embedding-based retrieval)
        if (contextData?.sourceIds && contextData.sourceIds.length > 0) {
          console.log(`Processing ${contextData.sourceIds.length} source IDs for semantic retrieval`);
          
          // Get all chunks for the selected sources
          const allSourceChunks: Array<{ id: number; chunkIndex: number; text: string; tokenCount: number; embedding: string | null; sourceId: number }> = [];
          
          for (const sourceId of contextData.sourceIds) {
            const chunks = await storage.getSourceChunks(sourceId);
            for (const chunk of chunks) {
              allSourceChunks.push({
                ...chunk,
                sourceId
              });
            }
          }
          
          if (allSourceChunks.length > 0) {
            // Check if any chunks have embeddings
            const chunksWithEmbeddings = allSourceChunks.filter(c => c.embedding);
            
            if (chunksWithEmbeddings.length > 0) {
              // Build query from recent context or system prompt
              const queryText = contextData.text || customSystemPrompt || "Wichtige Informationen und Fakten";
              
              // Retrieve relevant chunks (max 5 chunks, max 4000 tokens)
              const relevantChunks = await retrieveRelevantSourceChunks(
                queryText,
                allSourceChunks,
                5,
                4000
              );
              
              if (relevantChunks.length > 0) {
                // Get source titles for context (filter by user)
                const sources = currentUserId ? await storage.getSourcesByIds(contextData.sourceIds, currentUserId) : [];
                const sourceTitles = new Map(sources.map(s => [s.id, s.title]));
                
                systemInstruction += `\n\n=== RELEVANTE QUELLEN ===`;
                for (const chunk of relevantChunks) {
                  const sourceTitle = sourceTitles.get(chunk.sourceId) || `Quelle ${chunk.sourceId}`;
                  systemInstruction += `\n\n[${sourceTitle}]:\n${chunk.text}`;
                }
                
                console.log(`Added ${relevantChunks.length} relevant source chunks to context`);
              }
            } else {
              // Embeddings not ready yet, use full text as fallback
              console.log("Source chunks exist but embeddings not ready, using full source text");
              const sources = currentUserId ? await storage.getSourcesByIds(contextData.sourceIds, currentUserId) : [];
              if (sources.length > 0) {
                systemInstruction += `\n\n=== QUELLEN-DOKUMENTE ===`;
                for (const source of sources) {
                  systemInstruction += `\n\n[${source.title}]:\n${source.textContent}`;
                }
              }
            }
          } else {
            // Fallback: no embeddings yet, use full text from sources
            console.log("No source chunks found, using full source text as fallback");
            const sources = currentUserId ? await storage.getSourcesByIds(contextData.sourceIds, currentUserId) : [];
            if (sources.length > 0) {
              systemInstruction += `\n\n=== QUELLEN-DOKUMENTE ===`;
              for (const source of sources) {
                systemInstruction += `\n\n[${source.title}]:\n${source.textContent}`;
              }
            }
          }
        }

        // Add text-based file contents to system instruction
        if (contextData?.files && contextData.files.length > 0) {
          const textFiles = contextData.files.filter(f => 
            f.type.startsWith('text/') || 
            f.type === 'application/json' || 
            f.type === 'application/x-markdown' ||
            f.name.endsWith('.md') ||
            f.name.endsWith('.json') ||
            f.name.endsWith('.txt')
          );
          
          for (const file of textFiles) {
            try {
              const decodedText = Buffer.from(file.data, 'base64').toString('utf-8');
              systemInstruction += `\n\n--- Datei: ${file.name} ---\n${decodedText}`;
            } catch (e) {
              console.error("Error decoding text file:", file.name, e);
            }
          }
        }

        if (showId && currentUserId) {
          const show = await storage.getShow(showId, currentUserId);
          const segments = await storage.getAllTranscriptSegments(showId);
          const speakerMappings = await storage.getSpeakerMappings(showId);
          
          // Check for optimized context (summary + chunks)
          const showSummary = await storage.getShowSummary(showId);
          const transcriptChunks = await storage.getTranscriptChunks(showId);
          
          // Build speaker names lookup
          const getSpeakerName = (speakerIndex: number): string => {
            const mapping = speakerMappings.find(m => m.speakerIndex === speakerIndex);
            return mapping?.displayName || `Sprecher ${speakerIndex + 1}`;
          };
          
          // Add speaker info section if we have mappings
          let speakerInfo = "";
          if (speakerMappings.length > 0) {
            speakerInfo = `\n\nTeilnehmer der Sendung:\n` + 
              speakerMappings.map(m => `- ${m.displayName}`).join("\n");
          }
          
          if (show && showSummary && transcriptChunks.length > 0) {
            // USE OPTIMIZED CONTEXT: Summary + relevant chunks
            console.log(`Using optimized context for show ${showId}: summary + ${transcriptChunks.length} chunks`);
            
            // Import retrieval functions
            const { buildOptimizedContext } = await import("./gemini-service");
            
            // Get recent transcript for context-aware retrieval
            const recentSegments = segments.slice(-20);
            const recentTranscript = recentSegments.map(s => s.text).join(" ");
            
            // Build optimized context (max 10k tokens)
            const optimizedContext = await buildOptimizedContext(
              showSummary.summary,
              transcriptChunks,
              recentTranscript,
              10000
            );
            
            systemInstruction += `\n\nAktuelle Sendung: "${show.title}"${speakerInfo}

=== ZUSAMMENFASSUNG DER SENDUNG ===
${optimizedContext.summary}

=== RELEVANTE DETAILS ===
${optimizedContext.relevantChunks.join("\n\n")}

=== LETZTE ÄUSSERUNGEN ===
${recentSegments.map(s => {
              let speaker: number | null = typeof s.speaker === 'number' ? s.speaker : null;
              if (speaker === null && s.metadata) {
                try { speaker = JSON.parse(s.metadata).speaker; } catch {}
              }
              const prefix = speaker !== null ? `[${getSpeakerName(speaker)}]: ` : "";
              return prefix + s.text;
            }).join("\n")}`;
            
            // Notify client about optimized context
            clientWs.send(JSON.stringify({ 
              type: "cohost.context_mode", 
              mode: "optimized",
              summaryTokens: optimizedContext.summaryTokens,
              chunkTokens: optimizedContext.chunkTokens,
              totalTokens: optimizedContext.totalTokens
            }));
            
          } else if (show && segments.length > 0) {
            // FALLBACK: Use full transcript (with warning for large contexts)
            const fullTranscriptText = segments.map(s => s.text).join(" ");
            const estimatedTokens = Math.round(fullTranscriptText.length / 4);
            
            if (estimatedTokens > 50000) {
              console.warn(`Large context warning: ~${estimatedTokens} tokens for show ${showId}. Consider preparing context.`);
              clientWs.send(JSON.stringify({ 
                type: "cohost.context_warning", 
                message: "Grosser Kontext - Antworten könnten langsam sein. Kontext vorbereiten empfohlen.",
                estimatedTokens
              }));
            }
            
            // Include speaker names in transcript
            const transcriptContext = segments.map(s => {
              let speaker: number | null = typeof s.speaker === 'number' ? s.speaker : null;
              if (speaker === null && s.metadata) {
                try {
                  const meta = JSON.parse(s.metadata);
                  speaker = typeof meta.speaker === 'number' ? meta.speaker : null;
                } catch {}
              }
              const prefix = speaker !== null ? `[${getSpeakerName(speaker)}]: ` : "";
              return prefix + s.text;
            }).join("\n");
            
            systemInstruction += `\n\nAktuelle Sendung: "${show.title}"${speakerInfo}
Bisheriges Gespräch (Transkript mit ${segments.length} Segmenten):
${transcriptContext}`;
            
            clientWs.send(JSON.stringify({ 
              type: "cohost.context_mode", 
              mode: "full",
              segments: segments.length,
              estimatedTokens
            }));
          } else if (show) {
            systemInstruction += `\n\nAktuelle Sendung: "${show.title}"${speakerInfo} (noch keine Transkripte)`;
          }
        }

        const config = {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          tools: [{ googleSearch: {} }],
          speechConfig: {
            languageCode: geminiLanguageCode,
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voicePreference
              }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        };

        console.log("Connecting to Gemini 2.5 Flash Live API with system instruction:", systemInstruction.length, "chars, voice:", voicePreference);
        
        // Count tokens in the system instruction and send to client (non-blocking)
        const maxTokens = 1000000; // Gemini 2.5 Flash has ~1M token context
        // Send estimate first for immediate feedback
        const estimatedTokens = Math.round(systemInstruction.length / 4);
        clientWs.send(JSON.stringify({ 
          type: "cohost.context_tokens", 
          tokens: estimatedTokens,
          maxTokens: maxTokens
        }));
        
        // Try to get exact count in background (don't block connection)
        ai.models.countTokens({
          model: "gemini-2.0-flash",
          contents: [{ role: "user", parts: [{ text: systemInstruction }] }],
        }).then(tokenCount => {
          const tokens = tokenCount.totalTokens || estimatedTokens;
          console.log("System instruction tokens:", tokens, "/", maxTokens);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ 
              type: "cohost.context_tokens", 
              tokens: tokens,
              maxTokens: maxTokens
            }));
          }
        }).catch((e: any) => {
          console.error("Error counting tokens:", e?.message || e);
        });
        
        geminiSession = await ai.live.connect({
          model: "gemini-2.5-flash-native-audio-preview-12-2025",
          config: config,
          callbacks: {
            onopen: async () => {
              console.log("Gemini Live session opened");
              sessionActive = true;
              
              // Register this session for real-time transcript updates
              if (currentShowId !== null && geminiSession) {
                const session = geminiSession;
                const showIdForLookup = currentShowId;
                activeCoHostSessions.set(currentShowId, {
                  sendTranscript: async (text: string, speaker: number | null) => {
                    try {
                      if (session && sessionActive) {
                        let speakerLabel = "Jemand";
                        if (speaker !== null) {
                          const mappings = await storage.getSpeakerMappings(showIdForLookup);
                          const mapping = mappings.find(m => m.speakerIndex === speaker);
                          speakerLabel = mapping?.displayName || `Sprecher ${speaker}`;
                        }
                        
                        await session.sendClientContent({
                          turns: [{ 
                            role: "user", 
                            parts: [{ text: `[Live-Transkript - ${speakerLabel}]: "${text}"` }] 
                          }],
                          turnComplete: false
                        });
                        console.log("Sent transcript context to Gemini:", speakerLabel);
                      }
                    } catch (e) {
                      console.error("Error sending transcript to Gemini:", e);
                    }
                  }
                });
                console.log(`Registered Co-Host session for show ${currentShowId}`);
              }
              
              // Send binary files (images, PDFs, audio, video) as multimodal content
              if (contextData?.files && contextData.files.length > 0 && geminiSession) {
                const binaryFiles = contextData.files.filter(f => 
                  f.type.startsWith('image/') ||
                  f.type.startsWith('audio/') ||
                  f.type.startsWith('video/') ||
                  f.type === 'application/pdf'
                );
                
                if (binaryFiles.length > 0) {
                  // Notify frontend that files are being processed
                  clientWs.send(JSON.stringify({ 
                    type: "cohost.processing_context", 
                    total: binaryFiles.length,
                    current: 0
                  }));
                  
                  let processed = 0;
                  for (const file of binaryFiles) {
                    try {
                      console.log("Sending binary context file to Gemini:", file.name, file.type);
                      await geminiSession.sendClientContent({
                        turns: [{ 
                          role: "user", 
                          parts: [
                            { text: `[Kontext-Datei: ${file.name}]` },
                            { 
                              inlineData: {
                                mimeType: file.type,
                                data: file.data
                              }
                            }
                          ] 
                        }],
                        turnComplete: false
                      });
                      processed++;
                      console.log("Sent binary file to Gemini:", file.name, `(${processed}/${binaryFiles.length})`);
                      
                      // Notify progress
                      clientWs.send(JSON.stringify({ 
                        type: "cohost.processing_context", 
                        total: binaryFiles.length,
                        current: processed,
                        fileName: file.name
                      }));
                    } catch (e) {
                      console.error("Error sending binary file to Gemini:", file.name, e);
                      clientWs.send(JSON.stringify({ 
                        type: "cohost.context_error", 
                        fileName: file.name,
                        error: e instanceof Error ? e.message : "Fehler beim Senden"
                      }));
                    }
                  }
                  
                  // Small delay to ensure Gemini has time to process
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
              
              // Session is ready after all context is sent
              clientWs.send(JSON.stringify({ type: "cohost.ready" }));
              
              // Start voice usage tracking
              sessionStartTime = Date.now();
              
              // Send elapsed time to client every second for live timer
              voiceElapsedInterval = setInterval(() => {
                if (sessionStartTime !== null && clientWs.readyState === 1) { // WebSocket.OPEN = 1
                  const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
                  clientWs.send(JSON.stringify({ type: "cohost.elapsed", seconds: elapsedSeconds }));
                }
              }, 1000);
            },
            onmessage: (message: any) => {
              console.log("Gemini message received:", JSON.stringify(message).slice(0, 500));
              
              if (!sessionActive) {
                console.log("Session not active, ignoring message");
                return;
              }
              
              // Handle audio responses
              if (message.serverContent?.modelTurn?.parts) {
                // Skip audio if current turn is interrupted
                if (isInterrupted) {
                  console.log("Skipping audio - turn was interrupted");
                } else {
                  for (const part of message.serverContent.modelTurn.parts) {
                    if (part.inlineData?.data) {
                      // Track voice_out duration from audio chunk size
                      // base64 encoded PCM: actual bytes = base64_length * 0.75
                      const base64Data = part.inlineData.data;
                      const audioBytes = base64Data.length * 0.75;
                      const audioDurationSeconds = audioBytes / GEMINI_BYTES_PER_SECOND;
                      voiceOutSeconds += audioDurationSeconds;
                      
                      clientWs.send(JSON.stringify({
                        type: "cohost.audio",
                        data: base64Data,
                        mimeType: part.inlineData.mimeType || "audio/pcm",
                        turnId: turnCounter
                      }));
                    }
                  }
                }
              }

              // Handle user transcription
              if (message.serverContent?.inputTranscript) {
                clientWs.send(JSON.stringify({
                  type: "cohost.user_transcript",
                  text: message.serverContent.inputTranscript
                }));
              }
              
              // Handle output transcription (what Gemini says)
              if (message.serverContent?.outputTranscription?.text) {
                clientWs.send(JSON.stringify({
                  type: "cohost.assistant_transcript",
                  text: message.serverContent.outputTranscription.text
                }));
              }

              // Handle interruption from Gemini (when VAD detects user speaking)
              // This means Gemini acknowledged the interrupt - old response is cancelled
              if (message.serverContent?.interrupted) {
                console.log("Gemini confirmed interruption - ready for new response");
                // Clear any pending timeout
                if (interruptTimeout) {
                  clearTimeout(interruptTimeout);
                  interruptTimeout = null;
                }
                const interruptedTurn = turnCounter; // Capture the turn that was interrupted
                turnCounter++; // Increment for next turn
                isInterrupted = false; // Clear interrupted state - new turn can send audio
                // Send the INTERRUPTED turn ID so client knows which turn to block
                clientWs.send(JSON.stringify({ type: "cohost.interrupted", turnId: interruptedTurn }));
              }
              
              // Handle turn complete - normal end of response
              if (message.serverContent?.turnComplete) {
                turnCounter++; // Increment for next turn
                isInterrupted = false; // Clear interrupted state
                clientWs.send(JSON.stringify({ type: "cohost.turn_complete", turnId: turnCounter }));
              }
            },
            onerror: (error: any) => {
              console.error("Gemini Live error:", error);
              const errorMessage = error?.message || error?.toString() || "Unknown error";
              console.error("Gemini error details:", errorMessage);
              if (sessionActive && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ 
                  type: "cohost.session_ended", 
                  reason: "error",
                  message: `Gemini Fehler: ${errorMessage}`
                }));
              }
              sessionActive = false;
            },
            onclose: () => {
              console.log("Gemini Live session closed by server");
              const wasActive = sessionActive;
              sessionActive = false;
              
              // Notify client that session ended
              if (wasActive && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ 
                  type: "cohost.session_ended", 
                  reason: "closed",
                  message: "Session wurde vom Server beendet (möglicherweise Timeout oder Verbindungsproblem)"
                }));
              }
              
              // Unregister from real-time transcript updates
              if (currentShowId !== null) {
                activeCoHostSessions.delete(currentShowId);
                console.log(`Unregistered Co-Host session for show ${currentShowId}`);
              }
            }
          }
        });

        console.log("Gemini Live session connecting...");

      } catch (error) {
        console.error("Error initializing Gemini Live:", error);
        clientWs.send(JSON.stringify({ type: "error", message: "Failed to initialize Gemini" }));
      }
    };

    clientWs.on("message", async (message: Buffer | ArrayBuffer | string) => {
      console.log("Co-Host received message:", typeof message, message.toString().slice(0, 200));
      
      // Handle text messages (commands)
      const msgStr = typeof message === 'string' ? message : message.toString();
      try {
        const data = JSON.parse(msgStr);
        console.log("Co-Host parsed message:", data.type);
        
        if (data.type === "start") {
            // Note: currentUserId is already set from authenticated session during upgrade
            
            // Validate showId if provided - verify ownership with authenticatedUserId
            if (data.showId) {
              const show = await storage.getShow(data.showId, currentUserId || undefined);
              if (!show) {
                clientWs.send(JSON.stringify({ type: "error", message: "Invalid show ID or not authorized" }));
                return;
              }
              currentShowId = data.showId;
            } else {
              currentShowId = null;
            }
            
            // Retrieve context from store if contextId is provided
            let contextData = data.contextData;
            if (data.contextId) {
              const storedContext = contextStore.get(data.contextId);
              if (storedContext) {
                console.log(`Retrieved stored context ${data.contextId}: text=${storedContext.text?.length || 0} chars`);
                contextData = {
                  text: storedContext.text,
                  files: storedContext.files,
                  sourceIds: storedContext.sourceIds
                };
                // Delete after retrieval (one-time use)
                contextStore.delete(data.contextId);
              } else {
                // Context not found - likely expired or invalid
                console.error(`Context ${data.contextId} not found in store (expired or invalid)`);
                clientWs.send(JSON.stringify({ 
                  type: "cohost.context_error", 
                  error: "Context expired or not found. Please try again.",
                  contextId: data.contextId
                }));
                return;
              }
            }
            
            console.log("Starting session with context:", 
              contextData ? {
                hasText: !!contextData.text,
                textLength: contextData.text?.length || 0,
                filesCount: contextData.files?.length || 0,
                sourceIds: contextData.sourceIds?.length || 0
              } : "none"
            );
            await initGeminiLive(currentShowId, data.systemPrompt, data.language || "de-CH", contextData, data.voicePreference || "Kore");
            return;
          }
          
          if (data.type === "text" && geminiSession && sessionActive) {
            // Send text message to Gemini
            await geminiSession.sendClientContent({
              turns: [{ role: "user", parts: [{ text: data.text }] }],
              turnComplete: true
            });
            return;
          }
        // Handle audio data from JSON message
        if (data.type === "audio" && data.data && geminiSession && sessionActive) {
          // Track voice_in duration from audio chunk size
          // Input audio: 16kHz, 16-bit PCM, mono = 32000 bytes/second
          const INPUT_BYTES_PER_SECOND = 16000 * 2 * 1;
          const audioBytes = data.data.length * 0.75; // base64 to bytes
          const audioDurationSeconds = audioBytes / INPUT_BYTES_PER_SECOND;
          voiceInSeconds += audioDurationSeconds;
          
          await geminiSession.sendRealtimeInput({
            audio: {
              data: data.data,
              mimeType: "audio/pcm;rate=16000"
            }
          });
        }
        
        // Handle audio stream end - user stopped speaking
        if (data.type === "audioStreamEnd" && geminiSession && sessionActive) {
          console.log("Audio stream end received, flushing cached audio");
          await geminiSession.sendRealtimeInput({
            audioStreamEnd: true
          });
        }
        
        // Handle interrupt - user wants to interrupt the AI response
        if (data.type === "interrupt" && geminiSession && sessionActive) {
          console.log("Interrupt received - blocking audio until Gemini confirms");
          isInterrupted = true; // Block all current audio immediately
          
          // Clear any existing timeout
          if (interruptTimeout) {
            clearTimeout(interruptTimeout);
          }
          
          // Timeout fallback: if Gemini doesn't confirm within 1 second, reset automatically
          // Gemini typically responds within 100-200ms, so 1 second is generous
          interruptTimeout = setTimeout(() => {
            if (isInterrupted && sessionActive) {
              console.log("Interrupt timeout - resetting to allow new audio");
              const interruptedTurn = turnCounter;
              turnCounter++;
              isInterrupted = false;
              clientWs.send(JSON.stringify({ type: "cohost.interrupted", turnId: interruptedTurn }));
            }
            interruptTimeout = null;
          }, 1000);
          
          // Send acknowledgment to client so it can clear its audio queue
          clientWs.send(JSON.stringify({ type: "cohost.interrupted", turnId: turnCounter }));
        }
        
        // Handle stop - user wants to end the session (e.g., when changing shows)
        if (data.type === "stop" && geminiSession) {
          console.log("Stop received, closing Gemini session");
          sessionActive = false;
          turnCounter = 0; // Reset turn counter for new session
          isInterrupted = false; // Reset interrupted state
          
          // Save voice usage before cleanup
          await saveVoiceUsageAndCleanup();
          
          // Unregister from real-time transcript updates
          if (currentShowId !== null) {
            activeCoHostSessions.delete(currentShowId);
            console.log(`Unregistered Co-Host session for show ${currentShowId} (stop)`);
          }
          
          try {
            geminiSession.close();
          } catch (e) {
            // Ignore close errors
          }
          geminiSession = null;
          clientWs.send(JSON.stringify({ type: "cohost.stopped" }));
        }
      } catch (e) {
        console.error("Error parsing Co-Host message:", e);
      }
    });

    clientWs.on("close", () => {
      console.log("Co-Host WebSocket client disconnected");
      sessionActive = false;
      
      // Save voice usage (fire and forget since we're in close handler)
      saveVoiceUsageAndCleanup().catch(e => console.error("Failed to save voice usage on close:", e));
      
      // Unregister from real-time transcript updates
      if (currentShowId !== null) {
        activeCoHostSessions.delete(currentShowId);
        console.log(`Unregistered Co-Host session for show ${currentShowId} (WebSocket closed)`);
      }
      
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (e) {
          // Ignore close errors
        }
        geminiSession = null;
      }
    });

    clientWs.on("error", (error) => {
      console.error("Co-Host WebSocket error:", error);
      sessionActive = false;
    });
  });

  // API: Upload context for Co-Host session (bypasses WebSocket size limits)
  app.post("/api/cohost/context", isAuthenticated, async (req, res) => {
    try {
      const { text, files, sourceIds } = req.body;
      
      // Check store capacity - reject if too many entries
      if (contextStore.size >= MAX_CONTEXT_ENTRIES) {
        console.warn(`Context store full (${contextStore.size} entries), rejecting upload`);
        return res.status(503).json({ error: "Context store temporarily full. Please try again in a few minutes." });
      }
      
      // Estimate payload size to prevent memory exhaustion
      const payloadSize = JSON.stringify(req.body).length;
      if (payloadSize > MAX_CONTEXT_SIZE_BYTES) {
        console.warn(`Context too large: ${payloadSize} bytes (max ${MAX_CONTEXT_SIZE_BYTES})`);
        return res.status(413).json({ error: `Context too large. Maximum size is ${Math.round(MAX_CONTEXT_SIZE_BYTES / 1024 / 1024)}MB.` });
      }
      
      // Generate unique context ID
      const contextId = `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Store context
      contextStore.set(contextId, {
        text,
        files,
        sourceIds,
        createdAt: Date.now()
      });
      
      console.log(`Stored context ${contextId}: text=${text?.length || 0} chars, files=${files?.length || 0}, sourceIds=${sourceIds?.length || 0}, size=${payloadSize} bytes`);
      
      res.json({ contextId });
    } catch (error) {
      console.error("Error storing context:", error);
      res.status(500).json({ error: "Failed to store context" });
    }
  });

  // API: Shows CRUD (protected)
  app.get("/api/shows", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const shows = await storage.getShows(userId);
      res.json(shows);
    } catch (error) {
      console.error("Error fetching shows:", error);
      res.status(500).json({ error: "Failed to fetch shows" });
    }
  });

  app.post("/api/shows", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }
      const show = await storage.createShow({ title, userId });
      res.json(show);
    } catch (error) {
      console.error("Error creating show:", error);
      res.status(500).json({ error: "Failed to create show" });
    }
  });

  app.get("/api/shows/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const show = await storage.getShow(id, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      res.json(show);
    } catch (error) {
      console.error("Error fetching show:", error);
      res.status(500).json({ error: "Failed to fetch show" });
    }
  });

  app.put("/api/shows/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }
      const show = await storage.updateShow(id, title, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      res.json(show);
    } catch (error) {
      console.error("Error updating show:", error);
      res.status(500).json({ error: "Failed to update show" });
    }
  });

  app.delete("/api/shows/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteShow(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting show:", error);
      res.status(500).json({ error: "Failed to delete show" });
    }
  });

  app.get("/api/shows/:id/transcripts", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const show = await storage.getShow(id, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      const segments = await storage.getAllTranscriptSegments(id);
      res.json(segments);
    } catch (error) {
      console.error("Error fetching show transcripts:", error);
      res.status(500).json({ error: "Failed to fetch transcripts" });
    }
  });

  // API: Export show with all data (protected)
  app.get("/api/shows/:id/export", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const format = (req.query.format as string) || "json";
      
      const show = await storage.getShow(id, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      
      const segments = await storage.getAllTranscriptSegments(id);
      const speakerMappings = await storage.getSpeakerMappings(id);
      
      const speakerMap: Record<number, string> = {};
      for (const mapping of speakerMappings) {
        speakerMap[mapping.speakerIndex] = mapping.displayName;
      }
      
      const getSpeakerName = (speakerIndex: number | null): string => {
        if (speakerIndex === null) return "Unbekannt";
        return speakerMap[speakerIndex] || `Speaker ${speakerIndex}`;
      };
      
      const formatDate = (date: Date | string | null): string => {
        if (!date) return "";
        const d = date instanceof Date ? date : new Date(date);
        return isNaN(d.getTime()) ? "" : d.toLocaleString("de-CH");
      };
      
      const formatISODate = (date: Date | string | null): string => {
        if (!date) return "";
        const d = date instanceof Date ? date : new Date(date);
        return isNaN(d.getTime()) ? "" : d.toISOString();
      };
      
      if (format === "md") {
        let markdown = `# ${show.title}\n\n`;
        markdown += `**Erstellt:** ${formatDate(show.createdAt)}\n\n`;
        markdown += `---\n\n`;
        markdown += `## Transkript\n\n`;
        
        let currentSpeaker: string | null = null;
        for (const segment of segments) {
          const speaker = getSpeakerName(segment.speaker);
          if (speaker !== currentSpeaker) {
            if (currentSpeaker !== null) markdown += "\n\n";
            markdown += `**${speaker}:** `;
            currentSpeaker = speaker;
          }
          markdown += segment.text + " ";
        }
        
        markdown += "\n\n---\n\n";
        markdown += `## Speaker-Zuordnungen\n\n`;
        if (speakerMappings.length > 0) {
          for (const mapping of speakerMappings) {
            markdown += `- Speaker ${mapping.speakerIndex}: **${mapping.displayName}**\n`;
          }
        } else {
          markdown += "_Keine Speaker-Zuordnungen definiert._\n";
        }
        
        const filename = `${show.title.replace(/[^a-zA-Z0-9äöüÄÖÜß ]/g, "_")}_${show.id}.md`;
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(markdown);
      } else {
        const exportData = {
          show: {
            id: show.id,
            title: show.title,
            createdAt: formatISODate(show.createdAt),
          },
          speakerMappings: speakerMappings.map(m => ({
            speakerIndex: m.speakerIndex,
            displayName: m.displayName,
          })),
          transcriptSegments: segments.map(s => ({
            id: s.id,
            text: s.text,
            speaker: s.speaker,
            speakerName: getSpeakerName(s.speaker),
            timestamp: formatISODate(s.timestamp),
            metadata: s.metadata,
          })),
          exportedAt: new Date().toISOString(),
        };
        
        const filename = `${show.title.replace(/[^a-zA-Z0-9äöüÄÖÜß ]/g, "_")}_${show.id}.json`;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.json(exportData);
      }
    } catch (error) {
      console.error("Error exporting show:", error);
      res.status(500).json({ error: "Failed to export show" });
    }
  });

  // API: System Prompts CRUD (protected)
  app.get("/api/system-prompts", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const prompts = await storage.getSystemPrompts(userId);
      res.json(prompts);
    } catch (error) {
      console.error("Error fetching system prompts:", error);
      res.status(500).json({ error: "Failed to fetch system prompts" });
    }
  });

  app.post("/api/system-prompts", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { name, prompt } = req.body;
      if (!name || !prompt) {
        return res.status(400).json({ error: "Name and prompt are required" });
      }
      const created = await storage.createSystemPrompt({ userId, name, prompt });
      res.json(created);
    } catch (error) {
      console.error("Error creating system prompt:", error);
      res.status(500).json({ error: "Failed to create system prompt" });
    }
  });

  app.put("/api/system-prompts/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const { name, prompt } = req.body;
      if (!name || !prompt) {
        return res.status(400).json({ error: "Name and prompt are required" });
      }
      const updated = await storage.updateSystemPrompt(id, name, prompt, userId);
      if (!updated) {
        return res.status(404).json({ error: "System prompt not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating system prompt:", error);
      res.status(500).json({ error: "Failed to update system prompt" });
    }
  });

  app.delete("/api/system-prompts/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteSystemPrompt(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting system prompt:", error);
      res.status(500).json({ error: "Failed to delete system prompt" });
    }
  });

  // API: Sources CRUD (protected)
  app.get("/api/sources", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const sources = await storage.getSources(userId);
      res.json(sources);
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  app.get("/api/sources/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const source = await storage.getSource(id, userId);
      if (!source) {
        return res.status(404).json({ error: "Source not found" });
      }
      res.json(source);
    } catch (error) {
      console.error("Error fetching source:", error);
      res.status(500).json({ error: "Failed to fetch source" });
    }
  });

  app.post("/api/sources", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { title, type, mimeType, originalFilename, textContent, fileData } = req.body;
      
      if (!title || !type || !mimeType || !originalFilename) {
        return res.status(400).json({ error: "Title, type, mimeType, and originalFilename are required" });
      }

      let extractedContent = textContent || "";

      // If PDF, convert to markdown using pdf2md
      if (type === "pdf" && fileData) {
        try {
          const pdf2md = (await import("@opendocsg/pdf2md")).default;
          const buffer = Buffer.from(fileData, "base64");
          extractedContent = await pdf2md(buffer);
        } catch (pdfError) {
          console.error("Error extracting PDF text:", pdfError);
          return res.status(400).json({ error: "Failed to extract text from PDF" });
        }
      }

      // For JSON, try to format it nicely
      if (type === "json" && fileData) {
        try {
          const jsonBuffer = Buffer.from(fileData, "base64");
          const jsonContent = JSON.parse(jsonBuffer.toString("utf-8"));
          extractedContent = JSON.stringify(jsonContent, null, 2);
        } catch (jsonError) {
          console.error("Error parsing JSON:", jsonError);
          const jsonBuffer = Buffer.from(fileData, "base64");
          extractedContent = jsonBuffer.toString("utf-8");
        }
      }

      // For text/markdown, decode base64
      if ((type === "text" || type === "markdown") && fileData) {
        const textBuffer = Buffer.from(fileData, "base64");
        extractedContent = textBuffer.toString("utf-8");
      }

      const created = await storage.createSource({
        userId,
        title,
        type,
        mimeType,
        originalFilename,
        textContent: extractedContent,
      });
      
      // Generate embeddings asynchronously
      generateSourceEmbeddings(created.id, extractedContent).catch(err => {
        console.error(`Error generating embeddings for source ${created.id}:`, err);
      });
      
      res.json(created);
    } catch (error) {
      console.error("Error creating source:", error);
      res.status(500).json({ error: "Failed to create source" });
    }
  });

  app.put("/api/sources/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const { title, textContent } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }
      const updated = await storage.updateSource(id, title, textContent || "", userId);
      if (!updated) {
        return res.status(404).json({ error: "Source not found" });
      }
      
      // Regenerate embeddings when content changes
      if (textContent !== undefined) {
        generateSourceEmbeddings(id, textContent || "").catch(err => {
          console.error(`Error regenerating embeddings for source ${id}:`, err);
        });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating source:", error);
      res.status(500).json({ error: "Failed to update source" });
    }
  });

  app.delete("/api/sources/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      await storage.deleteSource(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting source:", error);
      res.status(500).json({ error: "Failed to delete source" });
    }
  });

  // API: Get sources by IDs (for Co-Host context)
  app.post("/api/sources/batch", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: "ids must be an array" });
      }
      const sources = await storage.getSourcesByIds(ids, userId);
      res.json(sources);
    } catch (error) {
      console.error("Error fetching sources by ids:", error);
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  // API: Get recent transcript segments (top of mind) (protected)
  app.get("/api/transcripts/recent", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const limit = parseInt(req.query.limit as string) || 10;
      const showId = req.query.showId ? parseInt(req.query.showId as string) : undefined;
      
      if (showId) {
        const show = await storage.getShow(showId, userId);
        if (!show) {
          return res.status(404).json({ error: "Show not found" });
        }
      }
      
      const segments = await storage.getRecentTranscriptSegments(limit, showId);
      
      // Prevent caching to ensure fresh data on production
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.json(segments);
    } catch (error) {
      console.error("Error fetching recent transcripts:", error);
      res.status(500).json({ error: "Failed to fetch recent transcripts" });
    }
  });

  // API: Search transcripts (protected)
  app.get("/api/transcripts/search", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const query = req.query.q as string;
      const showId = req.query.showId ? parseInt(req.query.showId as string) : undefined;
      if (!query) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }
      
      if (showId) {
        const show = await storage.getShow(showId, userId);
        if (!show) {
          return res.status(404).json({ error: "Show not found" });
        }
      }
      
      const segments = await storage.searchTranscriptSegments(query, showId);
      res.json(segments);
    } catch (error) {
      console.error("Error searching transcripts:", error);
      res.status(500).json({ error: "Failed to search transcripts" });
    }
  });

  // API: Ask question about conversation (scoped to show) (protected)
  app.post("/api/query", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { question, showId } = req.body;
      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      // Validate showId if provided
      if (showId) {
        const show = await storage.getShow(showId, userId);
        if (!show) {
          return res.status(404).json({ error: "Show not found" });
        }
      }

      // Get recent context (top of mind - last 10 segments) for the current show
      const recentSegments = await storage.getRecentTranscriptSegments(10, showId);
      
      // Get all segments for the current show
      const allSegments = await storage.getAllTranscriptSegments(showId);

      // Build context
      const recentContext = recentSegments
        .reverse()
        .map(s => s.text)
        .join(" ");
      
      const fullContext = allSegments
        .map(s => s.text)
        .join(" ");

      // Query LLM
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          {
            role: "system",
            content: "Du bist ein intelligenter Assistent, der Gespräche analysiert. Basierend auf dem Kontext des Gesprächs beantworte die Fragen des Nutzers präzise und hilfreich."
          },
          {
            role: "user",
            content: `Kontext (aktuelle Unterhaltung, Top of Mind):\n${recentContext}\n\nGesamter Kontext (vollständige Historie):\n${fullContext}\n\nFrage: ${question}`
          }
        ],
        max_completion_tokens: 500,
      });

      const answer = response.choices[0]?.message?.content || "Keine Antwort verfügbar.";

      res.json({ answer, context: { recentSegments: recentSegments.length, totalSegments: allSegments.length } });
    } catch (error) {
      console.error("Error processing query:", error);
      res.status(500).json({ error: "Failed to process query" });
    }
  });

  // API: Speaker Mappings (protected)
  app.get("/api/shows/:id/speakers", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const show = await storage.getShow(id, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      const mappings = await storage.getSpeakerMappings(id);
      res.json(mappings);
    } catch (error) {
      console.error("Error fetching speaker mappings:", error);
      res.status(500).json({ error: "Failed to fetch speaker mappings" });
    }
  });

  app.put("/api/shows/:id/speakers/:speakerIndex", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const showId = parseInt(req.params.id);
      const speakerIndex = parseInt(req.params.speakerIndex);
      const { displayName } = req.body;
      
      const show = await storage.getShow(showId, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      
      if (!displayName || displayName.trim() === "") {
        return res.status(400).json({ error: "Display name is required" });
      }
      
      const mapping = await storage.setSpeakerMapping(showId, speakerIndex, displayName.trim());
      res.json(mapping);
    } catch (error) {
      console.error("Error setting speaker mapping:", error);
      res.status(500).json({ error: "Failed to set speaker mapping" });
    }
  });

  app.delete("/api/shows/:id/speakers/:speakerIndex", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const showId = parseInt(req.params.id);
      const speakerIndex = parseInt(req.params.speakerIndex);
      
      const show = await storage.getShow(showId, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      
      await storage.deleteSpeakerMapping(showId, speakerIndex);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting speaker mapping:", error);
      res.status(500).json({ error: "Failed to delete speaker mapping" });
    }
  });

  // API: Pronunciation Vocabulary (protected)
  app.get("/api/pronunciation-vocab", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const vocab = await storage.getPronunciationVocab(userId);
      res.json(vocab);
    } catch (error) {
      console.error("Error fetching pronunciation vocab:", error);
      res.status(500).json({ error: "Failed to fetch pronunciation vocabulary" });
    }
  });

  app.post("/api/pronunciation-vocab", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { word, language } = req.body;
      if (!word || !word.trim()) {
        return res.status(400).json({ error: "Word is required" });
      }
      const created = await storage.createPronunciationVocab({
        userId,
        word: word.trim(),
        language: language || "en"
      });
      res.json(created);
    } catch (error) {
      console.error("Error creating pronunciation vocab:", error);
      res.status(500).json({ error: "Failed to create pronunciation vocabulary" });
    }
  });

  app.delete("/api/pronunciation-vocab/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      await storage.deletePronunciationVocab(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting pronunciation vocab:", error);
      res.status(500).json({ error: "Failed to delete pronunciation vocabulary" });
    }
  });

  // API: Quick Actions - All available (system + user's own)
  app.get("/api/quick-actions/all", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const systemActions = await storage.getSystemQuickActions();
      const userActions = await storage.getUserQuickActions(userId);
      res.json({
        system: systemActions,
        user: userActions
      });
    } catch (error) {
      console.error("Error fetching all quick actions:", error);
      res.status(500).json({ error: "Failed to fetch quick actions" });
    }
  });
  
  // API: Quick Actions - User's selections (enabled actions for Co-Host)
  app.get("/api/quick-actions/selections", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      // Initialize selections for new users
      await storage.initializeUserSelections(userId);
      const selections = await storage.getUserQuickActionSelections(userId);
      res.json(selections);
    } catch (error) {
      console.error("Error fetching quick action selections:", error);
      res.status(500).json({ error: "Failed to fetch selections" });
    }
  });
  
  // API: Quick Actions - Update selection (enable/disable)
  app.post("/api/quick-actions/selections/:actionId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const actionId = parseInt(req.params.actionId);
      const { isEnabled, sortOrder } = req.body;
      await storage.setQuickActionSelection(userId, actionId, isEnabled, sortOrder);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating quick action selection:", error);
      res.status(500).json({ error: "Failed to update selection" });
    }
  });
  
  // API: Quick Actions - Get enabled actions only (for Co-Host session)
  app.get("/api/quick-actions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      // Initialize selections for new users
      await storage.initializeUserSelections(userId);
      const selections = await storage.getUserQuickActionSelections(userId);
      // Return only enabled actions
      const enabledActions = selections
        .filter(s => s.isEnabled)
        .map(s => s.quickAction);
      res.json(enabledActions);
    } catch (error) {
      console.error("Error fetching quick actions:", error);
      res.status(500).json({ error: "Failed to fetch quick actions" });
    }
  });

  // API: Quick Actions CRUD (protected) - Create user action
  app.post("/api/quick-actions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const { label, prompt, sortOrder } = req.body;
      if (!label || !prompt) {
        return res.status(400).json({ error: "Label and prompt are required" });
      }
      const created = await storage.createQuickAction({
        userId,
        label: label.trim(),
        prompt: prompt.trim(),
        sortOrder: sortOrder || 0
      });
      // Auto-enable the new action for this user
      await storage.setQuickActionSelection(userId, created.id, true, sortOrder || 0);
      res.json(created);
    } catch (error) {
      console.error("Error creating quick action:", error);
      res.status(500).json({ error: "Failed to create quick action" });
    }
  });

  app.put("/api/quick-actions/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      const { label, prompt, sortOrder } = req.body;
      if (!label || !prompt) {
        return res.status(400).json({ error: "Label and prompt are required" });
      }
      // Check if this is user's own action (can't edit system actions)
      const action = (await storage.getUserQuickActions(userId)).find(a => a.id === id);
      if (!action) {
        return res.status(403).json({ error: "Can only edit your own quick actions" });
      }
      const updated = await storage.updateQuickAction(id, label.trim(), prompt.trim(), sortOrder);
      if (!updated) {
        return res.status(404).json({ error: "Quick action not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating quick action:", error);
      res.status(500).json({ error: "Failed to update quick action" });
    }
  });

  app.delete("/api/quick-actions/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const id = parseInt(req.params.id);
      // Check if this is user's own action (can't delete system actions)
      const action = (await storage.getUserQuickActions(userId)).find(a => a.id === id);
      if (!action) {
        return res.status(403).json({ error: "Can only delete your own quick actions" });
      }
      await storage.deleteQuickAction(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quick action:", error);
      res.status(500).json({ error: "Failed to delete quick action" });
    }
  });

  // API: Quick Actions - Load default system actions for user
  app.post("/api/quick-actions/load-defaults", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      
      // Define the default system actions
      const defaultActions = [
        { userId: null, label: "Zusammenfassen", prompt: "Bitte fasse zusammen, was bisher besprochen wurde.", sortOrder: 0 },
        { userId: null, label: "Recherchieren", prompt: "Kannst du das, was wir zuletzt besprochen haben, im Internet recherchieren?", sortOrder: 1 },
        { userId: null, label: "Erklären", prompt: "Bitte erkläre die letzte Aussage genauer.", sortOrder: 2 }
      ];
      
      // Get existing system actions
      let systemActions = await storage.getSystemQuickActions();
      const existingLabels = new Set(systemActions.map(a => a.label));
      console.log("Loading default quick actions, found:", systemActions.length, "existing system actions:", Array.from(existingLabels));
      
      // Create any missing default actions (upsert by label)
      let createdCount = 0;
      for (const action of defaultActions) {
        if (!existingLabels.has(action.label)) {
          console.log("Creating missing default action:", action.label);
          await storage.createQuickAction(action);
          createdCount++;
        }
      }
      
      if (createdCount > 0) {
        console.log("Created", createdCount, "missing default actions");
        // Refresh the list after creating
        systemActions = await storage.getSystemQuickActions();
      }
      
      // Enable all system actions for this user
      for (const action of systemActions) {
        await storage.setQuickActionSelection(userId, action.id, true, action.sortOrder);
      }
      
      res.json({ success: true, count: systemActions.length });
    } catch (error) {
      console.error("Error loading default quick actions:", error);
      res.status(500).json({ error: "Failed to load defaults" });
    }
  });

  // API: Show Summary (protected)
  app.get("/api/shows/:id/summary", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const showId = parseInt(req.params.id);
      const show = await storage.getShow(showId, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      const summary = await storage.getShowSummary(showId);
      res.json(summary || null);
    } catch (error) {
      console.error("Error fetching show summary:", error);
      res.status(500).json({ error: "Failed to fetch show summary" });
    }
  });

  app.post("/api/shows/:id/prepare-context", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const showId = parseInt(req.params.id);
      const show = await storage.getShow(showId, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }

      const { 
        generateSummary, 
        generateChunkSummary, 
        aggregateSummaries, 
        generateEmbedding, 
        splitIntoChunks,
        countTokens 
      } = await import("./gemini-service");

      const segments = await storage.getAllTranscriptSegments(showId);
      if (segments.length === 0) {
        return res.status(400).json({ error: "No transcript segments found" });
      }

      const fullText = segments.map(s => s.text).join(" ");
      const totalTokens = await countTokens(fullText);
      
      console.log(`Preparing context for show ${showId}: ${segments.length} segments, ~${totalTokens} tokens`);

      await storage.deleteTranscriptChunks(showId);

      const textChunks = splitIntoChunks(fullText, 450, 100);
      console.log(`Created ${textChunks.length} chunks`);

      const chunks: { text: string; embedding: number[]; tokenCount: number }[] = [];
      for (let i = 0; i < textChunks.length; i++) {
        const chunkText = textChunks[i];
        const embedding = await generateEmbedding(chunkText);
        chunks.push({
          text: chunkText,
          embedding: embedding.embedding,
          tokenCount: embedding.tokenCount
        });
        
        const startSegmentId = segments[0]?.id || 0;
        const endSegmentId = segments[segments.length - 1]?.id || 0;
        
        await storage.createTranscriptChunk({
          showId,
          chunkIndex: i,
          text: chunkText,
          startSegmentId,
          endSegmentId,
          embedding: JSON.stringify(embedding.embedding),
          tokenCount: embedding.tokenCount
        });
        
        if (i % 10 === 0) {
          console.log(`Processed chunk ${i + 1}/${textChunks.length}`);
        }
      }

      let summaryResult;
      if (totalTokens > 50000) {
        console.log("Large transcript - using map-reduce summarization");
        const chunkSize = Math.ceil(textChunks.length / 10);
        const blocks: string[] = [];
        
        for (let i = 0; i < textChunks.length; i += chunkSize) {
          const blockChunks = textChunks.slice(i, i + chunkSize);
          blocks.push(blockChunks.join(" "));
        }

        const intermediateSummaries: string[] = [];
        for (let i = 0; i < blocks.length; i++) {
          console.log(`Summarizing block ${i + 1}/${blocks.length}`);
          const blockSummary = await generateChunkSummary(blocks[i], i, blocks.length);
          intermediateSummaries.push(blockSummary);
        }

        summaryResult = await aggregateSummaries(intermediateSummaries);
      } else {
        console.log("Standard summarization");
        summaryResult = await generateSummary(fullText, 6000);
      }

      await storage.createOrUpdateShowSummary({
        showId,
        summary: summaryResult.summary,
        tokenCount: summaryResult.tokenCount,
        segmentCount: segments.length
      });

      console.log(`Context preparation complete for show ${showId}`);

      res.json({
        success: true,
        summary: {
          tokenCount: summaryResult.tokenCount,
          segmentCount: segments.length
        },
        chunks: {
          count: chunks.length,
          totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0)
        }
      });
    } catch (error) {
      console.error("Error preparing context:", error);
      res.status(500).json({ error: "Failed to prepare context" });
    }
  });

  app.get("/api/shows/:id/chunks", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      const showId = parseInt(req.params.id);
      const show = await storage.getShow(showId, userId);
      if (!show) {
        return res.status(404).json({ error: "Show not found" });
      }
      const chunks = await storage.getTranscriptChunks(showId);
      res.json(chunks.map(c => ({
        id: c.id,
        chunkIndex: c.chunkIndex,
        text: c.text.substring(0, 200) + (c.text.length > 200 ? "..." : ""),
        tokenCount: c.tokenCount,
        hasEmbedding: !!c.embedding
      })));
    } catch (error) {
      console.error("Error fetching chunks:", error);
      res.status(500).json({ error: "Failed to fetch chunks" });
    }
  });

  // Admin routes
  app.get("/api/admin/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching all users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.put("/api/admin/users/:id/role", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      if (!role || (role !== 'user' && role !== 'admin')) {
        return res.status(400).json({ error: "Invalid role. Must be 'user' or 'admin'" });
      }
      const updatedUser = await storage.updateUserRole(id, role);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ error: "Failed to update user role" });
    }
  });

  // Check if current user is admin
  app.get("/api/admin/check", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.json({ isAdmin: false });
      }
      const user = await storage.getUser(userId);
      res.json({ isAdmin: user?.role === 'admin' });
    } catch (error) {
      console.error("Error checking admin status:", error);
      res.json({ isAdmin: false });
    }
  });

  // Voice preference routes
  app.get("/api/user/voice-preference", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(userId);
      res.json({ voicePreference: user?.voicePreference || "Kore" });
    } catch (error) {
      console.error("Error fetching voice preference:", error);
      res.status(500).json({ error: "Failed to fetch voice preference" });
    }
  });

  app.put("/api/user/voice-preference", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const { voicePreference } = req.body;
      if (!voicePreference || (voicePreference !== 'Kore' && voicePreference !== 'Puck')) {
        return res.status(400).json({ error: "Invalid voice preference. Must be 'Kore' (female) or 'Puck' (male)" });
      }
      const updatedUser = await storage.updateVoicePreference(userId, voicePreference);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ voicePreference: updatedUser.voicePreference });
    } catch (error) {
      console.error("Error updating voice preference:", error);
      res.status(500).json({ error: "Failed to update voice preference" });
    }
  });

  return httpServer;
}
