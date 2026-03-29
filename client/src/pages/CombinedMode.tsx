import { apiUrl } from "@/lib/config";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Mic, MicOff, Send, Brain, Activity, Radio, ChevronDown, Plus, Volume2, VolumeX,
  Save, Trash2, FileText, ChevronRight, LogOut, Edit, RefreshCw, Search, X, Loader2,
  FileCode, ExternalLink, Settings, Star, MessageCircle, Headphones, RadioTower
} from "lucide-react";
import type { Source } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { toast } from "sonner";
import { useWebSocketAudio, type TranscriptEvent, type TranscriptLanguage } from "@/hooks/useWebSocketAudio";
import { useCoHostWebSocket, type CoHostEvent, type CoHostLanguage, type ContextData } from "@/hooks/useCoHostWebSocket";

interface Show {
  id: number;
  title: string;
  createdAt: string;
}

interface SystemPromptItem {
  id: number;
  name: string;
  prompt: string;
  createdAt: string;
}

type CombinedState = "IDLE" | "TRANSCRIBING" | "ASKING" | "ANSWERING";

interface TimelineEntry {
  id: number;
  type: "transcript" | "cohost-user" | "cohost-assistant";
  text: string;
  speaker?: number | null;
  timestamp: Date;
  isPartial?: boolean;
}

const SPEAKER_COLORS = [
  "text-primary",
  "text-emerald-400",
  "text-amber-400",
  "text-purple-400",
  "text-pink-400",
  "text-accent",
];

