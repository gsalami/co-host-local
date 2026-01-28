import { apiUrl, BASE_PATH } from "@/lib/config";
import { useState, useEffect, useRef, useCallback } from "react";

export interface CoHostEvent {
  type: "cohost.ready" | "cohost.audio" | "cohost.text" | "cohost.user_transcript" | "cohost.assistant_transcript" | "cohost.turn_complete" | "cohost.interrupted" | "cohost.stopped" | "cohost.processing_context" | "cohost.context_error" | "cohost.context_tokens" | "cohost.elapsed" | "cohost.session_ended" | "error";
  data?: string;
  text?: string;
  mimeType?: string;
  message?: string;
  total?: number;
  current?: number;
  fileName?: string;
  error?: string;
  turnId?: number;
  tokens?: number;
  maxTokens?: number;
  seconds?: number;
  reason?: string;
}

export type CoHostLanguage = "de-CH" | "en";

export interface ContextFile {
  name: string;
  type: string;
  data: string; // base64 encoded
}

export interface ContextData {
  text?: string;
  files?: ContextFile[];
}

export interface ContextProgress {
  total: number;
  current: number;
  fileName?: string;
}

export interface TokenInfo {
  tokens: number;
  maxTokens: number;
}

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;

export function useCoHostWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [language, setLanguage] = useState<CoHostLanguage>("de-CH");
  const [contextProgress, setContextProgress] = useState<ContextProgress | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [voiceInSeconds, setVoiceInSeconds] = useState(0);
  const [voiceOutSeconds, setVoiceOutSeconds] = useState(0);
  const isMutedRef = useRef(false);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null); // For playback
  const recordingContextRef = useRef<AudioContext | null>(null); // For recording
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const eventCallbackRef = useRef<((event: CoHostEvent) => void) | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const audioUnlockedRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0); // For seamless scheduling
  const recordingInProgressRef = useRef(false);
  const recordingStoppedAtRef = useRef<number>(0);
  const lastInterruptedTurnIdRef = useRef<number>(-1); // Turn ID that was interrupted (-1 = none)
  const highestSeenTurnIdRef = useRef<number>(-1); // Highest turn ID seen in audio
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  const currentShowIdRef = useRef<number | null>(null);
  
  // Refs for callback functions to avoid closure issues in WebSocket handlers
  const playAudioRef = useRef<((base64Data: string, mimeType?: string, turnId?: number) => Promise<void>) | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}${BASE_PATH}/ws/cohost`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Co-Host WebSocket connected");
      setIsConnected(true);
      setReconnectAttempt(0);
      reconnectAttemptRef.current = 0;
      lastInterruptedTurnIdRef.current = -1;
      highestSeenTurnIdRef.current = -1;
    };

    ws.onclose = () => {
      console.log("Co-Host WebSocket disconnected");
      setIsConnected(false);
      setIsReady(false);
      setIsRecording(false);
      setElapsedSeconds(0); // Reset timer on disconnect
      
      if (shouldReconnectRef.current) {
        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current += 1;
        setReconnectAttempt(attempt + 1);
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(RECONNECT_MULTIPLIER, attempt),
          MAX_RECONNECT_DELAY
        );
        console.log(`Co-Host reconnecting in ${delay}ms (attempt ${attempt + 1})`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    ws.onerror = (error) => {
      console.error("Co-Host WebSocket error:", error);
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data) as CoHostEvent;
        
        if (data.type === "cohost.ready") {
          setContextProgress(null); // Clear progress when ready
          setIsReady(true);
          // Reset speech timers for new session
          setVoiceInSeconds(0);
          setVoiceOutSeconds(0);
          setElapsedSeconds(0);
          // Reset interrupt tracking for new session
          lastInterruptedTurnIdRef.current = -1;
          highestSeenTurnIdRef.current = -1;
        }
        
        if (data.type === "cohost.processing_context") {
          setContextProgress({
            total: data.total || 0,
            current: data.current || 0,
            fileName: data.fileName
          });
        }
        
        if (data.type === "cohost.context_tokens" && data.tokens !== undefined) {
          setTokenInfo({
            tokens: data.tokens,
            maxTokens: data.maxTokens || 1000000
          });
        }
        
        if (data.type === "cohost.audio" && data.data) {
          if (playAudioRef.current) {
            await playAudioRef.current(data.data, data.mimeType, data.turnId);
          }
        }
        
        if (data.type === "cohost.interrupted") {
          // Server confirmed interruption - audio from this turn is now being blocked server-side
          // Also block client-side in case any in-flight audio arrives
          if (data.turnId !== undefined) {
            // Server sends the interrupted turn ID directly
            if (data.turnId > lastInterruptedTurnIdRef.current) {
              lastInterruptedTurnIdRef.current = data.turnId;
            }
            console.log("Interrupt confirmed, blocked turn:", data.turnId);
          }
        }
        
        if (data.type === "cohost.turn_complete") {
          setIsSpeaking(false);
          // No need to update interrupt tracking on turn complete
        }
        
        if (data.type === "cohost.context_error") {
          // Context upload failed or expired
          console.error("Context error:", data.error);
          setContextProgress(null);
          setIsReady(false);
        }
        
        if (data.type === "cohost.stopped") {
          // Reset all timers when session stops
          setVoiceInSeconds(0);
          setVoiceOutSeconds(0);
          setElapsedSeconds(0);
        }
        
        if (data.type === "cohost.session_ended") {
          // Session was ended by the server (timeout, error, or connection issue)
          console.log("Co-Host session ended by server:", data.reason, data.message);
          setIsReady(false);
          setIsRecording(false);
          setContextProgress(null);
          setVoiceInSeconds(0);
          setVoiceOutSeconds(0);
          setElapsedSeconds(0);
        }
        
        if (eventCallbackRef.current) {
          eventCallbackRef.current(data);
        }
      } catch (e) {
        console.error("Error parsing Co-Host message:", e);
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Initialize AudioContext with mobile support (don't force sample rate)
  const getOrCreateAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      // Don't force sampleRate - let the browser use its native rate
      audioContextRef.current = new AudioContextClass();
      console.log("Created AudioContext with sample rate:", audioContextRef.current.sampleRate);
    }
    return audioContextRef.current;
  }, []);

  // Unlock audio on user interaction (required for mobile)
  const unlockAudio = useCallback(async () => {
    if (audioUnlockedRef.current) return;
    
    const ctx = getOrCreateAudioContext();
    
    // Resume if suspended
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        console.log("AudioContext resumed successfully, state:", ctx.state);
      } catch (e) {
        console.error("Failed to resume AudioContext:", e);
      }
    }
    
    // Play a very short silent sound to fully unlock audio on iOS/Android
    try {
      const silentBuffer = ctx.createBuffer(1, 2400, 24000); // 0.1 sec silence
      const source = ctx.createBufferSource();
      source.buffer = silentBuffer;
      source.connect(ctx.destination);
      source.start();
      console.log("Silent audio played for unlock");
    } catch (e) {
      console.error("Failed to play silent audio:", e);
    }
    
    audioUnlockedRef.current = true;
    console.log("Audio unlocked, context state:", ctx.state);
  }, [getOrCreateAudioContext]);

  // Add touch/click listeners to unlock audio on mobile
  useEffect(() => {
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    
    const handleUnlock = () => {
      unlockAudio();
      // Remove listeners after first interaction
      events.forEach(event => {
        document.removeEventListener(event, handleUnlock);
      });
    };
    
    events.forEach(event => {
      document.addEventListener(event, handleUnlock, { passive: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleUnlock);
      });
    };
  }, [unlockAudio]);

  const processAudioQueue = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      return;
    }
    
    const ctx = getOrCreateAudioContext();
    
    // Ensure audio is resumed before playing
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.error("Failed to resume AudioContext for playback:", e);
        return;
      }
    }
    
    // Schedule all queued buffers with precise timing for seamless playback
    while (audioQueueRef.current.length > 0) {
      const audioBuffer = audioQueueRef.current.shift();
      if (!audioBuffer || !audioContextRef.current) continue;
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      currentSourceRef.current = source;
      
      // Track source for mute functionality
      activeSourcesRef.current.add(source);
      
      // Calculate when to start this chunk
      const now = audioContextRef.current.currentTime;
      const startTime = Math.max(now, nextPlayTimeRef.current);
      
      // Schedule for seamless playback
      source.start(startTime);
      
      // Update next play time to when this buffer ends
      nextPlayTimeRef.current = startTime + audioBuffer.duration;
      
      // Set speaking state on first chunk
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsSpeaking(true);
      }
      
      // Track when last source ends
      source.onended = () => {
        currentSourceRef.current = null;
        activeSourcesRef.current.delete(source);
        // Check if we're done (no more scheduled audio)
        if (audioContextRef.current && audioContextRef.current.currentTime >= nextPlayTimeRef.current - 0.01) {
          isPlayingRef.current = false;
          setIsSpeaking(false);
        }
      };
    }
  }, [getOrCreateAudioContext]);

  // Parse mimeType to extract sample rate and channels
  const parseAudioMimeType = (mimeType?: string): { sampleRate: number; channels: number } => {
    // Default: Gemini typically sends audio/pcm;rate=24000
    let sampleRate = 24000;
    let channels = 1;
    
    if (mimeType) {
      // Parse rate=XXXX
      const rateMatch = mimeType.match(/rate=(\d+)/);
      if (rateMatch) {
        sampleRate = parseInt(rateMatch[1], 10);
      }
      // Parse channels=X
      const channelsMatch = mimeType.match(/channels=(\d+)/);
      if (channelsMatch) {
        channels = parseInt(channelsMatch[1], 10);
      }
    }
    
    return { sampleRate, channels };
  };

  const playAudio = async (base64Data: string, mimeType?: string, turnId?: number) => {
    // Skip audio playback if muted
    if (isMutedRef.current) {
      return;
    }
    
    // Discard audio while recording (user is speaking)
    if (recordingInProgressRef.current) {
      console.log("Discarding audio while recording");
      return;
    }
    
    // Track highest seen turn ID for interrupt handling
    if (turnId !== undefined && turnId > highestSeenTurnIdRef.current) {
      highestSeenTurnIdRef.current = turnId;
    }
    
    // Discard audio from interrupted turns
    // Simple logic: if audio's turnId <= lastInterruptedTurnId, it's from an old response
    if (turnId !== undefined && lastInterruptedTurnIdRef.current >= 0 && turnId <= lastInterruptedTurnIdRef.current) {
      console.log("Discarding audio from interrupted turn:", turnId, "<= interrupted:", lastInterruptedTurnIdRef.current);
      return;
    }
    
    try {
      const ctx = getOrCreateAudioContext();
      const { sampleRate: sourceSampleRate, channels } = parseAudioMimeType(mimeType);
      console.log("playAudio called, mimeType:", mimeType, "sourceSampleRate:", sourceSampleRate, "channels:", channels, "context state:", ctx.state);
      
      // Try to resume if suspended
      if (ctx.state === 'suspended') {
        console.log("Context suspended, attempting to resume...");
        await ctx.resume();
        console.log("Context resumed, new state:", ctx.state);
      }
      
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Create a properly aligned buffer for Int16Array
      const alignedBuffer = new ArrayBuffer(bytes.length);
      new Uint8Array(alignedBuffer).set(bytes);
      const int16Array = new Int16Array(alignedBuffer);
      
      // Handle mono/stereo conversion
      const samplesPerChannel = Math.floor(int16Array.length / channels);
      const float32Array = new Float32Array(samplesPerChannel);
      
      if (channels === 2) {
        // Stereo: mix down to mono by averaging left and right channels
        for (let i = 0; i < samplesPerChannel; i++) {
          const left = int16Array[i * 2] / 32768.0;
          const right = int16Array[i * 2 + 1] / 32768.0;
          float32Array[i] = (left + right) / 2;
        }
      } else {
        // Mono: direct conversion
        for (let i = 0; i < samplesPerChannel; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }
      }
      
      // Create audio buffer at source sample rate, then resample if needed
      const audioBuffer = ctx.createBuffer(1, float32Array.length, sourceSampleRate);
      audioBuffer.getChannelData(0).set(float32Array);
      
      // Track voice_out duration (AI speaking time)
      const chunkDuration = audioBuffer.duration;
      setVoiceOutSeconds(prev => prev + chunkDuration);
      
      console.log("Audio buffer created, duration:", audioBuffer.duration.toFixed(3), "s, samples:", float32Array.length);
      
      // Add to queue instead of playing immediately
      audioQueueRef.current.push(audioBuffer);
      processAudioQueue();
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  };
  playAudioRef.current = playAudio;

  const cleanup = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    // Clean up recording context and processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (recordingContextRef.current) {
      recordingContextRef.current.close();
      recordingContextRef.current = null;
    }
    // Note: audioContextRef is for playback, keep it alive
    mediaRecorderRef.current = null;
    streamRef.current = null;
  };

  const startSession = useCallback(async (showId?: number, systemPrompt?: string, lang?: CoHostLanguage, contextData?: ContextData & { sourceIds?: number[] }, userId?: string, voicePreference?: "Kore" | "Puck"): Promise<boolean> => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      eventCallbackRef.current?.({ type: "error", message: "WebSocket not connected" });
      return false;
    }
    
    // Reset interrupt tracking immediately to ensure new session audio plays
    lastInterruptedTurnIdRef.current = -1;
    highestSeenTurnIdRef.current = -1;
    
    // Explicitly unlock audio when session starts (user gesture)
    await unlockAudio();
    
    const selectedLanguage = lang || language;
    
    // Log context info for debugging
    console.log("Starting Co-Host session with context:", contextData ? {
      hasText: !!contextData.text,
      textLength: contextData.text?.length || 0,
      filesCount: contextData.files?.length || 0,
      sourceIds: (contextData as any).sourceIds?.length || 0
    } : "none");
    
    // Check if context is large enough to require HTTP upload
    // Threshold: 50KB (well under typical WebSocket limits)
    const contextPayload = contextData ? JSON.stringify(contextData) : "";
    const LARGE_CONTEXT_THRESHOLD = 50 * 1024; // 50KB
    
    const payload: Record<string, unknown> = { type: "start", showId, systemPrompt, language: selectedLanguage, userId, voicePreference };
    
    if (contextPayload.length > LARGE_CONTEXT_THRESHOLD) {
      // Upload large context via HTTP first
      console.log(`Context too large (${contextPayload.length} bytes), uploading via HTTP...`);
      try {
        const response = await fetch(apiUrl("/api/cohost/context"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: contextPayload
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          const errorMessage = errorData.error || `Upload failed: ${response.status}`;
          console.error("Context upload failed:", errorMessage);
          eventCallbackRef.current?.({ type: "cohost.context_error", error: errorMessage });
          return false;
        }
        
        const { contextId } = await response.json();
        console.log(`Context uploaded successfully, contextId: ${contextId}`);
        payload.contextId = contextId;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to upload context";
        console.error("Failed to upload context via HTTP:", error);
        eventCallbackRef.current?.({ type: "cohost.context_error", error: errorMessage });
        return false;
      }
    } else if (contextData) {
      // Small context can go directly via WebSocket
      payload.contextData = contextData;
    }
    
    const jsonPayload = JSON.stringify(payload);
    console.log("WebSocket payload size:", jsonPayload.length, "bytes");
    
    wsRef.current.send(jsonPayload);
    sessionStartTimeRef.current = Date.now();
    currentShowIdRef.current = showId ?? null;
    return true;
  }, [unlockAudio, language]);

  const stopSession = useCallback(async () => {
    // Stop any active recording
    cleanup();
    setIsRecording(false);
    recordingInProgressRef.current = false;
    
    // Clear audio queue
    audioQueueRef.current = [];
    nextPlayTimeRef.current = 0;
    
    // Reset interrupt tracking
    lastInterruptedTurnIdRef.current = -1;
    highestSeenTurnIdRef.current = -1;
    
    // Track usage - all sessions
    if (sessionStartTimeRef.current) {
      const durationMs = Date.now() - sessionStartTimeRef.current;
      const durationSeconds = Math.round(durationMs / 1000);
      if (durationSeconds > 0) {
        try {
          await fetch(apiUrl("/api/usage"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "voice",
              seconds: durationSeconds,
              showId: currentShowIdRef.current
            })
          });
          console.log(`Tracked ${durationSeconds}s voice`);
        } catch (error) {
          console.error("Error tracking voice usage:", error);
        }
      }
      sessionStartTimeRef.current = null;
    }
    
    // Send stop message to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    }
    
    setIsReady(false);
    setIsSpeaking(false);
    console.log("Session stopped");
  }, []);

  const startRecording = useCallback(async () => {
    // Prevent re-entry and double calls
    if (recordingInProgressRef.current || isRecording) {
      console.log("Recording already in progress, ignoring");
      return;
    }
    
    if (!wsRef.current || !isReady) {
      console.error("Co-Host session not ready");
      return;
    }

    recordingInProgressRef.current = true;

    // Clean up any existing recording session first
    cleanup();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      
      // Check if recording was cancelled while waiting for getUserMedia
      if (!recordingInProgressRef.current) {
        console.log("Recording cancelled during initialization");
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      streamRef.current = stream;
      
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      recordingContextRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const int16Array = new Int16Array(inputData.length);
        
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Track voice_in duration: 4096 samples at 16kHz = 0.256 seconds per chunk
        const chunkDurationSec = inputData.length / 16000;
        setVoiceInSeconds(prev => prev + chunkDurationSec);
        
        const base64 = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(int16Array.buffer))));
        
        wsRef.current.send(JSON.stringify({
          type: "audio",
          data: base64
        }));
      };
      
      source.connect(processor);
      processor.connect(audioCtx.destination);
      
      setIsRecording(true);
      console.log("Co-Host recording started");
    } catch (error) {
      console.error("Error starting Co-Host recording:", error);
      recordingInProgressRef.current = false;
    }
  }, [isReady, isRecording]);

  const stopRecording = useCallback(() => {
    recordingInProgressRef.current = false;
    recordingStoppedAtRef.current = Date.now(); // Track when recording stopped for debounce
    cleanup();
    setIsRecording(false);
    
    // Send audio stream end signal to tell Gemini the audio input is complete
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "audioStreamEnd" }));
    }
    
    console.log("Co-Host recording stopped");
  }, []);

  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isReady) {
      console.error("Co-Host session not ready");
      return;
    }
    
    wsRef.current.send(JSON.stringify({ type: "text", text }));
  }, [isReady]);

  // Interrupt the current response and clear audio queue
  const interrupt = useCallback(() => {
    console.log("Interrupting Co-Host response");
    
    // Set lastInterruptedTurnIdRef to the highest seen turn ID immediately
    // This ensures any in-flight audio from the current turn is discarded
    // Server will confirm with cohost.interrupted and we'll update if needed
    if (highestSeenTurnIdRef.current >= 0) {
      lastInterruptedTurnIdRef.current = highestSeenTurnIdRef.current;
      console.log("Set interrupted turn to:", lastInterruptedTurnIdRef.current);
    }
    
    // Stop ALL active audio sources (including scheduled ones)
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore - source might already be stopped
      }
    });
    activeSourcesRef.current.clear();
    currentSourceRef.current = null;
    
    // Clear the audio queue
    audioQueueRef.current = [];
    
    // Reset scheduling time for next response
    nextPlayTimeRef.current = 0;
    
    // Stop playback loop
    isPlayingRef.current = false;
    setIsSpeaking(false);
    
    // Send interrupt signal to server (Gemini supports interrupts)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
  }, []);

  const onEvent = useCallback((callback: (event: CoHostEvent) => void) => {
    eventCallbackRef.current = callback;
  }, []);

  // Update elapsedSeconds as sum of voice_in + voice_out
  useEffect(() => {
    setElapsedSeconds(Math.round(voiceInSeconds + voiceOutSeconds));
  }, [voiceInSeconds, voiceOutSeconds]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMutedRef.current;
    isMutedRef.current = newMuted;
    setIsMuted(newMuted);
    
    // If muting while audio is playing, stop all active sources
    if (newMuted) {
      // Stop all tracked audio sources (including filler audio)
      activeSourcesRef.current.forEach(source => {
        try {
          source.stop();
        } catch (e) {
          // Ignore - source might already be stopped
        }
      });
      activeSourcesRef.current.clear();
      currentSourceRef.current = null;
      audioQueueRef.current = [];
      nextPlayTimeRef.current = 0;
      isPlayingRef.current = false;
      setIsSpeaking(false);
    }
  }, []);

  return {
    isConnected,
    isReady,
    isRecording,
    isSpeaking,
    isMuted,
    language,
    contextProgress,
    tokenInfo,
    elapsedSeconds,
    voiceInSeconds,
    voiceOutSeconds,
    setLanguage,
    startSession,
    stopSession,
    startRecording,
    stopRecording,
    sendText,
    interrupt,
    toggleMute,
    onEvent,
  };
}
