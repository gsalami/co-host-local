import { apiUrl, BASE_PATH } from "@/lib/config";
import { useEffect, useRef, useState, useCallback } from "react";

export interface TranscriptEvent {
  type: "transcript.partial" | "transcript.final";
  text: string;
  speaker: number | null;
  timestamp: string;
  speechDuration?: number; // Duration in seconds of actual speech (from Deepgram word timestamps)
}

export type AudioSource = "microphone" | "tab" | "both";
export type TranscriptLanguage = "de-CH" | "en";
export type SttProvider = "deepgram" | "elevenlabs";

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;

export type DeepgramStatus = "connected" | "disconnected" | "reconnecting";

const STT_PROVIDER_STORAGE_KEY = "stt-provider";

const getStoredSttProvider = (): SttProvider => {
  if (typeof window === "undefined") return "deepgram";
  const stored = window.localStorage.getItem(STT_PROVIDER_STORAGE_KEY);
  return stored === "elevenlabs" ? "elevenlabs" : "deepgram";
};

export function useWebSocketAudio() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [deepgramStatus, setDeepgramStatus] = useState<DeepgramStatus>("disconnected");
  const [audioSource, setAudioSource] = useState<AudioSource>("microphone");
  const [language, setLanguage] = useState<TranscriptLanguage>("de-CH");
  const [sttProvider, setSttProvider] = useState<SttProvider>(() => getStoredSttProvider());
  const [speechDuration, setSpeechDuration] = useState(0); // Accumulated actual speech time in seconds
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletGainRef = useRef<GainNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmGainRef = useRef<GainNode | null>(null);
  const onTranscriptRef = useRef<((event: TranscriptEvent) => void) | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const speechDurationRef = useRef(0); // Track accumulated speech for usage tracking
  const currentShowIdRef = useRef<number | null>(null);
  const currentLanguageRef = useRef<TranscriptLanguage>("de-CH");
  const currentProviderRef = useRef<SttProvider>(sttProvider);
  const isRecordingRef = useRef(false); // Track recording state for reconnection handling

  useEffect(() => {
    currentProviderRef.current = sttProvider;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STT_PROVIDER_STORAGE_KEY, sttProvider);
    }
  }, [sttProvider]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}${BASE_PATH}/ws/audio`);

    ws.onopen = () => {
      console.log("WebSocket connected");
      setIsConnected(true);
      reconnectAttemptRef.current = 0;
      
      // If we were recording before reconnect, resend the start command
      if (isRecordingRef.current) {
        console.log("Reconnected while recording - resending start command", {
          showId: currentShowIdRef.current,
          language: currentLanguageRef.current,
          provider: currentProviderRef.current
        });
        ws.send(JSON.stringify({ 
          type: "start", 
          showId: currentShowIdRef.current, 
          language: currentLanguageRef.current,
          provider: currentProviderRef.current
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connection.ready") {
          console.log("Deepgram ready for audio");
          setIsReady(true);
          setDeepgramStatus("connected");
          return;
        }
        
        // Handle STT connection status messages
        if (data.type === "stt.connected") {
          console.log("STT connected", data.provider ? `(${data.provider})` : "");
          setDeepgramStatus("connected");
          return;
        }
        if (data.type === "stt.disconnected") {
          console.log("STT disconnected", data.message ? `- ${data.message}` : "");
          setDeepgramStatus("disconnected");
          return;
        }
        if (data.type === "stt.reconnecting") {
          console.log("STT reconnecting...");
          setDeepgramStatus("reconnecting");
          return;
        }
        if (data.type === "stt.health_timeout") {
          console.warn("STT health timeout - no response for", data.lastResponseSeconds, "seconds");
          setDeepgramStatus("disconnected");
          return;
        }

        // Handle Deepgram connection status messages
        if (data.type === "deepgram.connected") {
          console.log("Deepgram connected");
          setDeepgramStatus("connected");
          return;
        }
        if (data.type === "deepgram.disconnected") {
          console.log("Deepgram disconnected, code:", data.code, "reason:", data.reason, "meaning:", data.meaning);
          setDeepgramStatus("disconnected");
          return;
        }
        if (data.type === "deepgram.reconnecting") {
          console.log("Deepgram reconnecting...");
          setDeepgramStatus("reconnecting");
          return;
        }
        if (data.type === "deepgram.health_timeout") {
          console.warn("Deepgram health timeout - no response for", data.lastResponseSeconds, "seconds");
          setDeepgramStatus("disconnected");
          return;
        }
        
        // Accumulate speech duration from final transcripts
        const transcriptEvent = data as TranscriptEvent;
        if (transcriptEvent.type === "transcript.final" && transcriptEvent.speechDuration) {
          speechDurationRef.current += transcriptEvent.speechDuration;
          setSpeechDuration(prev => prev + transcriptEvent.speechDuration!);
        }
        
        onTranscriptRef.current?.(transcriptEvent);
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      setIsConnected(false);
      setIsReady(false);
      
      if (shouldReconnectRef.current) {
        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current += 1;
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(RECONNECT_MULTIPLIER, attempt),
          MAX_RECONNECT_DELAY
        );
        console.log(`Reconnecting in ${delay}ms (attempt ${attempt + 1})`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    wsRef.current = ws;
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

  const getMicrophoneStream = async (): Promise<MediaStream> => {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  };

  const getTabAudioStream = async (): Promise<MediaStream> => {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    
    displayStreamRef.current = displayStream;
    
    const videoTrack = displayStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = false;
    }
    
    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach(t => t.stop());
      throw new Error("No audio track selected. Please check 'Share audio' when sharing.");
    }
    
    return new MediaStream(audioTracks);
  };

  const combineAudioStreams = (streams: MediaStream[]): MediaStream => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    
    const destination = audioContext.createMediaStreamDestination();
    
    streams.forEach(stream => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });
    
    return destination.stream;
  };

  const combineAudioStreamsWithContext = (streams: MediaStream[], audioContext: AudioContext): MediaStream => {
    const destination = audioContext.createMediaStreamDestination();

    streams.forEach((stream) => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });

    return destination.stream;
  };

  const startPcmStreaming = async (stream: MediaStream): Promise<void> => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = audioContextRef.current ?? new AudioContextClass({ sampleRate: 16000 });
    audioContextRef.current = audioContext;

    try {
      await audioContext.audioWorklet.addModule(`${BASE_PATH}/audio-processor.js`);
      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioContext, "audio-processor");
      workletNodeRef.current = worklet;
      workletSourceRef.current = source;
      worklet.port.onmessage = (event) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
      };

      const gain = audioContext.createGain();
      gain.gain.value = 0;
      workletGainRef.current = gain;

      source.connect(worklet);
      worklet.connect(gain);
      gain.connect(audioContext.destination);
    } catch (error) {
      console.warn("AudioWorklet not available, falling back to ScriptProcessor", error);
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      pcmSourceRef.current = source;

      processor.onaudioprocess = (event) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const inputData = event.inputBuffer.getChannelData(0);
        const int16Array = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        wsRef.current.send(int16Array.buffer);
      };

      const gain = audioContext.createGain();
      gain.gain.value = 0;
      pcmGainRef.current = gain;

      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);
    }
  };

  const startRecording = useCallback(async (
    source: AudioSource = audioSource,
    showId?: number | null,
    lang: TranscriptLanguage = language,
    provider: SttProvider = sttProvider
  ) => {
    if (!isConnected) {
      console.log("WebSocket not connected");
      return;
    }
    
    try {
      wsRef.current?.send(JSON.stringify({ type: "start", showId, language: lang, provider }));
      currentShowIdRef.current = showId ?? null;
      currentLanguageRef.current = lang;
      currentProviderRef.current = provider;
      isRecordingRef.current = true; // Track for reconnection handling
      // Reset speech duration for new recording session
      speechDurationRef.current = 0;
      setSpeechDuration(0);
      
      let streamToRecord: MediaStream;
      
      if (source === "microphone") {
        const micStream = await getMicrophoneStream();
        micStreamRef.current = micStream;
        streamToRecord = micStream;
        console.log("Recording from microphone");
        
      } else if (source === "tab") {
        const tabStream = await getTabAudioStream();
        tabStreamRef.current = tabStream;
        streamToRecord = tabStream;
        console.log("Recording from tab audio");
        
      } else {
        const micStream = await getMicrophoneStream();
        micStreamRef.current = micStream;
        
        const tabStream = await getTabAudioStream();
        tabStreamRef.current = tabStream;

        if (provider === "elevenlabs") {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioContext = new AudioContextClass({ sampleRate: 16000 });
          audioContextRef.current = audioContext;
          streamToRecord = combineAudioStreamsWithContext([micStream, tabStream], audioContext);
        } else {
          const combined = combineAudioStreams([micStream, tabStream]);
          streamToRecord = combined;
        }
        console.log("Recording from both microphone and tab audio");
      }

      if (provider === "elevenlabs") {
        await startPcmStreaming(streamToRecord);
        mediaRecorderRef.current = null;
      } else {
        const mediaRecorder = new MediaRecorder(streamToRecord, {
          mimeType: "audio/webm;codecs=opus",
        });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(event.data);
          }
        };

        mediaRecorder.start(100);
        mediaRecorderRef.current = mediaRecorder;
      }
      setAudioSource(source);
      setIsRecording(true);
      console.log("Recording started");
    } catch (error: unknown) {
      console.error("Error starting recording:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorName = error instanceof Error ? error.name : "";
      
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
      }
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach(t => t.stop());
        displayStreamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      if (errorName === "NotAllowedError") {
        alert("Zugriff verweigert. Bitte erlauben Sie den Zugriff auf Mikrofon/Bildschirm.");
      } else if (errorMessage.includes("No audio track")) {
        alert("Kein Audio ausgewählt. Bitte 'Audio teilen' ankreuzen beim Tab-Teilen.");
      } else {
        alert(`Fehler: ${errorMessage}`);
      }
    }
  }, [isConnected, audioSource, language, sttProvider]);

  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false; // Clear recording state for reconnection handling
    
    // Send stop message to server to close Deepgram connection
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    }
    
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (workletSourceRef.current) {
      workletSourceRef.current.disconnect();
      workletSourceRef.current = null;
    }
    if (workletGainRef.current) {
      workletGainRef.current.disconnect();
      workletGainRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (pcmSourceRef.current) {
      pcmSourceRef.current.disconnect();
      pcmSourceRef.current = null;
    }
    if (pcmGainRef.current) {
      pcmGainRef.current.disconnect();
      pcmGainRef.current = null;
    }
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (tabStreamRef.current) {
      tabStreamRef.current.getTracks().forEach((track) => track.stop());
      tabStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Track actual speech time (not wall-clock time)
    const durationSeconds = Math.round(speechDurationRef.current);
    if (durationSeconds > 0) {
      try {
        await fetch(apiUrl("/api/usage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "transcript",
            seconds: durationSeconds,
            showId: currentShowIdRef.current
          })
        });
        console.log(`Tracked ${durationSeconds}s actual speech time`);
      } catch (error) {
        console.error("Error tracking usage:", error);
      }
    }
    // Reset speech duration for next recording
    speechDurationRef.current = 0;
    setSpeechDuration(0);
    
    mediaRecorderRef.current = null;
    setIsRecording(false);
    console.log("Recording stopped");
  }, []);

  const onTranscript = useCallback((callback: (event: TranscriptEvent) => void) => {
    onTranscriptRef.current = callback;
  }, []);

  const reconnectDeepgram = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Sending reconnect command to server...");
      setDeepgramStatus("reconnecting");
      wsRef.current.send(JSON.stringify({ type: "reconnect" }));
    }
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      stopRecording();
      disconnect();
    };
  }, [connect, disconnect, stopRecording]);

  return {
    isConnected,
    isRecording,
    isReady,
    deepgramStatus,
    audioSource,
    language,
    sttProvider,
    setSttProvider,
    speechDuration, // Actual speaking time in seconds
    setLanguage,
    startRecording,
    stopRecording,
    onTranscript,
    reconnectDeepgram,
  };
}