export default function CombinedMode() {
  // Shows
  const [shows, setShows] = useState<Show[]>([]);
  const [currentShow, setCurrentShow] = useState<Show | null>(null);
  const [newShowTitle, setNewShowTitle] = useState("");
  const [showDialogOpen, setShowDialogOpen] = useState(false);
  const [showSearch, setShowSearch] = useState("");
  const [showSelectorOpen, setShowSelectorOpen] = useState(false);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [savedPrompts, setSavedPrompts] = useState<SystemPromptItem[]>([]);
  const [newPromptName, setNewPromptName] = useState("");
  const [savePromptDialogOpen, setSavePromptDialogOpen] = useState(false);

  // Context
  const [contextText, setContextText] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");

  // Voice/Model preferences (persisted)
  const [voicePreference, setVoicePreference] = useState<string>(() => {
    if (typeof window === "undefined") return "Zephyr";
    return window.localStorage.getItem("cohost-voice") || "Zephyr";
  });
  const [modelPreference, setModelPreference] = useState<string>(() => {
    if (typeof window === "undefined") return "gemini-3.1-flash-live-preview";
    return window.localStorage.getItem("cohost-model") || "gemini-3.1-flash-live-preview";
  });

  // Combined state
  const [combinedState, setCombinedState] = useState<CombinedState>("IDLE");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [textInput, setTextInput] = useState("");
  const [partialAssistantText, setPartialAssistantText] = useState("");
  const [partialUserText, setPartialUserText] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const combinedStateRef = useRef<CombinedState>("IDLE");
  const sttWasRecordingRef = useRef(false);

  const { user } = useAuth();

  const { data: savedSources = [] } = useQuery<Source[]>({
    queryKey: ["/api/sources"],
  });

  // STT hook
  const stt = useWebSocketAudio();

  // CoHost hook
  const cohost = useCoHostWebSocket();

  // Keep ref in sync
  useEffect(() => {
    combinedStateRef.current = combinedState;
  }, [combinedState]);

  // Auto-scroll
  useEffect(() => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [timeline, partialAssistantText, partialUserText]);

  // Fetch shows and prompts
  useEffect(() => {
    fetchShows();
    fetchSystemPrompts();
  }, []);

  const fetchShows = async () => {
    try {
      const res = await fetch(apiUrl("/api/shows"));
      const data = await res.json();
      setShows(data);
    } catch (error) {
      console.error("Error fetching shows:", error);
    }
  };

  const fetchSystemPrompts = async () => {
    try {
      const res = await fetch(apiUrl("/api/system-prompts"));
      const data = await res.json();
      setSavedPrompts(data);
    } catch (error) {
      console.error("Error fetching system prompts:", error);
    }
  };

  // STT transcript handler
  useEffect(() => {
    stt.onTranscript((event: TranscriptEvent) => {
      if (event.type === "transcript.final") {
        setTimeline(prev => [...prev, {
          id: Date.now(),
          type: "transcript",
          text: event.text,
          speaker: event.speaker,
          timestamp: new Date(),
        }]);
      }
    });
  }, []);

  // CoHost event handler
  useEffect(() => {
    cohost.onEvent((event: CoHostEvent) => {
      if (event.type === "cohost.user_transcript" && event.text) {
        setPartialUserText(event.text);
      }

      if (event.type === "cohost.assistant_transcript" && event.text) {
        setPartialAssistantText(prev => prev + event.text);
      }

      if (event.type === "cohost.turn_complete") {
        // Commit partial texts to timeline
        if (partialUserText) {
          setTimeline(prev => [...prev, {
            id: Date.now() - 1,
            type: "cohost-user",
            text: partialUserText,
            timestamp: new Date(),
          }]);
          setPartialUserText("");
        }
        if (partialAssistantText) {
          setTimeline(prev => [...prev, {
            id: Date.now(),
            type: "cohost-assistant",
            text: partialAssistantText,
            timestamp: new Date(),
          }]);
          setPartialAssistantText("");
        }

        // Resume STT if we were transcribing before
        if (sttWasRecordingRef.current && combinedStateRef.current === "ANSWERING") {
          setCombinedState("TRANSCRIBING");
          stt.startRecording("microphone", currentShow?.id, stt.language);
        } else {
          setCombinedState(sttWasRecordingRef.current ? "TRANSCRIBING" : "IDLE");
          if (sttWasRecordingRef.current) {
            stt.startRecording("microphone", currentShow?.id, stt.language);
          }
        }
      }

      if (event.type === "cohost.audio") {
        // Mark as answering when first audio comes
        if (combinedStateRef.current === "ASKING") {
          setCombinedState("ANSWERING");
        }
      }

      if (event.type === "cohost.session_ended") {
        setSessionActive(false);
        setIsStarting(false);
        setCombinedState("IDLE");
        toast.warning(event.message || "Co-Host Session beendet");
      }

      if (event.type === "cohost.ready") {
        setIsStarting(false);
      }

      if (event.type === "error") {
        console.error("Co-Host error:", event.message);
      }
    });
  }, [partialUserText, partialAssistantText, currentShow]);

  // Track when CoHost stops speaking → resume STT
  useEffect(() => {
    if (!cohost.isSpeaking && combinedStateRef.current === "ANSWERING") {
      // Gemini stopped speaking, turn_complete should handle state transition
      // This is a safety net
    }
  }, [cohost.isSpeaking]);

  // Reset partialAssistantText when Gemini starts speaking (new response)
  const prevSpeakingRef = useRef(false);
  useEffect(() => {
    if (cohost.isSpeaking && !prevSpeakingRef.current) {
      setPartialAssistantText("");
    }
    prevSpeakingRef.current = cohost.isSpeaking;
  }, [cohost.isSpeaking]);

  const getContextData = (): ContextData | undefined => {
    const selectedSources = savedSources.filter(s => selectedSourceIds.includes(s.id));
    const combinedText = selectedSources.map(s => `--- ${s.title} ---\n${s.textContent}`).join("\n\n");
    const totalText = [combinedText, contextText.trim()].filter(Boolean).join("\n\n");
    if (!totalText) return undefined;
    return { text: totalText };
  };

  // Start combined session
  const handleStartSession = async () => {
    if (!currentShow) return;
    setIsStarting(true);
    setSessionActive(true);
    setTimeline([]);

    // Start CoHost session
    cohost.startSession(
      currentShow.id,
      systemPrompt || undefined,
      stt.language as CoHostLanguage,
      getContextData(),
      user?.id,
      voicePreference,
      modelPreference
    );
  };

  // Stop combined session
  const handleStopSession = () => {
    if (stt.isRecording) stt.stopRecording();
    cohost.stopSession();
    setSessionActive(false);
    setCombinedState("IDLE");
    sttWasRecordingRef.current = false;
  };

  // Toggle STT recording
  const handleToggleRecord = () => {
    if (combinedState === "TRANSCRIBING") {
      stt.stopRecording();
      setCombinedState("IDLE");
      sttWasRecordingRef.current = false;
    } else if (combinedState === "IDLE" && cohost.isReady) {
      stt.startRecording("microphone", currentShow?.id, stt.language);
      setCombinedState("TRANSCRIBING");
      sttWasRecordingRef.current = true;
    }
  };

  // PTT press handlers
  const usingTouchRef = useRef(false);

  const handlePTTStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.type.startsWith('mouse') && usingTouchRef.current) return;
    if (e.type.startsWith('touch')) {
      usingTouchRef.current = true;
      e.preventDefault();
    }

    if (!cohost.isReady) return;

    // If AI is speaking, interrupt it
    if (cohost.isSpeaking) {
      cohost.interrupt();
    }

    // Remember if STT was active
    sttWasRecordingRef.current = combinedStateRef.current === "TRANSCRIBING";

    // Stop STT
    if (stt.isRecording) {
      stt.stopRecording();
    }

    // Start CoHost recording
    setCombinedState("ASKING");
    cohost.startRecording();
  };

  const handlePTTEnd = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e && e.type.startsWith('mouse') && usingTouchRef.current) return;

    if (combinedStateRef.current === "ASKING") {
      cohost.stopRecording();
      setCombinedState("ANSWERING");
    }

    if (e?.type.startsWith('touch')) {
      setTimeout(() => { usingTouchRef.current = false; }, 100);
    }
  };

  // Send text to CoHost
  const handleSendText = () => {
    if (!textInput.trim() || !cohost.isReady) return;

    // Add to timeline
    setTimeline(prev => [...prev, {
      id: Date.now(),
      type: "cohost-user",
      text: textInput,
      timestamp: new Date(),
    }]);

    // Remember STT state
    sttWasRecordingRef.current = combinedStateRef.current === "TRANSCRIBING";

    // Pause STT while waiting for response
    if (stt.isRecording) {
      stt.stopRecording();
    }

    setCombinedState("ANSWERING");
    cohost.sendText(textInput);
    setTextInput("");
  };

  // Show selection
  const handleSelectShow = (show: Show | null) => {
    if (sessionActive) handleStopSession();
    setCurrentShow(show);
    setTimeline([]);
  };

  const handleCreateShow = async () => {
    if (!newShowTitle.trim()) return;
    try {
      const res = await fetch(apiUrl("/api/shows"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newShowTitle }),
      });
      const show = await res.json();
      setShows(prev => [show, ...prev]);
      setCurrentShow(show);
      setNewShowTitle("");
      setShowDialogOpen(false);
    } catch (error) {
      console.error("Error creating show:", error);
    }
  };

  const handleSavePrompt = async () => {
    if (!newPromptName.trim() || !systemPrompt.trim()) return;
    try {
      const res = await fetch(apiUrl("/api/system-prompts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPromptName, prompt: systemPrompt }),
      });
      const created = await res.json();
      setSavedPrompts(prev => [created, ...prev]);
      setNewPromptName("");
      setSavePromptDialogOpen(false);
    } catch (error) {
      console.error("Error saving prompt:", error);
    }
  };

  const toggleSourceSelection = (sourceId: number) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const getSpeakerDisplayName = (speaker: number): string => `Sprecher ${speaker + 1}`;
  const getSpeakerColor = (speaker: number | null): string => {
    if (speaker === null) return "text-muted-foreground";
    return SPEAKER_COLORS[speaker % SPEAKER_COLORS.length];
  };

  const getStateLabel = (): string => {
    switch (combinedState) {
      case "IDLE": return "BEREIT";
      case "TRANSCRIBING": return "AUFNAHME";
      case "ASKING": return "FRAGE...";
      case "ANSWERING": return "ANTWORT...";
    }
  };

  const getStateDotColor = (): string => {
    switch (combinedState) {
      case "IDLE": return "bg-primary";
      case "TRANSCRIBING": return "bg-success animate-pulse";
      case "ASKING": return "bg-amber-400 animate-pulse";
      case "ANSWERING": return "bg-accent animate-pulse";
    }
  };

  const hasContext = selectedSourceIds.length > 0 || !!contextText.trim();

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-foreground flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-14 sm:h-16 border-b border-border/40 glass flex items-center justify-between px-3 sm:px-6 z-10">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <div className="size-7 sm:size-8 rounded-full bg-accent/20 flex items-center justify-center">
              <RadioTower className="size-3 sm:size-4 text-accent animate-pulse-slow" />
            </div>
            <span className="font-mono font-bold tracking-tight text-sm sm:text-lg hidden sm:inline">
              COMBINED<span className="text-accent">MODE</span>
            </span>
          </div>

          {/* Show Selector */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Popover open={showSelectorOpen} onOpenChange={setShowSelectorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-1 sm:gap-2 min-w-[100px] sm:min-w-[200px] justify-between text-xs sm:text-sm">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Radio className="size-3 sm:size-4 text-primary" />
                    <span className="truncate max-w-[80px] sm:max-w-none">{currentShow?.title || "Keine Sendung"}</span>
                  </div>
                  <ChevronDown className="size-3 sm:size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[350px] p-0">
                <div className="p-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      placeholder="Sendung suchen..."
                      value={showSearch}
                      onChange={(e) => setShowSearch(e.target.value)}
                      className="pl-9 pr-8"
                    />
                    {showSearch && (
                      <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 size-6" onClick={() => setShowSearch("")}>
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <ScrollArea className="max-h-[300px]">
                  <div className="p-2">
                    <button
                      onClick={() => { handleSelectShow(null); setShowSelectorOpen(false); setShowSearch(""); }}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm text-muted-foreground"
                    >
                      Keine Sendung
                    </button>
                    {shows
                      .filter(show => show.title.toLowerCase().includes(showSearch.toLowerCase()))
                      .map((show) => (
                        <div
                          key={show.id}
                          className={`group flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent cursor-pointer ${currentShow?.id === show.id ? 'bg-accent' : ''}`}
                          onClick={() => { handleSelectShow(show); setShowSelectorOpen(false); setShowSearch(""); }}
                        >
                          <Radio className="size-3 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-sm">{show.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(show.createdAt).toLocaleDateString('de-CH')}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>

            <Dialog open={showDialogOpen} onOpenChange={setShowDialogOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="outline">
                  <Plus className="size-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Neue Sendung erstellen</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 pt-4">
                  <Input
                    placeholder="Sendungstitel eingeben..."
                    value={newShowTitle}
                    onChange={(e) => setNewShowTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateShow()}
                  />
                  <Button onClick={handleCreateShow} disabled={!newShowTitle.trim()}>
                    Sendung erstellen
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Select
              value={stt.language}
              onValueChange={(val) => stt.setLanguage(val as TranscriptLanguage)}
              disabled={stt.isRecording}
            >
              <SelectTrigger className="w-[120px] sm:w-[140px] text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de-CH">Deutsch</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* State badge */}
          {sessionActive && (
            <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary font-mono text-[10px] sm:text-xs hidden sm:flex">
              <div className={`size-1.5 rounded-full ${getStateDotColor()} mr-2`} />
              {getStateLabel()}
            </Badge>
          )}

          {/* STT status */}
          {stt.isRecording && (
            <Badge variant="outline" className="bg-success/10 border-success/30 text-success font-mono text-[10px] sm:text-xs hidden sm:flex">
              <Mic className="size-3 mr-1" />
              STT
            </Badge>
          )}

          {/* CoHost speaking */}
          {cohost.isSpeaking && (
            <Badge variant="secondary" className="gap-1 animate-pulse text-xs">
              <Volume2 className="size-3" />
              <span className="hidden sm:inline">Speaking</span>
            </Badge>
          )}

          {/* Timer */}
          {cohost.elapsedSeconds > 0 && (
            <Badge variant="outline" className="bg-purple-500/10 border-purple-500/30 text-purple-400 font-mono text-[10px] sm:text-xs">
              <Activity className="size-3 mr-1" />
              {formatElapsedTime(cohost.elapsedSeconds)}
            </Badge>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col p-3 sm:p-6 gap-4 sm:gap-6 overflow-y-auto max-w-4xl mx-auto w-full">

        {/* Pre-session setup */}
        {!sessionActive && (
          <Card className="p-4 sm:p-8 flex flex-col items-center justify-center gap-3 sm:gap-4 glass border-white/5">
            <RadioTower className="size-12 sm:size-16 text-accent/50" />
            <h2 className="text-lg sm:text-xl font-semibold">Combined Mode</h2>
            <p className="text-muted-foreground text-center max-w-md text-sm">
              Aufnahme + Co-Host kombiniert. Transkription läuft kontinuierlich, Co-Host per Push-to-Talk oder Text.
            </p>

            {/* System Prompt */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">System-Prompt (optional)</label>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 text-xs">
                        <ChevronDown className="size-3" />
                        Gespeichert
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[250px]">
                      {savedPrompts.length === 0 ? (
                        <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                          Keine gespeicherten Prompts
                        </DropdownMenuItem>
                      ) : (
                        savedPrompts.map((p) => (
                          <DropdownMenuItem key={p.id} onClick={() => setSystemPrompt(p.prompt)}>
                            <span className="truncate flex-1">{p.name}</span>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Dialog open={savePromptDialogOpen} onOpenChange={setSavePromptDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={!systemPrompt.trim()}>
                        <Save className="size-3" />
                        Speichern
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Prompt speichern</DialogTitle></DialogHeader>
                      <div className="flex flex-col gap-4 pt-4">
                        <Input placeholder="Name..." value={newPromptName} onChange={(e) => setNewPromptName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSavePrompt()} />
                        <div className="text-xs text-muted-foreground bg-secondary/50 p-3 rounded-lg max-h-24 overflow-auto">{systemPrompt}</div>
                        <Button onClick={handleSavePrompt} disabled={!newPromptName.trim()}>Speichern</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              <textarea
                className="w-full h-24 px-3 py-2 rounded-lg bg-secondary/50 border border-white/10 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="Zusätzliche Anweisungen für den Co-Host..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>

            {/* Model Selection */}
            <div className="w-full max-w-md">
              <label className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                <Brain className="size-4" />
                Gemini Modell
              </label>
              <Select value={modelPreference} onValueChange={(v) => { setModelPreference(v); localStorage.setItem("cohost-model", v); }}>
                <SelectTrigger className="w-full bg-secondary/50 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3.1-flash-live-preview">⚡ 3.1 Flash Live (Neu)</SelectItem>
                  <SelectItem value="gemini-2.5-flash-native-audio-preview-12-2025">🎙️ 2.5 Flash Audio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Voice Selection */}
            <div className="w-full max-w-md">
              <label className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                <Volume2 className="size-4" />
                Stimme
              </label>
              <Select value={voicePreference} onValueChange={(v) => { setVoicePreference(v); localStorage.setItem("cohost-voice", v); }}>
                <SelectTrigger className="w-full bg-secondary/50 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Kore">👩 Kore — Klar, neutral</SelectItem>
                  <SelectItem value="Aoede">👩 Aoede — Warm, melodisch</SelectItem>
                  <SelectItem value="Leda">👩 Leda — Ruhig, britisch</SelectItem>
                  <SelectItem value="Zephyr">👩 Zephyr — Leicht, luftig</SelectItem>
                  <SelectItem value="Puck">👨 Puck — Energisch</SelectItem>
                  <SelectItem value="Charon">👨 Charon — Tief, ruhig</SelectItem>
                  <SelectItem value="Fenrir">👨 Fenrir — Kräftig</SelectItem>
                  <SelectItem value="Orus">👨 Orus — Warm, freundlich</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* STT Provider */}
            <div className="w-full max-w-md">
              <label className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                <Mic className="size-4" />
                STT Provider
              </label>
              <Select value={stt.sttProvider} onValueChange={(v) => stt.setSttProvider(v as any)}>
                <SelectTrigger className="w-full bg-secondary/50 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepgram">Deepgram</SelectItem>
                  <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Context Sources */}
            {savedSources.length > 0 && (
              <div className="w-full max-w-md">
                <label className="text-sm text-muted-foreground flex items-center gap-2 mb-2">
                  <FileText className="size-4" />
                  Zusätzlicher Kontext
                </label>
                <div className="bg-secondary/30 rounded-lg p-2 mb-2">
                  <input
                    type="text"
                    placeholder="Quellen durchsuchen..."
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    className="w-full px-2 py-1.5 mb-2 text-sm rounded bg-secondary/50 border border-white/10 focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                  <div className="max-h-32 overflow-auto">
                    {savedSources
                      .filter(s => s.title.toLowerCase().includes(sourceSearch.toLowerCase()))
                      .map((source) => (
                        <label key={source.id} className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSourceIds.includes(source.id)}
                            onChange={() => toggleSourceSelection(source.id)}
                            className="rounded border-white/20"
                          />
                          <span className="text-sm truncate flex-1">{source.title}</span>
                        </label>
                      ))}
                  </div>
                </div>
                <textarea
                  className="w-full h-20 px-3 py-2 rounded-lg bg-secondary/50 border border-white/10 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                  placeholder="Zusätzlicher Text-Kontext (optional)..."
                  value={contextText}
                  onChange={(e) => setContextText(e.target.value)}
                />
              </div>
            )}

            <Button
              size="lg"
              onClick={handleStartSession}
              disabled={!cohost.isConnected || !currentShow || isStarting}
              className="gap-2"
            >
              {isStarting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Verbinde...
                </>
              ) : (
                <>
                  <Activity className="size-4" />
                  Session starten
                </>
              )}
            </Button>

            {!currentShow && (
              <p className="text-sm text-amber-500 flex items-center gap-2">
                <Radio className="size-4" />
                Bitte wähle zuerst eine Sendung aus
              </p>
            )}
          </Card>
        )}

        {/* Active session */}
        {sessionActive && (
          <>
            {/* Timeline area */}
            <div className="flex-1 min-h-0 relative glass rounded-2xl overflow-hidden border border-white/5 flex flex-col">
              <ScrollArea className="flex-1 p-4 sm:p-6" ref={scrollRef}>
                <div className="space-y-3">
                  {timeline.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${entry.type === "cohost-user" ? "justify-end" : "justify-start"}`}
                    >
                      {entry.type === "transcript" ? (
                        <div className="w-full">
                          <div className="flex items-start gap-2">
                            {entry.speaker !== null && entry.speaker !== undefined && (
                              <span className={`text-xs font-mono shrink-0 mt-0.5 ${getSpeakerColor(entry.speaker)}`}>
                                [{getSpeakerDisplayName(entry.speaker)}]
                              </span>
                            )}
                            <p className={`text-sm leading-relaxed ${entry.speaker !== null && entry.speaker !== undefined ? getSpeakerColor(entry.speaker) : 'text-foreground/80'}`}>
                              {entry.text}
                            </p>
                          </div>
                        </div>
                      ) : entry.type === "cohost-user" ? (
                        <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-primary text-primary-foreground">
                          <p className="text-sm leading-relaxed">{entry.text}</p>
                        </div>
                      ) : (
                        <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-accent/10 border border-accent/20">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs">🤖</span>
                            <span className="text-xs font-medium text-accent">Co-Host</span>
                          </div>
                          <p className="text-sm leading-relaxed text-foreground">{entry.text}</p>
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {/* Partial user text from CoHost */}
                  {partialUserText && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-primary/50 text-primary-foreground border border-dashed border-primary">
                        <p className="text-sm leading-relaxed italic">{partialUserText}</p>
                      </div>
                    </motion.div>
                  )}

                  {/* Partial assistant text */}
                  {partialAssistantText && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-accent/5 border border-dashed border-accent/30">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs">🤖</span>
                          <span className="text-xs font-medium text-accent">Co-Host</span>
                        </div>
                        <p className="text-sm leading-relaxed italic">{partialAssistantText}</p>
                        <span className="inline-block w-2 h-4 bg-accent ml-1 align-middle animate-pulse" />
                      </div>
                    </motion.div>
                  )}

                  {timeline.length === 0 && !partialUserText && !partialAssistantText && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 py-20">
                      <RadioTower className="size-12 mb-4 opacity-30" />
                      <p className="text-center text-sm">
                        Klicke auf Record für Transkription, halte PTT für Co-Host
                      </p>
                    </div>
                  )}
                  <div ref={scrollAnchorRef} />
                </div>
              </ScrollArea>
            </div>

            {/* Controls */}
            <div className="shrink-0 glass rounded-2xl flex items-center justify-center gap-3 py-4 px-4 sm:px-8 border border-white/5">
              {/* Text Input */}
              <div className="flex-1 flex gap-2">
                <Input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Frage an Co-Host..."
                  className="bg-background/50 border-white/10"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                />
                <Button
                  size="icon"
                  onClick={handleSendText}
                  disabled={!textInput.trim() || !cohost.isReady}
                >
                  <Send className="size-4" />
                </Button>
              </div>

              {/* Record toggle (STT) */}
              <Button
                size="lg"
                variant={combinedState === "TRANSCRIBING" ? "destructive" : "outline"}
                className={`rounded-full size-14 p-0 shadow-lg transition-all duration-300 ${
                  combinedState === "TRANSCRIBING"
                    ? 'scale-110 shadow-destructive/20'
                    : 'hover:scale-105'
                }`}
                onClick={handleToggleRecord}
                disabled={!cohost.isReady || combinedState === "ASKING" || combinedState === "ANSWERING"}
                title={combinedState === "TRANSCRIBING" ? "Aufnahme stoppen" : "Aufnahme starten"}
              >
                {combinedState === "TRANSCRIBING" ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </Button>

              {/* PTT button (CoHost) */}
              <Button
                size="lg"
                variant={combinedState === "ASKING" ? "default" : "secondary"}
                className={`rounded-full size-14 p-0 shadow-lg transition-all duration-300 select-none touch-none ${
                  combinedState === "ASKING"
                    ? 'scale-110 shadow-accent/30 bg-accent text-accent-foreground ring-2 ring-accent/50'
                    : cohost.isSpeaking
                      ? 'animate-pulse shadow-accent/20'
                      : 'hover:scale-105 shadow-accent/10'
                }`}
                onMouseDown={handlePTTStart}
                onMouseUp={handlePTTEnd}
                onMouseLeave={(e) => combinedState === "ASKING" && handlePTTEnd(e)}
                onTouchStart={handlePTTStart}
                onTouchEnd={handlePTTEnd}
                onTouchCancel={handlePTTEnd}
                disabled={!cohost.isReady}
                title="Gedrückt halten zum Fragen"
              >
                <Headphones className="size-5" />
              </Button>

              {/* Mute button */}
              <Button
                size="icon"
                variant={cohost.isMuted ? "destructive" : "outline"}
                className="rounded-full"
                onClick={cohost.toggleMute}
                title={cohost.isMuted ? "Ton einschalten" : "Ton ausschalten"}
              >
                {cohost.isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>

              {/* Stop session */}
              <Button
                size="icon"
                variant="outline"
                className="rounded-full text-destructive hover:text-destructive"
                onClick={handleStopSession}
                title="Session beenden"
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* State hint for mobile */}
            <div className="shrink-0 flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Mic className="size-3" /> Record = Transkription
              </span>
              <span className="flex items-center gap-1.5">
                <Headphones className="size-3" /> Halten = Co-Host fragen
              </span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function formatElapsedTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
