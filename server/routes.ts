import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server, type IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, sessionStore } from "./auth";
import {
  chunkSourceText,
  generateEmbedding,
  retrieveRelevantSourceChunks
} from "./gemini-service";
import { createAudioSessionHandler } from "./handlers/audio-session";
import { createCoHostSessionHandler, type ActiveCoHostSession, type StoredContext } from "./handlers/cohost-session";
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
    
    // Query the session from memory store
    const sessionData = await new Promise<any>((resolve) => {
      sessionStore.get(sessionId, (err: any, sess: any) => {
        if (err || !sess) {
          console.log("Session not found in store");
          resolve(null);
        } else {
          resolve(sess);
        }
      });
    });
    
    if (!sessionData) return null;

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
const activeCoHostSessions = new Map<number, ActiveCoHostSession>();

// In-memory store for large context payloads (to bypass WebSocket size limits)
// Maps contextId -> contextData, expires after 5 minutes
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
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const googleAiApiKey = process.env.GOOGLE_AI_API_KEY;
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});


// Admin middleware - checks if user has admin role
const isAdmin = async (req: Request, res: Response, next: NextFunction) => {
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

  wss.on("connection", createAudioSessionHandler({
    deepgramApiKey,
    elevenLabsApiKey,
    activeCoHostSessions,
    generateIncrementalTranscriptChunk
  }));

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

  cohostWss.on("connection", createCoHostSessionHandler({
    googleAiApiKey,
    activeCoHostSessions,
    contextStore
  }));

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
      } else if (format === "txt") {
        let text = `${show.title}\n`;
        text += `Erstellt: ${formatDate(show.createdAt)}\n`;
        text += `${"=".repeat(60)}\n\n`;
        
        for (const segment of segments) {
          const speaker = getSpeakerName(segment.speaker);
          const ts = segment.timestamp ? new Date(segment.timestamp).toLocaleTimeString("de-CH") : "";
          text += `[${ts}] ${speaker}: ${segment.text}\n`;
        }
        
        const filename = `${show.title.replace(/[^a-zA-Z0-9äöüÄÖÜß ]/g, "_")}_${show.id}.txt`;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(text);
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
      const VALID_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];
      if (!voicePreference || !VALID_VOICES.includes(voicePreference)) {
        return res.status(400).json({ error: `Invalid voice preference. Must be one of: ${VALID_VOICES.join(", ")}` });
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
