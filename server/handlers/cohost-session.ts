import type { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import { storage } from "../storage";
import { retrieveRelevantSourceChunks } from "../gemini-service";

export interface ActiveCoHostSession {
  sendTranscript: (text: string, speaker: number | null) => Promise<void>;
}

export interface StoredContext {
  text?: string;
  files?: Array<{ name: string; type: string; data: string }>;
  sourceIds?: number[];
  createdAt: number;
}

type CoHostSessionDeps = {
  googleAiApiKey?: string;
  activeCoHostSessions: Map<number, ActiveCoHostSession>;
  contextStore: Map<string, StoredContext>;
};

/**
 * Creates the Co-Host WebSocket handler for Gemini Live sessions.
 */
export function createCoHostSessionHandler(deps: CoHostSessionDeps) {
  const { googleAiApiKey, activeCoHostSessions, contextStore } = deps;

  return async (clientWs: WebSocket, request: IncomingMessage) => {
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

    const MAX_CONTROL_MESSAGE_BYTES = 256 * 1024;
    const MAX_TEXT_MESSAGE_LENGTH = 8000;
    const MAX_AUDIO_BASE64_LENGTH = 2 * 1024 * 1024;
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;
    
    // Speech-only usage tracking
    let voiceInSeconds = 0; // Accumulated user speaking time
    let voiceOutSeconds = 0; // Accumulated AI speaking time
    let lastAudioReceiveTime: number | null = null; // Track when last audio chunk was received
    const AUDIO_CHUNK_TIMEOUT_MS = 500; // If no audio for 500ms, user stopped speaking
    let keepAliveInterval: NodeJS.Timeout | null = null; // Keep-alive ping to prevent Gemini timeout
    let lastStartConfig: { showId: number | null; systemPrompt?: string; language: string; contextData?: any; voicePreference: string; modelPreference: string } | null = null; // Store config for auto-reconnect
    
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
  
    const initGeminiLive = async (showId: number | null, customSystemPrompt?: string, language: string = "de-CH", contextData?: { text?: string; files?: Array<{ name: string; type: string; data: string }>; sourceIds?: number[] }, voicePreference: string = "Kore", modelPreference: string = "gemini-3.1-flash-live-preview") => {
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
  
  CONTEXT SYSTEM: You will receive ongoing text messages prefixed with "[Live-Transkript". These are automatic transcriptions of the podcast conversation. NEVER respond to these transcript messages! Silently remember the content as context, but ONLY respond when the host directly speaks to you or sends a text question.
  
  You have access to web search, but ONLY use it when the host explicitly asks you to search, research, look up, or check online. Keywords: "search", "look up", "check online", "research", "google it".
  If the host asks a question you can answer from the transcript or your own knowledge, answer directly WITHOUT searching.
  ONLY when you actually performed a web search, mention it briefly: "I looked that up" or "According to my search". NEVER say this if you didn't actually search.
  Keep your answers short and concise (maximum 2-3 sentences).`;
        } else if (language === "gsw") {
          systemInstruction = `Du bist ein hilfreicher Podcast Co-Host Assistent. 
  WICHTIG: Du sprichst Schweizerdeutsch (Züritüütsch/Dialekt). Verwende echten Schweizer Dialekt in deinen Antworten.
  Du hilfst dem Podcast-Host bei Fragen während der Aufnahme.
  
  KONTEXT-SYSTEM: Du erhältst laufend Textnachrichten mit dem Prefix "[Live-Transkript". Das sind automatische Transkriptionen des Podcast-Gesprächs. ANTWORTE NIEMALS auf diese Transkript-Nachrichten! Merke dir den Inhalt still als Kontext, aber reagiere NUR wenn der Host dich direkt per Sprache oder Text anspricht.
  
  Du hast Zugriff auf Web-Suche, aber nutze sie NUR wenn der Host dich explizit bittet zu suchen. Schlüsselwörter: "recherchier", "schau im Internet", "check im Netz", "google", "such mal".
  Wenn du eine Frage aus dem Transkript oder deinem Wissen beantworten kannst, antworte direkt OHNE Websuche.
  NUR wenn du tatsächlich eine Websuche durchgeführt hast, erwähne es kurz: "Ich han das nachegluegt". Sag das NIEMALS wenn du nicht wirklich gesucht hast.
  Halte deine Antworten kurz und präzise (maximal 2-3 Sätze).`;
        } else {
          systemInstruction = `Du bist ein hilfreicher Podcast Co-Host Assistent. 
  WICHTIG: Du sprichst IMMER klares, angenehmes Hochdeutsch — wie eine eloquente Professorin. Kein Schweizer Akzent, kein Dialekt, kein Schweizerdeutsch. Reines, gepflegtes Standarddeutsch mit natürlicher, warmer Intonation.
  Du hilfst dem Podcast-Host bei Fragen während der Aufnahme.
  
  KONTEXT-SYSTEM: Du erhältst laufend Textnachrichten mit dem Prefix "[Live-Transkript". Das sind automatische Transkriptionen des Podcast-Gesprächs. ANTWORTE NIEMALS auf diese Transkript-Nachrichten! Merke dir den Inhalt still als Kontext, aber reagiere NUR wenn der Host dich direkt per Sprache oder Text anspricht.
  
  Du hast Zugriff auf Web-Suche, aber nutze sie NUR wenn der Host dich explizit bittet zu suchen. Schlüsselwörter: "recherchier", "schau im Internet", "check im Netz", "google", "such mal", "schau mal nach".
  Wenn du eine Frage aus dem Transkript oder deinem Wissen beantworten kannst, antworte direkt OHNE Websuche.
  NUR wenn du tatsächlich eine Websuche durchgeführt hast, erwähne es kurz: "Ich habe das nachgeschaut". Sag das NIEMALS wenn du nicht wirklich gesucht hast.
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
        }).catch((e: unknown) => {
          const err = e instanceof Error ? e : new Error(String(e));
          console.error("Error counting tokens:", err.message);
        });
        
        geminiSession = await ai.live.connect({
          model: modelPreference,
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
                        
                        // Use sendRealtimeInput for 3.1 Flash Live (sendClientContent is only for initial context seeding)
                        await session.sendRealtimeInput({
                          text: `[Live-Transkript - ${speakerLabel}]: "${text}"`
                        });
                        console.log("Sent transcript context to Gemini via sendRealtimeInput:", speakerLabel);
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
              
              // Start keep-alive: send silent audio every 30s to prevent Gemini timeout
              if (keepAliveInterval) clearInterval(keepAliveInterval);
              keepAliveInterval = setInterval(async () => {
                if (geminiSession && sessionActive) {
                  try {
                    // Send 0.5s of silence (16kHz, 16-bit PCM = 16000 bytes)
                    const silentBuffer = Buffer.alloc(16000).toString("base64");
                    await geminiSession.sendRealtimeInput({
                      audio: {
                        data: silentBuffer,
                        mimeType: "audio/pcm;rate=16000"
                      }
                    });
                  } catch (e) {
                    console.error("[Keep-alive] Error sending silent audio:", e);
                  }
                }
              }, 30000);
              
              // Send elapsed time to client every second for live timer
              voiceElapsedInterval = setInterval(() => {
                if (sessionStartTime !== null && clientWs.readyState === 1) { // WebSocket.OPEN = 1
                  const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
                  clientWs.send(JSON.stringify({ type: "cohost.elapsed", seconds: elapsedSeconds }));
                }
              }, 1000);
            },
            onmessage: (message: unknown) => {
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
            onerror: (error: unknown) => {
              const err = error instanceof Error ? error : new Error(String(error));
              console.error("Gemini Live error:", err.message);
              const errorMessage = err.message || "Unknown error";
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
              geminiSession = null;
              
              // Clear keep-alive
              if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
              }
              
              // Auto-reconnect if session was active and client is still connected
              if (wasActive && clientWs.readyState === WebSocket.OPEN && lastStartConfig) {
                console.log("[Auto-Reconnect] Gemini session closed unexpectedly, reconnecting in 2s...");
                clientWs.send(JSON.stringify({ 
                  type: "cohost.reconnecting", 
                  message: "Verbindung wird wiederhergestellt..."
                }));
                
                setTimeout(async () => {
                  if (clientWs.readyState === WebSocket.OPEN && lastStartConfig && !sessionActive) {
                    try {
                      console.log("[Auto-Reconnect] Reconnecting to Gemini Live...");
                      await initGeminiLive(
                        lastStartConfig.showId,
                        lastStartConfig.systemPrompt,
                        lastStartConfig.language,
                        lastStartConfig.contextData,
                        lastStartConfig.voicePreference,
                        lastStartConfig.modelPreference
                      );
                    } catch (e) {
                      console.error("[Auto-Reconnect] Failed:", e);
                      clientWs.send(JSON.stringify({ 
                        type: "cohost.session_ended", 
                        reason: "reconnect_failed",
                        message: "Automatische Wiederverbindung fehlgeschlagen. Bitte neu starten."
                      }));
                    }
                  }
                }, 2000);
              } else if (wasActive && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ 
                  type: "cohost.session_ended", 
                  reason: "closed",
                  message: "Session wurde vom Server beendet"
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
      const msgStr = typeof message === "string" ? message : message.toString();
      if (msgStr.length > MAX_CONTROL_MESSAGE_BYTES) {
        console.warn(`Co-Host message too large (${msgStr.length} bytes), ignoring`);
        return;
      }
      console.log("Co-Host received message:", typeof message, msgStr.slice(0, 200));
      
      // Handle text messages (commands)
      try {
        const data = JSON.parse(msgStr);
        if (!isRecord(data) || typeof data.type !== "string") {
          return;
        }
        console.log("Co-Host parsed message:", data.type);
        
        if (data.type === "start") {
            // Note: currentUserId is already set from authenticated session during upgrade
            
            // Validate showId if provided - verify ownership with authenticatedUserId
            const showId = typeof data.showId === "number" && Number.isInteger(data.showId) ? data.showId : null;
            if (showId !== null) {
              const show = await storage.getShow(showId, currentUserId || undefined);
              if (!show) {
                clientWs.send(JSON.stringify({ type: "error", message: "Invalid show ID or not authorized" }));
                return;
              }
              currentShowId = showId;
            } else {
              currentShowId = null;
            }
            
            // Retrieve context from store if contextId is provided
            let contextData = isRecord(data.contextData) ? data.contextData : undefined;
            const contextId = typeof data.contextId === "string" ? data.contextId : undefined;
            if (contextId) {
              const storedContext = contextStore.get(contextId);
              if (storedContext) {
                console.log(`Retrieved stored context ${contextId}: text=${storedContext.text?.length || 0} chars`);
                contextData = {
                  text: storedContext.text,
                  files: storedContext.files,
                  sourceIds: storedContext.sourceIds
                };
                // Delete after retrieval (one-time use)
                contextStore.delete(contextId);
              } else {
                // Context not found - likely expired or invalid
                console.error(`Context ${contextId} not found in store (expired or invalid)`);
                clientWs.send(JSON.stringify({ 
                  type: "cohost.context_error", 
                  error: "Context expired or not found. Please try again.",
                  contextId
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
            const systemPrompt = typeof data.systemPrompt === "string" ? data.systemPrompt : undefined;
            const language = typeof data.language === "string" && data.language.length <= 16 ? data.language : "de-CH";
            const VALID_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];
            const voicePreference = typeof data.voicePreference === "string" && VALID_VOICES.includes(data.voicePreference) ? data.voicePreference : "Kore";
            const VALID_MODELS = ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-preview-12-2025"];
            const modelPreference = typeof data.modelPreference === "string" && VALID_MODELS.includes(data.modelPreference) ? data.modelPreference : "gemini-3.1-flash-live-preview";
            lastStartConfig = { showId: currentShowId, systemPrompt, language, contextData, voicePreference, modelPreference };
            await initGeminiLive(currentShowId, systemPrompt, language, contextData, voicePreference, modelPreference);
            return;
          }
          
          if (data.type === "text" && geminiSession && sessionActive) {
            if (typeof data.text !== "string" || data.text.length > MAX_TEXT_MESSAGE_LENGTH) {
              clientWs.send(JSON.stringify({ type: "error", message: "Invalid text payload" }));
              return;
            }
            // Send text message to Gemini via sendRealtimeInput (required for 3.1 Flash Live)
            // Note: sendClientContent is only for seeding initial context in 3.1, not for live interaction
            console.log("[Co-Host] Sending text via sendRealtimeInput:", data.text.slice(0, 100));
            try {
              await geminiSession.sendRealtimeInput({
                text: data.text
              });
              console.log("[Co-Host] Text sent successfully via sendRealtimeInput");
            } catch (e) {
              console.error("[Co-Host] sendRealtimeInput failed:", e);
              // Fallback for older models (2.5): try sendClientContent
              try {
                console.log("[Co-Host] Falling back to sendClientContent...");
                await geminiSession.sendClientContent({
                  turns: [{ role: "user", parts: [{ text: data.text }] }],
                  turnComplete: true
                });
                console.log("[Co-Host] Fallback sendClientContent succeeded");
              } catch (e2) {
                console.error("[Co-Host] Both methods failed:", e2);
                clientWs.send(JSON.stringify({ type: "error", message: "Text-Nachricht konnte nicht verarbeitet werden" }));
              }
            }
            return;
          }
        // Handle audio data from JSON message
        if (data.type === "audio" && data.data && geminiSession && sessionActive) {
          if (typeof data.data !== "string" || data.data.length > MAX_AUDIO_BASE64_LENGTH) {
            console.warn("Dropping oversized audio payload");
            return;
          }
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
          lastStartConfig = null; // Prevent auto-reconnect on manual stop
          
          // Clear keep-alive
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
          }
          
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
      lastStartConfig = null; // Prevent auto-reconnect when client disconnects
      
      // Clear keep-alive
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      
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
  };
}
