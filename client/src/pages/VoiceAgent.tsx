import { apiUrl } from "@/lib/config";
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Send, Activity, Database, Sparkles, ShieldCheck, Monitor, MonitorSpeaker, Plus, ChevronDown, Radio, MessageSquare, LogOut, Edit, Trash2, Download, FileText, FileJson, Search, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWebSocketAudio, type TranscriptEvent, type AudioSource, type TranscriptLanguage } from "@/hooks/useWebSocketAudio";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Show {
  id: number;
  title: string;
  createdAt: string;
}

interface SpeakerMapping {
  id: number;
  showId: number;
  speakerIndex: number;
  displayName: string;
}

interface RecentSegment {
  id: number;
  text: string;
  speaker?: number | null;
}

const SPEAKER_COLORS = [
  "text-accent",
  "text-purple-400", 
  "text-success",
  "text-orange-400",
  "text-pink-400",
  "text-yellow-400",
];

const getSpeakerLabel = (speaker: number | null) => {
  if (speaker === null) return null;
  return `Sprecher ${speaker + 1}`;
};

const getSpeakerColor = (speaker: number | null) => {
  if (speaker === null) return "text-muted-foreground";
  return SPEAKER_COLORS[speaker % SPEAKER_COLORS.length];
};

export default function VoiceAgent() {
  const [transcript, setTranscript] = useState<{ id: number; text: string; speaker: number | null; isFinal: boolean }[]>([]);
  const [partialText, setPartialText] = useState("");
  const [partialSpeaker, setPartialSpeaker] = useState<number | null>(null);
  const [recentSegments, setRecentSegments] = useState<RecentSegment[]>([]);
  const [selectedSource, setSelectedSource] = useState<AudioSource>("microphone");
  
  const [shows, setShows] = useState<Show[]>([]);
  const [currentShow, setCurrentShow] = useState<Show | null>(null);
  const [newShowTitle, setNewShowTitle] = useState("");
  const [showDialogOpen, setShowDialogOpen] = useState(false);
  const [editingShow, setEditingShow] = useState<Show | null>(null);
  const [editShowTitle, setEditShowTitle] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteShowId, setDeleteShowId] = useState<number | null>(null);
  const [speakerMappings, setSpeakerMappings] = useState<SpeakerMapping[]>([]);
  const [speakerDialogOpen, setSpeakerDialogOpen] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<{ index: number; name: string } | null>(null);
  const [showSearch, setShowSearch] = useState("");
  const [showSelectorOpen, setShowSelectorOpen] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const highlightText = (text: string, search: string) => {
    if (!search.trim()) return text;
    const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) => 
      regex.test(part) ? <mark key={i} className="bg-yellow-400/50 text-current rounded px-0.5">{part}</mark> : part
    );
  };
  
  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentShow) {
        searchSegments(transcriptSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [transcriptSearch, currentShow]);
  
  const { isConnected, isRecording, isReady, deepgramStatus, audioSource, language, speechDuration, sttProvider, setSttProvider, setLanguage, startRecording, stopRecording, onTranscript, reconnectDeepgram } = useWebSocketAudio();
  const { user, logout } = useAuth();
  const providerLabel = sttProvider === "elevenlabs" ? "ElevenLabs" : "Deepgram";

  useEffect(() => {
    fetchShows();
  }, []);

  // Ref to track current search term for use in callbacks
  const transcriptSearchRef = useRef(transcriptSearch);
  useEffect(() => { transcriptSearchRef.current = transcriptSearch; }, [transcriptSearch]);
  
  // Ref to track current show for use in callbacks (avoids stale closures)
  const currentShowRef = useRef(currentShow);
  useEffect(() => { currentShowRef.current = currentShow; }, [currentShow]);
  
  useEffect(() => {
    onTranscript((event: TranscriptEvent) => {
      if (event.type === "transcript.partial") {
        setPartialText(event.text);
        setPartialSpeaker(event.speaker);
      } else if (event.type === "transcript.final") {
        setTranscript((prev) => [...prev, { id: Date.now(), text: event.text, speaker: event.speaker, isFinal: true }]);
        setPartialText("");
        setPartialSpeaker(null);
        
        // Only auto-refresh if no search is active
        if (!transcriptSearchRef.current.trim()) {
          fetchRecentSegments();
        }
      }
      
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    setTranscript([]);
    setRecentSegments([]);
    if (currentShow) {
      fetchRecentSegments(currentShow.id);
      fetchSpeakerMappings(currentShow.id);
    } else {
      setSpeakerMappings([]);
    }
  }, [currentShow]);

  const fetchShows = async () => {
    try {
      const res = await fetch(apiUrl("/api/shows"));
      const data = await res.json();
      setShows(data);
    } catch (error) {
      console.error("Error fetching shows:", error);
    }
  };

  // Request counter to handle race conditions
  const searchRequestIdRef = useRef(0);
  
  const fetchRecentSegments = async (showIdOverride?: number) => {
    // Use override if provided, otherwise use ref (for callbacks) or state
    const showId = showIdOverride ?? currentShowRef.current?.id ?? currentShow?.id;
    
    // Don't fetch segments if no show is selected
    if (!showId) {
      setRecentSegments([]);
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    try {
      const res = await fetch(apiUrl(`/api/transcripts/recent?limit=3000&showId=${showId}`));
      const data = await res.json();
      // Only update if this is still the latest request
      if (requestId === searchRequestIdRef.current) {
        setRecentSegments(data);
      }
    } catch (error) {
      console.error("Error fetching recent segments:", error);
    }
  };
  
  const searchSegments = async (query: string) => {
    if (!query.trim() || !currentShow) {
      fetchRecentSegments();
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    try {
      const res = await fetch(apiUrl(`/api/transcripts/search?q=${encodeURIComponent(query)}&showId=${currentShow.id}`));
      const data = await res.json();
      // Only update if this is still the latest request
      if (requestId === searchRequestIdRef.current) {
        setRecentSegments(data);
      }
    } catch (error) {
      console.error("Error searching segments:", error);
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

  const handleCreateShow = async () => {
    if (!newShowTitle.trim()) return;
    
    try {
      const res = await fetch(apiUrl("/api/shows"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newShowTitle }),
      });
      const show = await res.json();
      setShows((prev) => [show, ...prev]);
      setCurrentShow(show);
      setNewShowTitle("");
      setShowDialogOpen(false);
    } catch (error) {
      console.error("Error creating show:", error);
    }
  };

  const handleEditShow = (show: Show) => {
    setEditingShow(show);
    setEditShowTitle(show.title);
    setEditDialogOpen(true);
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
      setEditDialogOpen(false);
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

  const handleExportShow = async (showId: number, format: "json" | "md") => {
    try {
      const res = await fetch(apiUrl(`/api/shows/${showId}/export?format=${format}`));
      const contentDisposition = res.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || `show_${showId}.${format}`;
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error exporting show:", error);
    }
  };

  const handleRecordToggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(selectedSource, currentShow?.id, language);
    }
  };
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getSourceIcon = (source: AudioSource) => {
    switch (source) {
      case "microphone": return <Mic className="size-4" />;
      case "tab": return <Monitor className="size-4" />;
      case "both": return <MonitorSpeaker className="size-4" />;
    }
  };

  const getSourceLabel = (source: AudioSource) => {
    switch (source) {
      case "microphone": return "Mikrofon";
      case "tab": return "Tab-Audio";
      case "both": return "Beides";
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-foreground flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-14 sm:h-16 border-b border-border/40 glass flex items-center justify-between px-3 sm:px-6 z-10">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <div className="size-7 sm:size-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Activity className="size-3 sm:size-4 text-primary animate-pulse-slow" />
            </div>
            <span className="font-mono font-bold tracking-tight text-sm sm:text-lg hidden sm:inline">PODCAST<span className="text-primary">CO-HOST</span></span>
          </div>
          
          {/* Show Selector */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Popover open={showSelectorOpen} onOpenChange={setShowSelectorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-1 sm:gap-2 min-w-[120px] sm:min-w-[200px] justify-between text-xs sm:text-sm" data-testid="button-show-selector">
                  <div className="flex items-center gap-2">
                    <Radio className="size-4 text-primary" />
                    <span className="truncate">{currentShow?.title || "Keine Sendung"}</span>
                  </div>
                  <ChevronDown className="size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[420px] p-0">
                <div className="p-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      placeholder="Sendung suchen..."
                      value={showSearch}
                      onChange={(e) => setShowSearch(e.target.value)}
                      className="pl-9 pr-8"
                      data-testid="input-show-search"
                    />
                    {showSearch && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
                        onClick={() => setShowSearch("")}
                        data-testid="button-clear-search"
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <ScrollArea className="max-h-[300px]">
                  <div className="p-2">
                    <button
                      onClick={() => { setCurrentShow(null); setShowSelectorOpen(false); setShowSearch(""); }}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm text-muted-foreground"
                      data-testid="button-no-show"
                    >
                      Keine Sendung
                    </button>
                    {shows
                      .filter(show => show.title.toLowerCase().includes(showSearch.toLowerCase()))
                      .map((show) => (
                        <div
                          key={show.id}
                          className={`group flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent cursor-pointer ${currentShow?.id === show.id ? 'bg-accent' : ''}`}
                          onClick={() => { setCurrentShow(show); setShowSelectorOpen(false); setShowSearch(""); }}
                          data-testid={`item-show-${show.id}`}
                        >
                          <Radio className="size-3 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{show.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(show.createdAt).toLocaleDateString("de-CH")}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-6" 
                              onClick={(e) => { e.stopPropagation(); handleExportShow(show.id, "json"); }}
                              title="Als JSON exportieren"
                              data-testid={`button-export-json-${show.id}`}
                            >
                              <FileJson className="size-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-6" 
                              onClick={(e) => { e.stopPropagation(); handleExportShow(show.id, "md"); }}
                              title="Als Markdown exportieren"
                              data-testid={`button-export-md-${show.id}`}
                            >
                              <FileText className="size-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-6" 
                              onClick={(e) => { e.stopPropagation(); handleEditShow(show); setShowSelectorOpen(false); }}
                              data-testid={`button-edit-show-${show.id}`}
                            >
                              <Edit className="size-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="size-6 text-destructive hover:text-destructive" 
                              onClick={(e) => { e.stopPropagation(); setDeleteShowId(show.id); setShowSelectorOpen(false); }}
                              data-testid={`button-delete-show-${show.id}`}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    {shows.filter(show => show.title.toLowerCase().includes(showSearch.toLowerCase())).length === 0 && (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                        {showSearch ? "Keine Sendungen gefunden" : "Noch keine Sendungen"}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>

            <Dialog open={showDialogOpen} onOpenChange={setShowDialogOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="outline" data-testid="button-new-show">
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
                    data-testid="input-show-title"
                  />
                  <Button onClick={handleCreateShow} disabled={!newShowTitle.trim()} data-testid="button-create-show">
                    Sendung erstellen
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
           <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary font-mono text-[10px] sm:text-xs hidden sm:flex" data-testid="status-badge">
             <div className={`size-1.5 rounded-full ${isRecording ? 'bg-success animate-pulse' : isReady ? 'bg-primary' : 'bg-yellow-400'} mr-2`} />
             {isRecording ? "LISTENING" : isReady ? "READY" : isConnected ? "CONNECTING..." : "OFFLINE"}
           </Badge>
           <Button 
             variant="ghost" 
             size="icon" 
             className="size-8 sm:size-9"
             onClick={() => logout()}
             title={user?.email || "Abmelden"}
             data-testid="button-logout"
           >
             <LogOut className="size-4 text-muted-foreground hover:text-foreground" />
           </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 p-3 sm:p-6 overflow-hidden">
        
        {/* Left Column: Live Transcript */}
        <div className="lg:col-span-8 flex flex-col gap-6 h-full min-h-0 relative">
          
          {/* Transcript Display */}
          <div className="flex-1 min-h-0 relative glass rounded-2xl overflow-hidden border border-white/5 flex flex-col" data-testid="transcript-display">
             <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-transparent to-background/80 pointer-events-none z-10" />
             
             {/* Show indicator */}
             {currentShow && (
               <div className="absolute top-4 left-4 z-20">
                 <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                   <Radio className="size-3" />
                   {currentShow.title}
                 </Badge>
               </div>
             )}
             
             <div 
               ref={scrollRef}
               className="flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth z-0"
             >
                <div className="h-[20vh]" />
                
                {transcript.map((item) => (
                  <motion.div 
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 0.8, y: 0 }}
                    className="text-lg md:text-xl font-medium leading-relaxed"
                    data-testid={`transcript-final-${item.id}`}
                  >
                    {item.speaker !== null && (
                      <span 
                        className={`text-sm font-mono mr-2 cursor-pointer hover:underline ${getSpeakerColor(item.speaker)}`}
                        onClick={() => {
                          setEditingSpeaker({ index: item.speaker!, name: getSpeakerDisplayName(item.speaker!) });
                          setSpeakerDialogOpen(true);
                        }}
                        title="Klicken zum Bearbeiten"
                      >
                        [{getSpeakerDisplayName(item.speaker)}]
                      </span>
                    )}
                    <span className={item.speaker !== null ? getSpeakerColor(item.speaker) : 'text-muted-foreground'}>
                      {item.text}
                    </span>
                  </motion.div>
                ))}
                
                {isRecording && partialText && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-2xl md:text-3xl font-semibold leading-relaxed font-mono"
                    data-testid="transcript-partial"
                  >
                    {partialSpeaker !== null && (
                      <span 
                        className={`text-sm mr-2 cursor-pointer hover:underline ${getSpeakerColor(partialSpeaker)}`}
                        onClick={() => {
                          setEditingSpeaker({ index: partialSpeaker, name: getSpeakerDisplayName(partialSpeaker) });
                          setSpeakerDialogOpen(true);
                        }}
                        title="Klicken zum Bearbeiten"
                      >
                        [{getSpeakerDisplayName(partialSpeaker)}]
                      </span>
                    )}
                    <span className={partialSpeaker !== null ? getSpeakerColor(partialSpeaker) : 'text-foreground'}>
                      {partialText}
                    </span>
                    <span className="inline-block w-2 h-6 bg-primary ml-1 align-middle animate-pulse" />
                  </motion.div>
                )}
                
                {!isRecording && transcript.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
                    <Mic className="size-12 mb-4 opacity-30" />
                    <p className="text-center">
                      {currentShow 
                        ? `Klicke auf Record um "${currentShow.title}" aufzunehmen`
                        : "Wähle eine Sendung und klicke auf Record"
                      }
                    </p>
                  </div>
                )}
                
                <div className="h-[20vh]" />
             </div>
          </div>

          {/* Control Bar */}
          <div className="shrink-0 glass rounded-2xl flex flex-col items-center justify-center gap-4 py-4 px-8 relative overflow-hidden border border-white/5">
             {/* Waveform Visualizer Background */}
             {isRecording && (
               <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-20 pointer-events-none h-full">
                 {Array.from({ length: 40 }).map((_, i) => (
                   <motion.div
                     key={i}
                     animate={{ height: [10, Math.random() * 60 + 10, 10] }}
                     transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.05 }}
                     className="w-1 bg-primary rounded-full"
                   />
                 ))}
               </div>
             )}

             {/* Audio Source & Language Selector */}
             <div className="flex items-center gap-4 z-10">
               <div className="flex items-center gap-2">
                 {(["microphone", "tab", "both"] as AudioSource[]).map((source) => (
                   <Button
                     key={source}
                     size="sm"
                     variant={selectedSource === source ? "default" : "outline"}
                     className={`gap-2 transition-all ${selectedSource === source ? '' : 'opacity-60 hover:opacity-100'}`}
                     onClick={() => setSelectedSource(source)}
                     disabled={isRecording}
                     data-testid={`button-source-${source}`}
                   >
                     {getSourceIcon(source)}
                     <span className="hidden sm:inline">{getSourceLabel(source)}</span>
                   </Button>
                 ))}
               </div>
               
               <Select
                 value={sttProvider}
                 onValueChange={(value) => {
                   const provider = value === "elevenlabs" ? "elevenlabs" : "deepgram";
                   setSttProvider(provider);
                 }}
                 disabled={isRecording}
               >
                 <SelectTrigger className="w-[140px]" data-testid="select-stt-provider">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="deepgram" data-testid="stt-provider-deepgram">Deepgram</SelectItem>
                   <SelectItem value="elevenlabs" data-testid="stt-provider-elevenlabs">ElevenLabs</SelectItem>
                 </SelectContent>
               </Select>

               <Select 
                 value={language} 
                 onValueChange={(val) => setLanguage(val as TranscriptLanguage)}
                 disabled={isRecording}
               >
                 <SelectTrigger className="w-[140px]" data-testid="select-language">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="de-CH" data-testid="select-language-de">Deutsch</SelectItem>
                   <SelectItem value="en" data-testid="select-language-en">English</SelectItem>
                 </SelectContent>
               </Select>
             </div>

             <div className="flex items-center gap-6 z-10">
               <Button 
                 size="lg"
                 variant={isRecording ? "destructive" : "default"}
                 className={`rounded-full size-16 p-0 shadow-lg transition-all duration-300 ${isRecording ? 'scale-110 shadow-destructive/20' : 'hover:scale-105 shadow-primary/20'}`}
                 onClick={handleRecordToggle}
                 disabled={!isConnected || !currentShow}
                 title={!currentShow ? "Bitte zuerst eine Sendung auswählen" : undefined}
                 data-testid="button-record"
               >
                 {isRecording ? <MicOff className="size-6" /> : getSourceIcon(selectedSource)}
               </Button>
             </div>
             
             {!currentShow && (
               <div className="text-amber-400 text-sm font-medium animate-pulse z-10">
                 ⚠️ Bitte zuerst eine Sendung auswählen
               </div>
             )}

            {/* STT Status - visible on all devices during recording */}
             {isRecording && (
               <div className="flex items-center gap-3 z-10 md:hidden">
                 <span className={`flex items-center gap-1.5 text-xs ${
                   deepgramStatus === 'connected' ? 'text-success' : 
                   deepgramStatus === 'reconnecting' ? 'text-yellow-400' : 'text-red-400'
                 }`}>
                   <span className={`size-2 rounded-full ${
                     deepgramStatus === 'connected' ? 'bg-success' : 
                     deepgramStatus === 'reconnecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
                   }`} />
                  {deepgramStatus === 'connected' ? `${providerLabel} aktiv` : 
                   deepgramStatus === 'reconnecting' ? 'Verbinden...' : 'Verbindung getrennt'}
                 </span>
                 <Button
                   size="sm"
                   variant="outline"
                   className={`h-7 px-3 text-xs ${
                     deepgramStatus === 'disconnected' 
                       ? 'border-red-400/50 text-red-400 hover:bg-red-400/10' 
                       : 'border-zinc-600 text-zinc-400 hover:bg-zinc-700/50'
                   }`}
                   onClick={reconnectDeepgram}
                   data-testid="button-reconnect-deepgram-mobile"
                 >
                   Neu verbinden
                 </Button>
               </div>
             )}

             <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 z-10">
                <ShieldCheck className="size-3" />
                <span>Audio is processed securely. By recording, you consent to analysis.</span>
             </div>
             
             <div className="absolute right-8 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground hidden md:block">
                {isRecording ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-success">LIVE: {getSourceLabel(audioSource).toUpperCase()}</span>
                    <span className="text-primary text-lg font-bold">{formatTime(Math.round(speechDuration))}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`flex items-center gap-1 ${
                        deepgramStatus === 'connected' ? 'text-success' : 
                        deepgramStatus === 'reconnecting' ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        <span className={`size-1.5 rounded-full ${
                          deepgramStatus === 'connected' ? 'bg-success' : 
                          deepgramStatus === 'reconnecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
                        }`} />
                        {deepgramStatus === 'connected' ? `${providerLabel} OK` : 
                         deepgramStatus === 'reconnecting' ? 'Verbinden...' : 'Getrennt'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`h-5 px-2 text-[10px] ${
                          deepgramStatus === 'disconnected' 
                            ? 'border-red-400/50 text-red-400 hover:bg-red-400/10' 
                            : 'border-zinc-600 text-zinc-400 hover:bg-zinc-700/50'
                        }`}
                        onClick={reconnectDeepgram}
                        data-testid="button-reconnect-deepgram"
                      >
                        Reconnect
                      </Button>
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">IDLE</span>
                )}
             </div>
          </div>

        </div>

        {/* Right Column: Transcript Search & Context */}
        <div className="lg:col-span-4 flex flex-col gap-6 h-full min-h-0">
          
          {/* Context/Memory Visualization - Full Height */}
          <Card className="flex-1 bg-black/20 border-white/5 p-4 flex flex-col gap-3">
             <div className="flex items-center justify-between text-xs font-mono text-muted-foreground uppercase tracking-wider">
               <span className="flex items-center gap-2"><Database className="size-3" /> Retrieved Context</span>
               <span className="text-primary">
                 {transcriptSearch.trim() 
                   ? `${recentSegments.length} TREFFER`
                   : `${recentSegments.length} SEGMENTS`
                 }
               </span>
             </div>
             
             {/* Transcript Search */}
             <div className="relative">
               <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
               <Input
                 placeholder="Transkript durchsuchen..."
                 value={transcriptSearch}
                 onChange={(e) => setTranscriptSearch(e.target.value)}
                 className="pl-8 pr-8 h-8 text-xs bg-white/5 border-white/10"
                 data-testid="input-transcript-search"
               />
               {transcriptSearch && (
                 <Button
                   variant="ghost"
                   size="sm"
                   className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                   onClick={() => setTranscriptSearch("")}
                   data-testid="button-clear-transcript-search"
                 >
                   <X className="size-3" />
                 </Button>
               )}
             </div>
             
             <ScrollArea className="flex-1 -mx-2 px-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
               <div className="space-y-2">
                 {recentSegments.map((seg) => {
                   const speakerColor = typeof seg.speaker === 'number' ? getSpeakerColor(seg.speaker) : "text-foreground/80";
                   return (
                     <div key={seg.id} className="p-3 rounded-lg bg-white/5 border border-white/5 text-xs group hover:bg-white/10 transition-colors cursor-default" data-testid={`memory-${seg.id}`}>
                       <div className="flex justify-between items-start mb-1">
                         <div className="flex items-start gap-1 flex-1 min-w-0">
                           {typeof seg.speaker === 'number' && (
                             <span 
                               className={`${speakerColor} font-medium mr-1 cursor-pointer hover:underline shrink-0`}
                               onClick={() => {
                                 setEditingSpeaker({ index: seg.speaker, name: getSpeakerDisplayName(seg.speaker) });
                                 setSpeakerDialogOpen(true);
                               }}
                             >
                               [{getSpeakerDisplayName(seg.speaker)}]
                             </span>
                           )}
                           <span className={`${speakerColor} font-medium`}>
                             {highlightText(seg.text, transcriptSearch)}
                           </span>
                         </div>
                         {seg.timestamp && (
                           <span className="text-[10px] text-muted-foreground/40 shrink-0 ml-2 tabular-nums">
                             {new Date(seg.timestamp).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                           </span>
                         )}
                       </div>
                     </div>
                   );
                 })}
                 {recentSegments.length === 0 && (
                   <div className="text-center text-muted-foreground/50 text-xs py-4">
                     {!currentShow 
                       ? "Sendung auswählen" 
                       : transcriptSearch.trim() 
                         ? `Keine Treffer für "${transcriptSearch}"` 
                         : "Noch keine Segmente"
                     }
                   </div>
                 )}
               </div>
             </ScrollArea>
          </Card>

        </div>
      </main>

      {/* Edit Show Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
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
              data-testid="input-edit-show-title"
            />
            <Button onClick={handleUpdateShow} disabled={!editShowTitle.trim()} data-testid="button-update-show">
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
            <AlertDialogCancel data-testid="button-cancel-delete">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteShow} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Speaker Name Dialog */}
      <Dialog open={speakerDialogOpen} onOpenChange={setSpeakerDialogOpen}>
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
                    setSpeakerDialogOpen(false);
                    setEditingSpeaker(null);
                  }
                }}
                data-testid="input-speaker-name"
              />
              <Button 
                onClick={() => {
                  saveSpeakerMapping(editingSpeaker.index, editingSpeaker.name);
                  setSpeakerDialogOpen(false);
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
