import { apiUrl } from "@/lib/config";
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Send, Brain, Activity, Radio, ChevronDown, Plus, ArrowLeft, Volume2, VolumeX, Save, Trash2, FileText, ChevronRight, LogOut, Edit, RefreshCw, Search, X, Loader2, FileCode, ExternalLink, Settings } from "lucide-react";
import type { Source, PronunciationVocab } from "@shared/schema";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
import { useCoHostWebSocket, type CoHostEvent, type CoHostLanguage, type ContextFile, type ContextData } from "@/hooks/useCoHostWebSocket";

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

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

interface TranscriptSegment {
  id: number;
  text: string;
  speaker?: number | null;
  timestamp: string;
  metadata?: string | null;
}

interface SpeakerMapping {
  id: number;
  showId: number;
  speakerIndex: number;
  displayName: string;
}

interface QuickAction {
  id: number;
  userId: string;
  label: string;
  prompt: string;
  sortOrder: number;
}

const SPEAKER_COLORS = [
  "text-primary",
  "text-emerald-400", 
  "text-amber-400",
  "text-purple-400",
  "text-pink-400",
  "text-accent",
];

const UI_TRANSLATIONS = {
  "de-CH": {
    refresh: "Aktualisieren",
    summarize: "Zusammenfassen",
    research: "Recherchieren",
    explain: "Erklären",
    messagePlaceholder: "Nachricht eingeben...",
    refreshTitle: "Session neu starten, um aktualisierte Sprechernamen zu laden",
    summarizePrompt: "Bitte fasse zusammen, was bisher besprochen wurde.",
    researchPrompt: "Kannst du das, was wir zuletzt besprochen haben, im Internet recherchieren?",
    explainPrompt: "Bitte erkläre die letzte Aussage genauer.",
    emptyChat: "Sprich mit deinem AI Co-Host oder schreibe eine Nachricht",
  },
  "en": {
    refresh: "Refresh",
    summarize: "Summarize",
    research: "Research",
    explain: "Explain",
    messagePlaceholder: "Enter message...",
    refreshTitle: "Restart session to load updated speaker names",
    summarizePrompt: "Please summarize what has been discussed so far.",
    researchPrompt: "Can you research what we just discussed on the internet?",
    explainPrompt: "Please explain the last statement in more detail.",
    emptyChat: "Talk to your AI Co-Host or type a message",
  },
} as const;

function getSpeakerFromSegment(segment: { speaker?: number | null; metadata?: string | null }): number | null {
  // Check the speaker column first (direct storage)
  if (typeof segment.speaker === 'number') {
    return segment.speaker;
  }
  // Fallback to metadata JSON for legacy data
  if (!segment.metadata) return null;
  try {
    const parsed = JSON.parse(segment.metadata);
    return typeof parsed.speaker === 'number' ? parsed.speaker : null;
  } catch {
    return null;
  }
}

// Translation map for default quick actions (German → English)
const quickActionTranslations: Record<string, { label: string; prompt: string }> = {
  "Zusammenfassen": { label: "Summarize", prompt: "Please summarize what has been discussed so far." },
  "Recherchieren": { label: "Research", prompt: "Can you research what we just discussed on the internet?" },
  "Erklären": { label: "Explain", prompt: "Please explain the last statement in more detail." },
};

function getTranslatedAction(action: { label: string; prompt: string }, language: string) {
  if (language.startsWith("de")) return action;
  const translation = quickActionTranslations[action.label];
  if (translation) return translation;
  return action;
}

