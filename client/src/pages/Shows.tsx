import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Radio, Search, Calendar, ArrowRight, LogOut, MoreVertical, Edit, Trash2, Download, FileText, FileJson } from "lucide-react";

interface Show {
  id: number;
  title: string;
  createdAt: string;
}

interface TranscriptSegment {
  id: number;
  text: string;
  speaker: number | null;
  timestamp: string;
}

const PAGE_SIZE = 12;

export default function Shows() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [shows, setShows] = useState<Show[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingShow, setEditingShow] = useState<Show | null>(null);
  const [editTitle, setEditTitle] = useState("");
  
  const [deleteShowId, setDeleteShowId] = useState<number | null>(null);
  const [deleteShowTitle, setDeleteShowTitle] = useState("");

  const fetchShows = () => {
    fetch("/api/shows")
      .then(res => res.json())
      .then(data => {
        setShows(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching shows:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchShows();
  }, []);

  const openEditDialog = (show: Show, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingShow(show);
    setEditTitle(show.title);
    setEditDialogOpen(true);
  };

  const handleUpdateShow = async () => {
    if (!editingShow || !editTitle.trim()) return;
    
    try {
      const res = await fetch(`/api/shows/${editingShow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim() })
      });
      
      if (res.ok) {
        setShows(shows.map(s => s.id === editingShow.id ? { ...s, title: editTitle.trim() } : s));
        toast({ title: "Sendung aktualisiert", description: "Der Titel wurde erfolgreich geändert." });
        setEditDialogOpen(false);
        setEditingShow(null);
      } else {
        toast({ title: "Fehler", description: "Sendung konnte nicht aktualisiert werden.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Fehler", description: "Sendung konnte nicht aktualisiert werden.", variant: "destructive" });
    }
  };

  const openDeleteDialog = (show: Show, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteShowId(show.id);
    setDeleteShowTitle(show.title);
  };

  const handleDeleteShow = async () => {
    if (!deleteShowId) return;
    
    try {
      const res = await fetch(`/api/shows/${deleteShowId}`, { method: "DELETE" });
      
      if (res.ok) {
        setShows(shows.filter(s => s.id !== deleteShowId));
        toast({ title: "Sendung gelöscht", description: "Die Sendung wurde erfolgreich entfernt." });
        setDeleteShowId(null);
      } else {
        toast({ title: "Fehler", description: "Sendung konnte nicht gelöscht werden.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Fehler", description: "Sendung konnte nicht gelöscht werden.", variant: "destructive" });
    }
  };

  const handleExport = async (show: Show, format: "txt" | "json", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      const res = await fetch(`/api/shows/${show.id}/segments`);
      if (!res.ok) throw new Error("Failed to fetch segments");
      
      const segments: TranscriptSegment[] = await res.json();
      
      let content: string;
      let filename: string;
      let mimeType: string;
      
      if (format === "json") {
        content = JSON.stringify({ show: { id: show.id, title: show.title, createdAt: show.createdAt }, segments }, null, 2);
        filename = `${show.title.replace(/[^a-z0-9äöüß]/gi, "_")}_${show.id}.json`;
        mimeType = "application/json";
      } else {
        const lines = segments.map(seg => {
          const speaker = seg.speaker !== null ? `[Sprecher ${seg.speaker + 1}] ` : "";
          return `${speaker}${seg.text}`;
        });
        content = `# ${show.title}\n\nExportiert am: ${new Date().toLocaleString("de-CH")}\n\n---\n\n${lines.join("\n\n")}`;
        filename = `${show.title.replace(/[^a-z0-9äöüß]/gi, "_")}_${show.id}.txt`;
        mimeType = "text/plain";
      }
      
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ title: "Export erfolgreich", description: `${filename} wurde heruntergeladen.` });
    } catch (error) {
      toast({ title: "Fehler", description: "Export fehlgeschlagen.", variant: "destructive" });
    }
  };

  const filteredShows = shows.filter(show => 
    show.title.toLowerCase().includes(search.toLowerCase())
  );

  const visibleShows = filteredShows.slice(0, visibleCount);
  const hasMore = visibleCount < filteredShows.length;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white" data-testid="text-shows-title">Alle Sendungen</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">{filteredShows.length} Sendungen gefunden</p>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <span className="text-sm text-slate-400">{user?.firstName || user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => logout()} data-testid="button-logout">
              <LogOut className="h-4 w-4 mr-2" />
              Abmelden
            </Button>
          </div>
        </div>

        <div className="mb-4 sm:mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Sendungen durchsuchen..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="pl-10 bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              data-testid="input-show-search"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-400">Laden...</div>
          </div>
        ) : visibleShows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Radio className="h-12 w-12 mb-4 opacity-50" />
            <p>Keine Sendungen gefunden</p>
            {search && (
              <Button variant="link" onClick={() => setSearch("")} className="mt-2 text-primary">
                Suche zurücksetzen
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {visibleShows.map(show => (
                <Card 
                  key={show.id}
                  className="bg-slate-800/50 border-slate-700 hover:border-primary/50 hover:bg-slate-800 transition-all group"
                  data-testid={`card-show-${show.id}`}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/?show=${show.id}`} className="flex-1 min-w-0 cursor-pointer">
                        <div className="flex items-center gap-2 mb-2">
                          <Radio className="h-4 w-4 text-primary shrink-0" />
                          <h3 className="font-medium text-white truncate group-hover:text-primary transition-colors text-sm sm:text-base">
                            {show.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-slate-500">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(show.createdAt)}</span>
                        </div>
                      </Link>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 text-slate-400 hover:text-white"
                            onClick={(e) => e.preventDefault()}
                            data-testid={`button-menu-${show.id}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700">
                          <DropdownMenuItem 
                            onClick={(e) => openEditDialog(show, e as unknown as React.MouseEvent)}
                            className="text-slate-200 focus:bg-slate-700 focus:text-white cursor-pointer"
                            data-testid={`button-edit-${show.id}`}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Bearbeiten
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => handleExport(show, "txt", e as unknown as React.MouseEvent)}
                            className="text-slate-200 focus:bg-slate-700 focus:text-white cursor-pointer"
                            data-testid={`button-export-txt-${show.id}`}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            Export als Text
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => handleExport(show, "json", e as unknown as React.MouseEvent)}
                            className="text-slate-200 focus:bg-slate-700 focus:text-white cursor-pointer"
                            data-testid={`button-export-json-${show.id}`}
                          >
                            <FileJson className="h-4 w-4 mr-2" />
                            Export als JSON
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => openDeleteDialog(show, e as unknown as React.MouseEvent)}
                            className="text-red-400 focus:bg-red-500/20 focus:text-red-400 cursor-pointer"
                            data-testid={`button-delete-${show.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Löschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-8">
                <Button 
                  variant="outline" 
                  onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                  className="bg-slate-800 border-slate-600 hover:bg-slate-700"
                  data-testid="button-load-more"
                >
                  Mehr laden ({filteredShows.length - visibleCount} weitere)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 w-[calc(100%-2rem)] max-w-md mx-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-white text-base sm:text-lg">Sendung bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 sm:gap-4 pt-3 sm:pt-4">
            <Input
              placeholder="Sendungstitel eingeben..."
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUpdateShow()}
              className="bg-slate-800 border-slate-700 text-white w-full text-sm sm:text-base h-10 sm:h-11"
              data-testid="input-edit-show-title"
            />
            <Button 
              onClick={handleUpdateShow} 
              disabled={!editTitle.trim()} 
              className="w-full h-10 sm:h-11 text-sm sm:text-base"
              data-testid="button-save-show"
            >
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteShowId !== null} onOpenChange={(open) => !open && setDeleteShowId(null)}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 w-[calc(100%-2rem)] max-w-md mx-auto p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-base sm:text-lg">Sendung löschen?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-sm sm:text-base">
              Diese Aktion kann nicht rückgängig gemacht werden. Die Sendung "{deleteShowTitle}" und alle zugehörigen Transkripte werden dauerhaft gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700 w-full sm:w-auto h-10 text-sm sm:text-base" data-testid="button-cancel-delete">
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteShow} 
              className="bg-red-600 text-white hover:bg-red-700 w-full sm:w-auto h-10 text-sm sm:text-base" 
              data-testid="button-confirm-delete"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
