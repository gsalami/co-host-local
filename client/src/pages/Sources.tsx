import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, FileText, FileCode, Trash2, Edit, Eye, Plus, Mic, Type } from "lucide-react";
import type { Source } from "@shared/schema";

export default function Sources() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [uploadTab, setUploadTab] = useState<"file" | "text">("file");

  const { data: sources = [], isLoading } = useQuery<Source[]>({
    queryKey: ["/api/sources"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; type: string; mimeType: string; originalFilename: string; fileData: string; textContent?: string }) => {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create source");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      setIsUploadDialogOpen(false);
      setUploadTitle("");
      setUploadFile(null);
      setPasteTitle("");
      setPasteContent("");
      toast({ title: "Quelle erstellt" });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Quelle konnte nicht erstellt werden", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, title, textContent }: { id: number; title: string; textContent: string }) => {
      const res = await fetch(`/api/sources/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, textContent }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update source");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      setIsEditDialogOpen(false);
      setSelectedSource(null);
      toast({ title: "Quelle aktualisiert" });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Quelle konnte nicht aktualisiert werden", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/sources/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete source");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
      toast({ title: "Quelle gelöscht" });
    },
    onError: () => {
      toast({ title: "Fehler", description: "Quelle konnte nicht gelöscht werden", variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      if (!uploadTitle) {
        setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle.trim()) {
      toast({ title: "Fehler", description: "Bitte Titel und Datei angeben", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      
      let type = "text";
      if (uploadFile.type === "application/pdf") type = "pdf";
      else if (uploadFile.type === "application/json") type = "json";
      else if (uploadFile.name.endsWith(".md")) type = "markdown";

      createMutation.mutate({
        title: uploadTitle.trim(),
        type,
        mimeType: uploadFile.type || "text/plain",
        originalFilename: uploadFile.name,
        fileData: base64,
      });
    };
    reader.readAsDataURL(uploadFile);
  };

  const handlePasteSubmit = () => {
    if (!pasteTitle.trim() || !pasteContent.trim()) {
      toast({ title: "Fehler", description: "Bitte Titel und Text angeben", variant: "destructive" });
      return;
    }

    createMutation.mutate({
      title: pasteTitle.trim(),
      type: "text",
      mimeType: "text/plain",
      originalFilename: `${pasteTitle.trim()}.txt`,
      fileData: btoa(unescape(encodeURIComponent(pasteContent))),
      textContent: pasteContent,
    });
  };

  const openEditDialog = (source: Source) => {
    setSelectedSource(source);
    setEditTitle(source.title);
    setEditContent(source.textContent);
    setIsEditDialogOpen(true);
  };

  const openViewDialog = (source: Source) => {
    setSelectedSource(source);
    setIsViewDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedSource || !editTitle.trim()) return;
    updateMutation.mutate({
      id: selectedSource.id,
      title: editTitle.trim(),
      textContent: editContent,
    });
  };

  const getTypeIcon = (type: string) => {
    if (type === "pdf") return <FileText className="size-4 text-red-400" />;
    if (type === "json") return <FileCode className="size-4 text-yellow-400" />;
    if (type === "markdown") return <FileCode className="size-4 text-primary" />;
    return <FileText className="size-4 text-muted-foreground" />;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-auto">
      <div className="container mx-auto p-3 sm:p-4 max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
          <div className="flex items-center gap-2 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/")}
              data-testid="button-back"
              className="size-8 sm:size-10"
            >
              <ArrowLeft className="size-4 sm:size-5" />
            </Button>
            <h1 className="text-xl sm:text-2xl font-bold" style={{ fontFamily: "Montserrat, sans-serif" }}>
              Quellen
            </h1>
          </div>
          <div className="flex gap-2 ml-10 sm:ml-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/cohost")}
              data-testid="button-goto-cohost"
              className="text-xs sm:text-sm"
            >
              <Mic className="size-3 sm:size-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Co-Host</span>
              <span className="sm:hidden">Co-Host</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setIsUploadDialogOpen(true)}
              className="bg-[#0D6EFD] hover:bg-[#0D6EFD]/90 text-xs sm:text-sm"
              data-testid="button-new-source"
            >
              <Plus className="size-3 sm:size-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Neue Quelle</span>
              <span className="sm:hidden">Neu</span>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Laden...</div>
        ) : sources.length === 0 ? (
          <Card className="bg-secondary/50 border-border">
            <CardContent className="py-12 text-center">
              <FileText className="size-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">Noch keine Quellen vorhanden</p>
              <Button
                onClick={() => setIsUploadDialogOpen(true)}
                className="bg-[#0D6EFD] hover:bg-[#0D6EFD]/90"
                data-testid="button-upload-first"
              >
                <Upload className="size-4 mr-2" />
                Erste Quelle hochladen
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {sources.map((source) => (
              <Card key={source.id} className="bg-secondary/50 border-border" data-testid={`card-source-${source.id}`}>
                <CardContent className="py-3 sm:py-4 px-3 sm:px-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                      {getTypeIcon(source.type)}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate text-sm sm:text-base" data-testid={`text-title-${source.id}`}>
                          {source.title}
                        </h3>
                        <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                          {source.originalFilename} • {formatDate(source.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 sm:gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openViewDialog(source)}
                        data-testid={`button-view-${source.id}`}
                        className="size-7 sm:size-8"
                      >
                        <Eye className="size-3.5 sm:size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(source)}
                        data-testid={`button-edit-${source.id}`}
                        className="size-7 sm:size-8"
                      >
                        <Edit className="size-3.5 sm:size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Diese Quelle wirklich löschen?")) {
                            deleteMutation.mutate(source.id);
                          }
                        }}
                        data-testid={`button-delete-${source.id}`}
                        className="size-7 sm:size-8"
                      >
                        <Trash2 className="size-3.5 sm:size-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Neue Quelle hinzufügen</DialogTitle>
          </DialogHeader>
          <Tabs value={uploadTab} onValueChange={(v) => setUploadTab(v as "file" | "text")}>
            <TabsList className="grid w-full grid-cols-2 bg-secondary">
              <TabsTrigger value="file" data-testid="tab-file">
                <Upload className="size-4 mr-2" />
                Datei
              </TabsTrigger>
              <TabsTrigger value="text" data-testid="tab-text">
                <Type className="size-4 mr-2" />
                Text
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="space-y-4 mt-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Titel</label>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Titel der Quelle"
                  className="bg-secondary border-border"
                  data-testid="input-upload-title"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Datei (PDF, JSON, TXT, MD)</label>
                <Input
                  type="file"
                  accept=".pdf,.json,.txt,.md,.markdown,text/plain,application/json,application/pdf"
                  onChange={handleFileChange}
                  className="bg-secondary border-border"
                  data-testid="input-upload-file"
                />
              </div>
              {uploadFile && (
                <p className="text-sm text-muted-foreground">
                  Ausgewählt: {uploadFile.name}
                </p>
              )}
            </TabsContent>
            <TabsContent value="text" className="space-y-4 mt-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Titel</label>
                <Input
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Titel der Quelle"
                  className="bg-secondary border-border"
                  data-testid="input-paste-title"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Text einfügen</label>
                <Textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="Text hier einfügen..."
                  className="bg-secondary border-border min-h-[200px]"
                  data-testid="input-paste-content"
                />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUploadDialogOpen(false)}
              data-testid="button-cancel-upload"
            >
              Abbrechen
            </Button>
            {uploadTab === "file" ? (
              <Button
                onClick={handleUpload}
                disabled={!uploadFile || !uploadTitle.trim() || createMutation.isPending}
                className="bg-[#0D6EFD] hover:bg-[#0D6EFD]/90"
                data-testid="button-confirm-upload"
              >
                {createMutation.isPending ? "Wird hochgeladen..." : "Hochladen"}
              </Button>
            ) : (
              <Button
                onClick={handlePasteSubmit}
                disabled={!pasteTitle.trim() || !pasteContent.trim() || createMutation.isPending}
                className="bg-[#0D6EFD] hover:bg-[#0D6EFD]/90"
                data-testid="button-confirm-paste"
              >
                {createMutation.isPending ? "Wird gespeichert..." : "Speichern"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Quelle bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Titel</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="bg-secondary border-border"
                data-testid="input-edit-title"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Inhalt</label>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="bg-secondary border-border min-h-[300px] font-mono text-sm"
                data-testid="input-edit-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              data-testid="button-cancel-edit"
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!editTitle.trim() || updateMutation.isPending}
              className="bg-[#0D6EFD] hover:bg-[#0D6EFD]/90"
              data-testid="button-confirm-edit"
            >
              {updateMutation.isPending ? "Wird gespeichert..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedSource?.title}</DialogTitle>
          </DialogHeader>
          <div className="bg-secondary rounded p-4 overflow-auto max-h-[50vh]">
            <pre className="text-sm whitespace-pre-wrap font-mono" data-testid="text-view-content">
              {selectedSource?.textContent}
            </pre>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsViewDialogOpen(false)}
              data-testid="button-close-view"
            >
              Schliessen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