export default function CoHost() {
  const [shows, setShows] = useState<Show[]>([]);
  const [currentShow, setCurrentShow] = useState<Show | null>(null);
  const [newShowTitle, setNewShowTitle] = useState("");
  const [showDialogOpen, setShowDialogOpen] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [savedPrompts, setSavedPrompts] = useState<SystemPromptItem[]>([]);
  const [newPromptName, setNewPromptName] = useState("");
  const [savePromptDialogOpen, setSavePromptDialogOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [partialUserText, setPartialUserText] = useState("");
  const [partialAssistantText, setPartialAssistantText] = useState("");
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [showTranscriptContext, setShowTranscriptContext] = useState(false);
  const [speakerMappings, setSpeakerMappings] = useState<SpeakerMapping[]>([]);
  const [speakerMappingsDialogOpen, setSpeakerMappingsDialogOpen] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<{ index: number; name: string } | null>(null);
  
  const [editingShow, setEditingShow] = useState<Show | null>(null);
  const [editShowTitle, setEditShowTitle] = useState("");
  const [editShowDialogOpen, setEditShowDialogOpen] = useState(false);
  const [deleteShowId, setDeleteShowId] = useState<number | null>(null);
  
  const [editingPrompt, setEditingPrompt] = useState<SystemPromptItem | null>(null);
  const [editPromptName, setEditPromptName] = useState("");
  const [editPromptText, setEditPromptText] = useState("");
  const [editPromptDialogOpen, setEditPromptDialogOpen] = useState(false);
  const [deletePromptId, setDeletePromptId] = useState<number | null>(null);
  
  const [showSearch, setShowSearch] = useState("");
  const [showSelectorOpen, setShowSelectorOpen] = useState(false);
  
  // Context state
  const [contextText, setContextText] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  
  // Context preparation state
  const [isPreparingContext, setIsPreparingContext] = useState(false);
  const [contextMode, setContextMode] = useState<"none" | "optimized" | "full">("none");
  const [showSummary, setShowSummary] = useState<{ tokenCount: number; segmentCount: number } | null>(null);
  
  // Voice preference state
  const [voicePreference, setVoicePreference] = useState<"Kore" | "Puck">("Kore");
  const [sttProvider, setSttProvider] = useState<"deepgram" | "elevenlabs">(() => {
    if (typeof window === "undefined") return "deepgram";
    const stored = window.localStorage.getItem("stt-provider");
    return stored === "elevenlabs" ? "elevenlabs" : "deepgram";
  });
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const prevSpeakingRef = useRef(false);
  const pendingRestartRef = useRef<{ showId: number; systemPrompt: string | undefined; language: CoHostLanguage; contextData?: ContextData; token: number } | null>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restartTokenRef = useRef(0);
  const shouldAutoRestartRef = useRef(false);
  
  const { user, logout } = useAuth();
  
  const { data: savedSources = [] } = useQuery<Source[]>({
    queryKey: ["/api/sources"],
  });
  
  const { data: pronunciationVocab = [], refetch: refetchVocab } = useQuery<PronunciationVocab[]>({
    queryKey: ["/api/pronunciation-vocab"],
  });
  
  const [newVocabWord, setNewVocabWord] = useState("");
  const [vocabDialogOpen, setVocabDialogOpen] = useState(false);
  
  // Quick actions - fetch enabled actions for this user
  const { data: quickActions = [] } = useQuery<QuickAction[]>({
    queryKey: ["/api/quick-actions"],
  });
  
  const { 
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
    onEvent 
  } = useCoHostWebSocket();
  
  // Format elapsed seconds as MM:SS or HH:MM:SS
  const formatElapsedTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    fetchShows();
    fetchSystemPrompts();
    // Fetch voice preference
    fetch(apiUrl("/api/user/voice-preference"))
      .then(res => res.json())
      .then(data => {
        if (data.voicePreference) {
          setVoicePreference(data.voicePreference);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("stt-provider", sttProvider);
    }
  }, [sttProvider]);

  // Reset isStarting when session becomes ready
  useEffect(() => {
    if (isReady) {
      setIsStarting(false);
    }
  }, [isReady]);

  useEffect(() => {
    onEvent((event: CoHostEvent) => {
      if (event.type === "cohost.user_transcript" && event.text) {
        setPartialUserText(event.text);
      }
      
      if (event.type === "cohost.assistant_transcript" && event.text) {
        setPartialAssistantText(prev => prev + event.text);
      }
      
      if (event.type === "cohost.text" && event.text) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: "assistant",
          text: event.text!
        }]);
      }
      
      if (event.type === "cohost.turn_complete") {
        if (partialUserText) {
          setMessages(prev => [...prev, {
            id: Date.now() - 1,
            role: "user",
            text: partialUserText
          }]);
          setPartialUserText("");
        }
        if (partialAssistantText) {
          setMessages(prev => [...prev, {
            id: Date.now(),
            role: "assistant",
            text: partialAssistantText
          }]);
          setPartialAssistantText("");
        }
      }
      
      // Handle session stopped - trigger pending restart only if explicitly requested
      if (event.type === "cohost.stopped") {
        console.log("Session stopped, checking for pending restart");
        // Only restart if auto-restart is enabled (set by refresh button)
        if (shouldAutoRestartRef.current && pendingRestartRef.current && pendingRestartRef.current.token === restartTokenRef.current) {
          const { showId, systemPrompt: prompt, language: savedLanguage, contextData: savedContextData } = pendingRestartRef.current;
          pendingRestartRef.current = null;
          shouldAutoRestartRef.current = false;
          // Clear the fallback timer since we got the stopped event
          if (restartTimerRef.current) {
            clearTimeout(restartTimerRef.current);
            restartTimerRef.current = null;
          }
          console.log("Starting new session for show:", showId);
          startSession(showId, prompt, savedLanguage, savedContextData, user?.id, voicePreference);
        }
      }
      
      if (event.type === "cohost.context_error") {
        console.error("Context upload failed:", event.fileName, event.error);
        toast.error(`Datei konnte nicht verarbeitet werden: ${event.fileName}`);
      }
      
      if (event.type === "error") {
        console.error("Co-Host error:", event.message);
      }
      
      if (event.type === "cohost.session_ended") {
        console.log("Session ended by server:", event.reason, event.message);
        setIsStarting(false);
        // Show toast notification to user
        if (event.reason === "error") {
          toast.error(event.message || "Session wurde wegen eines Fehlers beendet");
        } else {
          toast.warning(event.message || "Session wurde beendet");
        }
      }
    });
  }, [partialUserText, partialAssistantText]);

  // Reset partial assistant text when speaking starts (new response)
  useEffect(() => {
    if (isSpeaking && !prevSpeakingRef.current) {
      // Speaking just started - reset partial text for new response
      setPartialAssistantText("");
    }
    prevSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages, partialUserText, partialAssistantText]);

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

  const fetchTranscripts = async (showId: number) => {
    try {
      const res = await fetch(apiUrl(`/api/shows/${showId}/transcripts`));
      const data = await res.json();
      setTranscriptSegments(data);
    } catch (error) {
      console.error("Error fetching transcripts:", error);
    }
  };

  const fetchSpeakerMappings = async (showId: number) => {
    try {
      const res = await fetch(apiUrl(`/api/shows/${showId}/speakers`));
      if (!res.ok) {
        setSpeakerMappings([]);
        return;
      }
      const data = await res.json();
      setSpeakerMappings(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching speaker mappings:", error);
      setSpeakerMappings([]);
    }
  };

  const saveSpeakerMapping = async (speakerIndex: number, displayName: string) => {
    if (!currentShow) return;
    try {
      await fetch(apiUrl(`/api/shows/${currentShow.id}/speakers/${speakerIndex}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      await fetchSpeakerMappings(currentShow.id);
    } catch (error) {
      console.error("Error saving speaker mapping:", error);
    }
  };

  const getSpeakerDisplayName = (speakerIndex: number): string => {
    const mapping = speakerMappings.find(m => m.speakerIndex === speakerIndex);
    return mapping?.displayName || `Sprecher ${speakerIndex + 1}`;
  };

  // Fetch transcripts, speaker mappings and summary status when show changes
  useEffect(() => {
    if (currentShow) {
      fetchTranscripts(currentShow.id);
      fetchSpeakerMappings(currentShow.id);
      fetchShowSummary(currentShow.id);
    } else {
      setTranscriptSegments([]);
      setSpeakerMappings([]);
      setShowSummary(null);
      setContextMode("none");
    }
  }, [currentShow]);

  const fetchShowSummary = async (showId: number) => {
    try {
      const res = await fetch(apiUrl(`/api/shows/${showId}/summary`));
      const data = await res.json();
      if (data && data.tokenCount) {
        setShowSummary({ tokenCount: data.tokenCount, segmentCount: data.segmentCount });
        setContextMode("optimized");
      } else {
        setShowSummary(null);
        setContextMode("none");
      }
    } catch (error) {
      console.error("Error fetching show summary:", error);
      setShowSummary(null);
    }
  };

  const prepareContext = async () => {
    if (!currentShow) return;
    
    setIsPreparingContext(true);
    try {
      const res = await fetch(apiUrl(`/api/shows/${currentShow.id}/prepare-context`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to prepare context");
      }
      
      const result = await res.json();
      toast.success(`Kontext vorbereitet: ${result.summary.tokenCount} Tokens, ${result.chunks.count} Chunks`);
      setShowSummary({ tokenCount: result.summary.tokenCount, segmentCount: result.summary.segmentCount });
      setContextMode("optimized");
    } catch (error) {
      console.error("Error preparing context:", error);
      toast.error(error instanceof Error ? error.message : "Fehler beim Vorbereiten des Kontexts");
    } finally {
      setIsPreparingContext(false);
    }
  };

  // Poll for transcript and speaker updates while session is active
  useEffect(() => {
    if (!isReady || !currentShow) return;
    
    const intervalId = setInterval(() => {
      fetchTranscripts(currentShow.id);
      fetchSpeakerMappings(currentShow.id);
    }, 5000); // Update every 5 seconds
    
    return () => clearInterval(intervalId);
  }, [isReady, currentShow]);

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
      console.error("Error saving system prompt:", error);
    }
  };

  const handleSelectPrompt = (prompt: SystemPromptItem) => {
    setSystemPrompt(prompt.prompt);
  };

  const handleVoicePreferenceChange = async (voice: "Kore" | "Puck") => {
    setVoicePreference(voice);
    try {
      await fetch(apiUrl("/api/user/voice-preference"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voicePreference: voice }),
      });
    } catch (error) {
      console.error("Error saving voice preference:", error);
    }
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

  const handleSelectShow = (show: Show | null) => {
    const previousShowId = currentShow?.id;
    const isSameShow = show?.id === previousShowId;
    
    // Increment token to invalidate any previous pending restarts
    restartTokenRef.current += 1;
    
    // Cancel any pending restart timer
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    
    // Clear any pending restart and disable auto-restart
    pendingRestartRef.current = null;
    shouldAutoRestartRef.current = false;
    
    setCurrentShow(show);
    setMessages([]);
    setPartialUserText("");
    setPartialAssistantText("");
    
    // If switching to a different show and session is active, just stop it
    // User can manually start a new session when ready
    if (!isSameShow && (isReady || isConnected)) {
      stopSession();
    }
  };

  const handleEditShow = (show: Show) => {
    setEditingShow(show);
    setEditShowTitle(show.title);
    setEditShowDialogOpen(true);
  };

  const handleUpdateShow = async () => {
    if (!editingShow || !editShowTitle.trim()) return;
    
    try {
      const res = await fetch(apiUrl(`/api/shows/${editingShow.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editShowTitle }),
      });
      const updated = await res.json();
      setShows(prev => prev.map(s => s.id === updated.id ? updated : s));
      if (currentShow?.id === updated.id) {
        setCurrentShow(updated);
      }
      setEditShowDialogOpen(false);
      setEditingShow(null);
    } catch (error) {
      console.error("Error updating show:", error);
    }
  };

  const handleDeleteShow = async () => {
    if (!deleteShowId) return;
    
    try {
      await fetch(apiUrl(`/api/shows/${deleteShowId}`), { method: "DELETE" });
      setShows(prev => prev.filter(s => s.id !== deleteShowId));
      if (currentShow?.id === deleteShowId) {
        setCurrentShow(null);
      }
      setDeleteShowId(null);
    } catch (error) {
      console.error("Error deleting show:", error);
    }
  };

  const handleEditPrompt = (prompt: SystemPromptItem) => {
    setEditingPrompt(prompt);
    setEditPromptName(prompt.name);
    setEditPromptText(prompt.prompt);
    setEditPromptDialogOpen(true);
  };

  const handleUpdatePrompt = async () => {
    if (!editingPrompt || !editPromptName.trim() || !editPromptText.trim()) return;
    
    try {
      const res = await fetch(apiUrl(`/api/system-prompts/${editingPrompt.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editPromptName, prompt: editPromptText }),
      });
      const updated = await res.json();
      setSavedPrompts(prev => prev.map(p => p.id === updated.id ? updated : p));
      setEditPromptDialogOpen(false);
      setEditingPrompt(null);
    } catch (error) {
      console.error("Error updating prompt:", error);
    }
  };

  const handleConfirmDeletePrompt = async () => {
    if (!deletePromptId) return;
    
    try {
      await fetch(apiUrl(`/api/system-prompts/${deletePromptId}`), { method: "DELETE" });
      setSavedPrompts(prev => prev.filter(p => p.id !== deletePromptId));
      setDeletePromptId(null);
    } catch (error) {
      console.error("Error deleting prompt:", error);
    }
  };

  const clearAllContext = () => {
    setContextText("");
    setSelectedSourceIds([]);
  };
  
  const handleAddVocab = async () => {
    if (!newVocabWord.trim()) return;
    try {
      await fetch(apiUrl("/api/pronunciation-vocab"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: newVocabWord.trim(), language: "en" }),
      });
      setNewVocabWord("");
      refetchVocab();
    } catch (error) {
      console.error("Error adding vocab:", error);
    }
  };
  
  const handleDeleteVocab = async (id: number) => {
    try {
      await fetch(apiUrl(`/api/pronunciation-vocab/${id}`), { method: "DELETE" });
      refetchVocab();
    } catch (error) {
      console.error("Error deleting vocab:", error);
    }
  };
  
  const getSourceTypeIcon = (type: string) => {
    if (type === 'pdf') return <FileText className="size-4 text-red-400" />;
    if (type === 'json') return <FileCode className="size-4 text-yellow-400" />;
    if (type === 'markdown') return <FileCode className="size-4 text-primary" />;
    return <FileText className="size-4 text-muted-foreground" />;
  };
  
  const toggleSourceSelection = (sourceId: number) => {
    setSelectedSourceIds(prev => 
      prev.includes(sourceId) 
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };
  
  const hasContext = selectedSourceIds.length > 0 || !!contextText.trim();
  
  const getContextData = (): ContextData | undefined => {
    const selectedSources = savedSources.filter(s => selectedSourceIds.includes(s.id));
    const combinedText = selectedSources.map(s => `--- ${s.title} ---\n${s.textContent}`).join("\n\n");
    const totalText = [combinedText, contextText.trim()].filter(Boolean).join("\n\n");
    if (!totalText) return undefined;
    return { text: totalText };
  };

  const handleStartSession = () => {
    setIsStarting(true);
    startSession(currentShow?.id, systemPrompt || undefined, language, getContextData(), user?.id, voicePreference);
  };

  const handleRefreshSession = () => {
    if (!isReady) return;
    
    // Increment token to invalidate any previous pending restarts
    restartTokenRef.current += 1;
    const currentToken = restartTokenRef.current;
    
    // Clear any pending restart
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    pendingRestartRef.current = null;
    
    // Enable auto-restart for refresh button only
    shouldAutoRestartRef.current = true;
    
    // Stop the session first
    stopSession();
    
    // Set up pending restart with current show and system prompt
    if (currentShow) {
      const contextData = getContextData();
      pendingRestartRef.current = { 
        showId: currentShow.id, 
        systemPrompt: systemPrompt || undefined,
        language: language,
        contextData: contextData,
        token: currentToken 
      };
      
      // Fallback timer in case stopped event doesn't arrive
      restartTimerRef.current = setTimeout(() => {
        if (shouldAutoRestartRef.current && pendingRestartRef.current && pendingRestartRef.current.token === currentToken) {
          const { showId, systemPrompt: prompt, language: savedLanguage, contextData: savedContextData } = pendingRestartRef.current;
          pendingRestartRef.current = null;
          shouldAutoRestartRef.current = false;
          console.log("Fallback restart for refresh:", showId);
          startSession(showId, prompt, savedLanguage, savedContextData, user?.id, voicePreference);
        }
      }, 1000);
    }
  };

  // Track if using touch to prevent mouse event double-fire
  const usingTouchRef = useRef(false);

  // Push-to-talk: Start recording on press
  const handlePushToTalkStart = (e: React.MouseEvent | React.TouchEvent) => {
    // If this is a mouse event but we're using touch, ignore it
    if (e.type.startsWith('mouse') && usingTouchRef.current) {
      return;
    }
    if (e.type.startsWith('touch')) {
      usingTouchRef.current = true;
      e.preventDefault(); // Prevent synthetic mouse events
    }
    
    // If AI is speaking, interrupt it first
    if (isSpeaking) {
      interrupt();
    }
    startRecording();
  };

  // Push-to-talk: Stop recording on release
  const handlePushToTalkEnd = (e?: React.MouseEvent | React.TouchEvent) => {
    // If this is a mouse event but we're using touch, ignore it
    if (e && e.type.startsWith('mouse') && usingTouchRef.current) {
      return;
    }
    stopRecording();
    
    // Reset touch tracking after a short delay
    if (e?.type.startsWith('touch')) {
      setTimeout(() => { usingTouchRef.current = false; }, 100);
    }
  };

  const handleSendText = () => {
    if (!textInput.trim() || !isReady) return;
    
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: "user",
      text: textInput
    }]);
    
    sendText(textInput);
    setTextInput("");
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-foreground flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-14 sm:h-16 border-b border-border/40 glass flex items-center justify-between px-3 sm:px-6 z-10">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="size-8 sm:size-9" data-testid="button-back">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          
          <div className="flex items-center gap-2">
            <div className="size-7 sm:size-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Brain className="size-3 sm:size-4 text-primary animate-pulse-slow" />
            </div>
            <span className="font-mono font-bold tracking-tight text-sm sm:text-lg hidden sm:inline">CO-<span className="text-primary">HOST</span></span>
          </div>
          
          {/* Show Selector */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Popover open={showSelectorOpen} onOpenChange={setShowSelectorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-1 sm:gap-2 min-w-[100px] sm:min-w-[200px] justify-between text-xs sm:text-sm" data-testid="button-show-selector-cohost">
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
                      data-testid="input-show-search-cohost"
                    />
                    {showSearch && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
                        onClick={() => setShowSearch("")}
                        data-testid="button-clear-search-cohost"
                      >
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
                      data-testid="button-no-show-cohost"
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
                          data-testid={`show-item-cohost-${show.id}`}
                        >
                          <Radio className="size-3 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-sm">{show.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(show.createdAt).toLocaleDateString('de-CH')}
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-6" 
                              onClick={(e) => { e.stopPropagation(); handleEditShow(show); }}
                              data-testid={`button-edit-show-cohost-${show.id}`}
                            >
                              <Edit className="size-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-6 text-destructive hover:text-destructive" 
                              onClick={(e) => { e.stopPropagation(); setDeleteShowId(show.id); }}
                              data-testid={`button-delete-show-cohost-${show.id}`}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>

            <Dialog open={showDialogOpen} onOpenChange={setShowDialogOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="outline" data-testid="button-new-show-cohost">
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
                    data-testid="input-show-title-cohost"
                  />
                  <Button onClick={handleCreateShow} disabled={!newShowTitle.trim()} data-testid="button-create-show-cohost">
                    Sendung erstellen
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Select 
              value={language} 
              onValueChange={(val) => {
                const newLang = val as CoHostLanguage;
                setLanguage(newLang);
                // Auto-restart session with new language if already running
                if (isReady) {
                  restartTokenRef.current += 1;
                  const currentToken = restartTokenRef.current;
                  if (restartTimerRef.current) {
                    clearTimeout(restartTimerRef.current);
                    restartTimerRef.current = null;
                  }
                  pendingRestartRef.current = null;
                  shouldAutoRestartRef.current = true;
                  stopSession();
                  pendingRestartRef.current = { 
                    showId: currentShow?.id || 0, 
                    systemPrompt: systemPrompt || undefined,
                    language: newLang,
                    token: currentToken 
                  };
                  restartTimerRef.current = setTimeout(() => {
                    if (shouldAutoRestartRef.current && pendingRestartRef.current && pendingRestartRef.current.token === currentToken) {
                      const { showId, systemPrompt: prompt, language: savedLang } = pendingRestartRef.current;
                      pendingRestartRef.current = null;
                      shouldAutoRestartRef.current = false;
                      startSession(showId || undefined, prompt, savedLang, undefined, user?.id, voicePreference);
                    }
                  }, 1000);
                }
              }}
            >
              <SelectTrigger className="w-[120px] sm:w-[140px] text-xs sm:text-sm" data-testid="select-language-cohost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de-CH" data-testid="language-de-CH-cohost">Deutsch</SelectItem>
                <SelectItem value="en" data-testid="language-en-cohost">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary font-mono text-[10px] sm:text-xs hidden sm:flex" data-testid="status-badge-cohost">
            <div className={`size-1.5 rounded-full ${isRecording ? 'bg-success animate-pulse' : isReady ? 'bg-primary' : isConnected ? 'bg-yellow-400' : 'bg-red-400'} mr-2`} />
            {isRecording ? "LISTENING" : isReady ? "READY" : isConnected ? "CONNECTING" : "OFFLINE"}
          </Badge>
          
          {isReady && elapsedSeconds > 0 && (
            <Badge 
              variant="outline" 
              className="bg-purple-500/10 border-purple-500/30 text-purple-400 font-mono text-[10px] sm:text-xs" 
              data-testid="voice-timer"
              title={`Sprechzeit: In ${Math.round(voiceInSeconds)}s / Out ${Math.round(voiceOutSeconds)}s`}
            >
              <Activity className="size-3 mr-1" />
              {formatElapsedTime(elapsedSeconds)}
            </Badge>
          )}
          
          {isSpeaking && (
            <Badge variant="secondary" className="gap-1 animate-pulse text-xs">
              <Volume2 className="size-3" />
              <span className="hidden sm:inline">Speaking</span>
            </Badge>
          )}
          
          <Button 
            variant="ghost" 
            size="icon" 
            className="size-8 sm:size-9"
            onClick={() => logout()}
            title={user?.email || "Abmelden"}
            data-testid="button-logout-cohost"
          >
            <LogOut className="size-4 text-muted-foreground hover:text-foreground" />
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col p-3 sm:p-6 gap-4 sm:gap-6 overflow-y-auto max-w-4xl mx-auto w-full">
        
        {/* Session Start */}
        {!isReady && (
          <Card className="p-4 sm:p-8 flex flex-col items-center justify-center gap-3 sm:gap-4 glass border-white/5">
            <Brain className="size-12 sm:size-16 text-primary/50" />
            <h2 className="text-lg sm:text-xl font-semibold">AI Co-Host bereit</h2>
            <p className="text-muted-foreground text-center max-w-md">
              {currentShow 
                ? `Starte eine Session mit Kontext von "${currentShow.title}"`
                : "Wähle optional eine Sendung für Kontext und starte die Session"
              }
            </p>
            
            {/* Custom System Prompt */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">
                  System-Prompt (optional)
                </label>
                <div className="flex items-center gap-2">
                  {/* Saved Prompts Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 text-xs" data-testid="dropdown-saved-prompts">
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
                          <DropdownMenuItem 
                            key={p.id} 
                            onClick={() => handleSelectPrompt(p)}
                            className="flex items-center justify-between gap-2 group"
                            data-testid={`menu-item-prompt-${p.id}`}
                          >
                            <span className="truncate flex-1">{p.name}</span>
                            <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 shrink-0"
                                onClick={(e) => { e.stopPropagation(); handleEditPrompt(p); }}
                                data-testid={`button-edit-prompt-${p.id}`}
                              >
                                <Edit className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 shrink-0"
                                onClick={(e) => { e.stopPropagation(); setDeletePromptId(p.id); }}
                                data-testid={`button-delete-prompt-${p.id}`}
                              >
                                <Trash2 className="size-3 text-destructive" />
                              </Button>
                            </div>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  {/* Save Current Prompt */}
                  <Dialog open={savePromptDialogOpen} onOpenChange={setSavePromptDialogOpen}>
                    <DialogTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-1 text-xs"
                        disabled={!systemPrompt.trim()}
                        data-testid="button-save-prompt"
                      >
                        <Save className="size-3" />
                        Speichern
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Prompt speichern</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-4 pt-4">
                        <Input
                          placeholder="Name für den Prompt..."
                          value={newPromptName}
                          onChange={(e) => setNewPromptName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSavePrompt()}
                          data-testid="input-prompt-name"
                        />
                        <div className="text-xs text-muted-foreground bg-secondary/50 p-3 rounded-lg max-h-24 overflow-auto">
                          {systemPrompt}
                        </div>
                        <Button onClick={handleSavePrompt} disabled={!newPromptName.trim()} data-testid="button-confirm-save-prompt">
                          Prompt speichern
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              <textarea
                className="w-full h-24 px-3 py-2 rounded-lg bg-secondary/50 border border-white/10 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="Zusätzliche Anweisungen für den Co-Host, z.B. Thema der Sendung, Ton, spezielle Regeln..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                data-testid="input-system-prompt"
              />
            </div>
            
            {/* Voice Selection */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground flex items-center gap-2">
                  <Volume2 className="size-4" />
                  Stimme des Co-Hosts
                </label>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={voicePreference === "Kore" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={() => handleVoicePreferenceChange("Kore")}
                  data-testid="button-voice-female"
                >
                  <span>👩</span>
                  Weiblich
                </Button>
                <Button
                  variant={voicePreference === "Puck" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={() => handleVoicePreferenceChange("Puck")}
                  data-testid="button-voice-male"
                >
                  <span>👨</span>
                  Männlich
                </Button>
              </div>
            </div>
            
            {/* Pronunciation Vocabulary */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground flex items-center gap-2">
                  <Volume2 className="size-4" />
                  Englische Aussprache ({pronunciationVocab.length} Wörter)
                </label>
                <Dialog open={vocabDialogOpen} onOpenChange={setVocabDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-xs gap-1" data-testid="button-manage-vocab">
                      <Edit className="size-3" />
                      Bearbeiten
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Englische Aussprache</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                      Diese Wörter werden vom Co-Host auf Englisch ausgesprochen (z.B. AI, AGI, API).
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Neues Wort..."
                        value={newVocabWord}
                        onChange={(e) => setNewVocabWord(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddVocab()}
                        data-testid="input-vocab-word"
                      />
                      <Button onClick={handleAddVocab} disabled={!newVocabWord.trim()} data-testid="button-add-vocab">
                        <Plus className="size-4" />
                      </Button>
                    </div>
                    <ScrollArea className="max-h-48">
                      <div className="flex flex-wrap gap-2">
                        {pronunciationVocab.map((vocab) => (
                          <Badge 
                            key={vocab.id} 
                            variant="secondary" 
                            className="gap-1 text-sm"
                            data-testid={`vocab-item-${vocab.id}`}
                          >
                            {vocab.word}
                            <button 
                              onClick={() => handleDeleteVocab(vocab.id)}
                              className="ml-1 hover:text-destructive"
                              data-testid={`button-delete-vocab-${vocab.id}`}
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                        {pronunciationVocab.length === 0 && (
                          <p className="text-xs text-muted-foreground">Noch keine Wörter hinzugefügt</p>
                        )}
                      </div>
                    </ScrollArea>
                  </DialogContent>
                </Dialog>
              </div>
              {pronunciationVocab.length > 0 && (
                <div className="flex flex-wrap gap-1 bg-secondary/30 rounded-lg p-2" data-testid="vocab-preview">
                  {pronunciationVocab.slice(0, 10).map((vocab) => (
                    <Badge key={vocab.id} variant="outline" className="text-xs">
                      {vocab.word}
                    </Badge>
                  ))}
                  {pronunciationVocab.length > 10 && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      +{pronunciationVocab.length - 10} mehr
                    </Badge>
                  )}
                </div>
              )}
            </div>
            
            {/* Context Sources */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground flex items-center gap-2">
                  <FileText className="size-4" />
                  Zusätzlicher Kontext (optional)
                </label>
                <div className="flex items-center gap-2">
                  {hasContext && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-xs text-muted-foreground hover:text-destructive gap-1"
                      onClick={clearAllContext}
                      data-testid="button-clear-context"
                    >
                      <Trash2 className="size-3" />
                      Löschen
                    </Button>
                  )}
                  <Link href="/sources">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="text-xs gap-1"
                      data-testid="button-manage-sources"
                    >
                      <ExternalLink className="size-3" />
                      Quellen verwalten
                    </Button>
                  </Link>
                </div>
              </div>
              
              {/* Source selection list */}
              {savedSources.length > 0 ? (
                <div className="bg-secondary/30 rounded-lg p-2 mb-2" data-testid="source-selection-list">
                  <input
                    type="text"
                    placeholder="Quellen durchsuchen..."
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    className="w-full px-2 py-1.5 mb-2 text-sm rounded bg-secondary/50 border border-white/10 focus:outline-none focus:ring-1 focus:ring-accent/50"
                    data-testid="input-source-search"
                  />
                  <div className="max-h-32 overflow-auto">
                    {savedSources
                      .filter((source) => source.title.toLowerCase().includes(sourceSearch.toLowerCase()))
                      .map((source) => (
                        <label 
                          key={source.id}
                          className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 cursor-pointer"
                          data-testid={`source-item-${source.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedSourceIds.includes(source.id)}
                            onChange={() => toggleSourceSelection(source.id)}
                            className="rounded border-white/20"
                            data-testid={`checkbox-source-${source.id}`}
                          />
                          {getSourceTypeIcon(source.type)}
                          <span className="text-sm truncate flex-1">{source.title}</span>
                        </label>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="bg-secondary/30 rounded-lg p-3 mb-2 text-center text-xs text-muted-foreground" data-testid="no-sources-message">
                  Keine Quellen vorhanden. <Link href="/sources" className="text-primary hover:underline">Jetzt hinzufügen</Link>
                </div>
              )}
              
              {/* Text input for additional manual context */}
              <textarea
                className="w-full h-20 px-3 py-2 rounded-lg bg-secondary/50 border border-white/10 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="Zusätzlicher Text-Kontext (optional)..."
                value={contextText}
                onChange={(e) => setContextText(e.target.value)}
                data-testid="input-context-text"
              />
              
              {hasContext && (
                <p className="text-xs text-muted-foreground mt-2" data-testid="context-summary">
                  {selectedSourceIds.length > 0 && `${selectedSourceIds.length} Quelle(n)`}
                  {selectedSourceIds.length > 0 && contextText.trim() && " + "}
                  {contextText.trim() && `${contextText.length} Zeichen Text`}
                  {" - wird bei Session-Start an Gemini gesendet"}
                </p>
              )}
            </div>
            
            {/* Quick Actions Configuration */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground flex items-center gap-2">
                  <Settings className="size-4" />
                  Quick-Actions
                </label>
                <Link href="/quick-actions">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-xs gap-1"
                    data-testid="button-manage-quick-actions-setup"
                  >
                    <Edit className="size-3" />
                    Verwalten
                  </Button>
                </Link>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 text-sm">
                {quickActions.length === 0 ? (
                  <p className="text-muted-foreground text-center text-xs">
                    Lade Quick-Actions...
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {quickActions.map((action) => (
                      <Badge key={action.id} variant="secondary" className="text-xs">
                        {action.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Transcript Context Preview */}
            {currentShow && transcriptSegments.length > 0 && (
              <div className="w-full max-w-md">
                <div 
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setShowTranscriptContext(!showTranscriptContext)}
                >
                  <label className="text-sm text-muted-foreground flex items-center gap-2">
                    <FileText className="size-4" />
                    Transkript-Kontext ({transcriptSegments.length} Segmente)
                    {showSummary && (
                      <Badge variant="outline" className="text-success border-green-400/50 text-xs">
                        Optimiert
                      </Badge>
                    )}
                  </label>
                  <ChevronRight className={`size-4 transition-transform ${showTranscriptContext ? 'rotate-90' : ''}`} />
                </div>
                {showTranscriptContext && (
                  <div className="mt-2 bg-secondary/30 rounded-lg p-3 max-h-48 overflow-auto text-xs">
                    {transcriptSegments.map((seg) => {
                      const speaker = getSpeakerFromSegment(seg);
                      const colorClass = speaker !== null 
                        ? SPEAKER_COLORS[speaker % SPEAKER_COLORS.length] 
                        : "text-muted-foreground";
                      return (
                        <p key={seg.id} className={`mb-1 ${colorClass}`}>
                          {speaker !== null && <span className="opacity-60 mr-1">[{speaker + 1}]</span>}
                          {seg.text}
                        </p>
                      );
                    })}
                  </div>
                )}
                
                {/* Context preparation button */}
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={showSummary ? "outline" : "secondary"}
                    onClick={prepareContext}
                    disabled={isPreparingContext || transcriptSegments.length === 0}
                    className="gap-2 text-xs"
                    data-testid="button-prepare-context"
                  >
                    {isPreparingContext ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Kontext wird vorbereitet...
                      </>
                    ) : showSummary ? (
                      <>
                        <RefreshCw className="size-3" />
                        Kontext aktualisieren
                      </>
                    ) : (
                      <>
                        <Brain className="size-3" />
                        Kontext vorbereiten
                      </>
                    )}
                  </Button>
                  {showSummary && (
                    <span className="text-xs text-muted-foreground">
                      {showSummary.tokenCount.toLocaleString()} Tokens (Summary)
                    </span>
                  )}
                  {!showSummary && transcriptSegments.length > 500 && (
                    <span className="text-xs text-amber-400">
                      Empfohlen für lange Shows
                    </span>
                  )}
                </div>
              </div>
            )}
            
            <Button 
              size="lg" 
              onClick={handleStartSession}
              disabled={!isConnected || !currentShow || isStarting}
              className="gap-2"
              data-testid="button-start-session"
            >
              {isStarting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {contextProgress ? (
                    `Dateien: ${contextProgress.current}/${contextProgress.total}`
                  ) : (
                    "Verbinde..."
                  )}
                </>
              ) : (
                <>
                  <Activity className="size-4" />
                  Session starten
                </>
              )}
            </Button>
            
            {/* Show context processing status below button */}
            {isStarting && contextProgress && contextProgress.fileName && (
              <p className="text-xs text-muted-foreground animate-pulse">
                Verarbeite: {contextProgress.fileName}
              </p>
            )}
            
            {!currentShow && (
              <p className="text-sm text-amber-500 flex items-center gap-2">
                <Radio className="size-4" />
                Bitte wähle zuerst eine Sendung aus
              </p>
            )}
            
            {/* Mobile mute hint - only visible on small screens */}
            <div className="sm:hidden flex items-center gap-2 text-xs text-muted-foreground mt-4">
              <VolumeX className="size-4" />
              <span>Tipp: Stummschalter deaktivieren für Audio-Wiedergabe</span>
            </div>
          </Card>
        )}

        {/* Chat Area */}
        {isReady && (
          <>
            {/* Token Usage Info */}
            {tokenInfo && (
              <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-secondary/20 rounded-lg border border-white/5" data-testid="token-usage-info">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-primary">{tokenInfo.tokens.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">/ {(tokenInfo.maxTokens / 1000).toFixed(0)}k Tokens</span>
                </div>
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden max-w-32">
                  <div 
                    className={`h-full transition-all ${
                      (tokenInfo.tokens / tokenInfo.maxTokens) > 0.8 ? 'bg-red-500' : 
                      (tokenInfo.tokens / tokenInfo.maxTokens) > 0.5 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min((tokenInfo.tokens / tokenInfo.maxTokens) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {((tokenInfo.tokens / tokenInfo.maxTokens) * 100).toFixed(1)}%
                </span>
              </div>
            )}

            {/* Selected Sources Info */}
            {selectedSourceIds.length > 0 && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-secondary/20 rounded-lg border border-white/5" data-testid="selected-sources-info">
                <FileText className="size-4 text-primary" />
                <span className="text-sm text-muted-foreground">Quellen:</span>
                <div className="flex flex-wrap gap-1">
                  {savedSources
                    .filter(s => selectedSourceIds.includes(s.id))
                    .map(source => (
                      <Badge key={source.id} variant="secondary" className="text-xs" data-testid={`badge-source-${source.id}`}>
                        {source.title}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
            
            {/* Transcript Context Panel */}
            {currentShow && transcriptSegments.length > 0 && (
              <div className="shrink-0">
                <div 
                  className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-secondary/30 transition-colors"
                  onClick={() => setShowTranscriptContext(!showTranscriptContext)}
                  data-testid="toggle-transcript-context"
                >
                  <FileText className="size-4 text-primary" />
                  <span className="text-sm text-muted-foreground">
                    Kontext: {transcriptSegments.length} Segmente
                  </span>
                  <Badge variant="secondary" className="text-xs">Live</Badge>
                  <ChevronRight className={`size-4 ml-auto transition-transform ${showTranscriptContext ? 'rotate-90' : ''}`} />
                </div>
                <AnimatePresence>
                  {showTranscriptContext && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-secondary/20 rounded-lg p-3 max-h-32 overflow-auto text-xs border border-white/5">
                        {transcriptSegments.slice(-20).map((seg) => {
                          const speaker = getSpeakerFromSegment(seg);
                          const colorClass = speaker !== null 
                            ? SPEAKER_COLORS[speaker % SPEAKER_COLORS.length] 
                            : "text-muted-foreground";
                          return (
                            <p key={seg.id} className={`mb-1 leading-relaxed ${colorClass}`}>
                              {speaker !== null && (
                                <span 
                                  className="opacity-60 mr-1 cursor-pointer hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSpeaker({ index: speaker, name: getSpeakerDisplayName(speaker) });
                                    setSpeakerMappingsDialogOpen(true);
                                  }}
                                  title="Klicken zum Bearbeiten"
                                >
                                  [{getSpeakerDisplayName(speaker)}]
                                </span>
                              )}
                              {seg.text}
                            </p>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            
            <div className="flex-1 min-h-0 relative glass rounded-2xl overflow-hidden border border-white/5 flex flex-col">
              <ScrollArea className="flex-1 p-6" ref={scrollRef}>
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div 
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          msg.role === "user" 
                            ? "bg-primary text-primary-foreground" 
                            : "bg-secondary/50"
                        }`}
                        data-testid={`message-${msg.role}-${msg.id}`}
                      >
                        <p className="text-sm leading-relaxed">{msg.text}</p>
                      </div>
                    </motion.div>
                  ))}
                  
                  {/* Partial User Transcript */}
                  {partialUserText && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.7 }}
                      className="flex justify-end"
                    >
                      <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-primary/50 text-primary-foreground border border-dashed border-primary">
                        <p className="text-sm leading-relaxed italic">{partialUserText}</p>
                      </div>
                    </motion.div>
                  )}
                  
                  {/* Partial Assistant Transcript */}
                  {partialAssistantText && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.7 }}
                      className="flex justify-start"
                    >
                      <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-secondary/30 border border-dashed border-accent">
                        <p className="text-sm leading-relaxed italic">{partialAssistantText}</p>
                        <span className="inline-block w-2 h-4 bg-accent ml-1 align-middle animate-pulse" />
                      </div>
                    </motion.div>
                  )}
                  
                  {messages.length === 0 && !partialUserText && !partialAssistantText && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 py-20">
                      <Brain className="size-12 mb-4 opacity-30" />
                      <p className="text-center">
                        {UI_TRANSLATIONS[language].emptyChat}
                      </p>
                    </div>
                  )}
                  <div ref={scrollAnchorRef} />
                </div>
              </ScrollArea>
            </div>

            {/* Quick Actions */}
            <div className="shrink-0 flex flex-wrap gap-2 justify-center items-center">
              <Button
                variant="default"
                size="sm"
                className="text-xs gap-1 bg-accent text-accent-foreground hover:bg-accent/80"
                onClick={handleRefreshSession}
                disabled={!isReady}
                title={UI_TRANSLATIONS[language].refreshTitle}
                data-testid="button-refresh-session"
              >
                <RefreshCw className="size-3" />
                {UI_TRANSLATIONS[language].refresh}
              </Button>
              
              {/* Quick Actions from database (includes defaults for new users) */}
              {quickActions.map((action) => {
                const translated = getTranslatedAction(action, language);
                return (
                  <Button
                    key={action.id}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      if (!translated.prompt) return;
                      sendText(translated.prompt);
                      setMessages(prev => [...prev, { id: Date.now(), role: "user", text: translated.prompt }]);
                    }}
                    disabled={!isReady}
                    data-testid={`button-quick-action-${action.id}`}
                  >
                    {translated.label}
                  </Button>
                );
              })}
              
              {/* Settings button to manage quick actions */}
              <Link href="/quick-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1"
                  title="Quick-Actions verwalten"
                  data-testid="button-manage-quick-actions"
                >
                  <Settings className="size-3" />
                </Button>
              </Link>
            </div>

            {/* Controls */}
            <div className="shrink-0 glass rounded-2xl flex items-center justify-center gap-4 py-4 px-8 border border-white/5">
              {/* Text Input */}
              <div className="flex-1 flex gap-2">
                <Input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={UI_TRANSLATIONS[language].messagePlaceholder}
                  className="bg-background/50 border-white/10"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  data-testid="input-text-cohost"
                />
                <Button 
                  size="icon" 
                  onClick={handleSendText} 
                  disabled={!textInput.trim() || !isReady}
                  data-testid="button-send-text"
                >
                  <Send className="size-4" />
                </Button>
              </div>
              
              {/* Push-to-Talk Voice Button */}
              <Button 
                size="lg"
                variant={isRecording ? "destructive" : isSpeaking ? "secondary" : "default"}
                className={`rounded-full size-14 p-0 shadow-lg transition-all duration-300 select-none touch-none ${
                  isRecording 
                    ? 'scale-110 shadow-destructive/20' 
                    : isSpeaking 
                      ? 'animate-pulse shadow-accent/30' 
                      : 'hover:scale-105 shadow-accent/20'
                }`}
                onMouseDown={handlePushToTalkStart}
                onMouseUp={handlePushToTalkEnd}
                onMouseLeave={(e) => isRecording && handlePushToTalkEnd(e)}
                onTouchStart={handlePushToTalkStart}
                onTouchEnd={handlePushToTalkEnd}
                onTouchCancel={handlePushToTalkEnd}
                disabled={!isReady}
                data-testid="button-record-cohost"
              >
                {isRecording ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </Button>
              
              {/* Mute/Unmute Button */}
              <Button 
                size="icon"
                variant={isMuted ? "destructive" : "outline"}
                className="rounded-full"
                onClick={toggleMute}
                title={isMuted ? "Ton einschalten" : "Ton ausschalten"}
                data-testid="button-mute-cohost"
              >
                {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>
            </div>
          </>
        )}
      </main>

      {/* Edit Show Dialog */}
      <Dialog open={editShowDialogOpen} onOpenChange={setEditShowDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sendung bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <Input
              placeholder="Sendungstitel eingeben..."
              value={editShowTitle}
              onChange={(e) => setEditShowTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUpdateShow()}
              data-testid="input-edit-show-title-cohost"
            />
            <Button onClick={handleUpdateShow} disabled={!editShowTitle.trim()} data-testid="button-update-show-cohost">
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Show Confirmation */}
      <AlertDialog open={deleteShowId !== null} onOpenChange={(open) => !open && setDeleteShowId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sendung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Die Sendung und alle zugehörigen Transkripte werden dauerhaft gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-show-cohost">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteShow} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-show-cohost">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Prompt Dialog */}
      <Dialog open={editPromptDialogOpen} onOpenChange={setEditPromptDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>System-Prompt bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <Input
              placeholder="Prompt-Name..."
              value={editPromptName}
              onChange={(e) => setEditPromptName(e.target.value)}
              data-testid="input-edit-prompt-name"
            />
            <Textarea
              placeholder="Prompt-Text..."
              value={editPromptText}
              onChange={(e) => setEditPromptText(e.target.value)}
              className="h-32 resize-none"
              data-testid="input-edit-prompt-text"
            />
            <Button onClick={handleUpdatePrompt} disabled={!editPromptName.trim() || !editPromptText.trim()} data-testid="button-update-prompt">
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Prompt Confirmation */}
      <AlertDialog open={deletePromptId !== null} onOpenChange={(open) => !open && setDeletePromptId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>System-Prompt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser System-Prompt wird dauerhaft gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-prompt">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeletePrompt} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-prompt">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Speaker Name Dialog */}
      <Dialog open={speakerMappingsDialogOpen} onOpenChange={setSpeakerMappingsDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sprecher benennen</DialogTitle>
          </DialogHeader>
          {editingSpeaker && (
            <div className="flex flex-col gap-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Gib einen Namen für Sprecher {editingSpeaker.index + 1} ein:
              </p>
              <Input
                placeholder="z.B. Max, Anna, Host..."
                value={editingSpeaker.name}
                onChange={(e) => setEditingSpeaker({ ...editingSpeaker, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editingSpeaker.name.trim()) {
                    saveSpeakerMapping(editingSpeaker.index, editingSpeaker.name);
                    setSpeakerMappingsDialogOpen(false);
                    setEditingSpeaker(null);
                  }
                }}
                data-testid="input-speaker-name"
              />
              <Button 
                onClick={() => {
                  saveSpeakerMapping(editingSpeaker.index, editingSpeaker.name);
                  setSpeakerMappingsDialogOpen(false);
                  setEditingSpeaker(null);
                }} 
                disabled={!editingSpeaker.name.trim()}
                data-testid="button-save-speaker-name"
              >
                Speichern
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
