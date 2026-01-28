import { apiUrl } from "@/lib/config";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, GripVertical, Check, X, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface QuickAction {
  id: number;
  userId: string | null;
  label: string;
  prompt: string;
  sortOrder: number;
}

interface ActionSelection {
  quickAction: QuickAction;
  isEnabled: boolean;
  sortOrder: number;
}

export default function QuickActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingAction, setEditingAction] = useState<QuickAction | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formPrompt, setFormPrompt] = useState("");

  const { data: allActions } = useQuery<{ system: QuickAction[]; user: QuickAction[] }>({
    queryKey: ["/api/quick-actions/all"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/quick-actions/all"));
      if (!res.ok) throw new Error("Failed to fetch actions");
      return res.json();
    }
  });

  const { data: selections = [] } = useQuery<ActionSelection[]>({
    queryKey: ["/api/quick-actions/selections"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/quick-actions/selections"));
      if (!res.ok) throw new Error("Failed to fetch selections");
      return res.json();
    }
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ actionId, isEnabled }: { actionId: number; isEnabled: boolean }) => {
      const res = await fetch(apiUrl(`/api/quick-actions/selections/${actionId}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled })
      });
      if (!res.ok) throw new Error("Failed to update selection");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/selections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions"] });
    }
  });

  const createMutation = useMutation({
    mutationFn: async ({ label, prompt }: { label: string; prompt: string }) => {
      const res = await fetch(apiUrl("/api/quick-actions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, prompt })
      });
      if (!res.ok) throw new Error("Failed to create action");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/selections"] });
      setIsCreating(false);
      setFormLabel("");
      setFormPrompt("");
      toast({ title: "Aktion erstellt" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, label, prompt }: { id: number; label: string; prompt: string }) => {
      const res = await fetch(apiUrl(`/api/quick-actions/${id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, prompt })
      });
      if (!res.ok) throw new Error("Failed to update action");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/selections"] });
      setEditingAction(null);
      setFormLabel("");
      setFormPrompt("");
      toast({ title: "Aktion aktualisiert" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(apiUrl(`/api/quick-actions/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete action");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/selections"] });
      toast({ title: "Aktion gelöscht" });
    }
  });

  const loadDefaultsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/quick-actions/load-defaults"), { method: "POST" });
      if (!res.ok) throw new Error("Failed to load defaults");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quick-actions/selections"] });
      toast({ title: `${data.count} Standard-Aktionen aktiviert` });
    },
    onError: () => {
      toast({ title: "Fehler beim Laden der Defaults", variant: "destructive" });
    }
  });

  const handleEdit = (action: QuickAction) => {
    setEditingAction(action);
    setFormLabel(action.label);
    setFormPrompt(action.prompt);
  };

  const handleSave = () => {
    if (!formLabel.trim() || !formPrompt.trim()) {
      toast({ title: "Label und Prompt sind erforderlich", variant: "destructive" });
      return;
    }
    if (editingAction) {
      updateMutation.mutate({ id: editingAction.id, label: formLabel, prompt: formPrompt });
    } else {
      createMutation.mutate({ label: formLabel, prompt: formPrompt });
    }
  };

  const handleCancel = () => {
    setEditingAction(null);
    setIsCreating(false);
    setFormLabel("");
    setFormPrompt("");
  };

  const isSystemAction = (action: QuickAction) => action.userId === null;
  const selectionMap = new Map(selections.map(s => [s.quickAction.id, s]));

  return (
    <div className="h-full overflow-auto bg-card text-white p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold" data-testid="text-page-title">Schnellaktionen</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Verwalte deine Quick Actions für den Co-Host
            </p>
          </div>
          <Button
            onClick={() => setIsCreating(true)}
            className="bg-cyan-600 hover:bg-cyan-700"
            data-testid="button-create-action"
          >
            <Plus className="size-4 mr-2" />
            Neue Aktion
          </Button>
        </div>

        <Card className="bg-secondary border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="size-4 text-muted-foreground" />
                System-Aktionen
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadDefaultsMutation.mutate()}
                disabled={loadDefaultsMutation.isPending}
                className="text-xs border-border hover:bg-muted"
                data-testid="button-load-defaults"
              >
                <RotateCcw className="size-3 mr-1.5" />
                {loadDefaultsMutation.isPending ? "Laden..." : "Defaults laden"}
              </Button>
            </div>
            <CardDescription className="text-muted-foreground">
              Standard-Aktionen, die für alle Benutzer verfügbar sind
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {allActions?.system.map(action => {
              const selection = selectionMap.get(action.id);
              const isEnabled = selection?.isEnabled ?? true;
              return (
                <div
                  key={action.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border"
                  data-testid={`action-system-${action.id}`}
                >
                  <GripVertical className="size-4 text-muted-foreground cursor-not-allowed" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm" data-testid={`text-action-label-${action.id}`}>
                      {action.label}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {action.prompt}
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => toggleMutation.mutate({ actionId: action.id, isEnabled: checked })}
                    data-testid={`switch-action-${action.id}`}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="bg-secondary border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Eigene Aktionen</CardTitle>
            <CardDescription className="text-muted-foreground">
              Selbst erstellte Aktionen, die du bearbeiten oder löschen kannst
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(!allActions?.user || allActions.user.length === 0) ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Noch keine eigenen Aktionen erstellt</p>
                <p className="text-sm mt-1">Klicke oben auf "Neue Aktion" um zu beginnen</p>
              </div>
            ) : (
              allActions.user.map(action => {
                const selection = selectionMap.get(action.id);
                const isEnabled = selection?.isEnabled ?? true;
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border"
                    data-testid={`action-user-${action.id}`}
                  >
                    <GripVertical className="size-4 text-muted-foreground cursor-grab" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm" data-testid={`text-action-label-${action.id}`}>
                        {action.label}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {action.prompt}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-white"
                        onClick={() => handleEdit(action)}
                        data-testid={`button-edit-${action.id}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-red-400"
                        onClick={() => deleteMutation.mutate(action.id)}
                        data-testid={`button-delete-${action.id}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => toggleMutation.mutate({ actionId: action.id, isEnabled: checked })}
                        data-testid={`switch-action-${action.id}`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isCreating || !!editingAction} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="bg-secondary border-border text-white">
          <DialogHeader>
            <DialogTitle>{editingAction ? "Aktion bearbeiten" : "Neue Aktion erstellen"}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingAction ? "Bearbeite Label und Prompt deiner Aktion" : "Erstelle eine neue Quick Action für den Co-Host"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Label (Button-Text)</label>
              <Input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="z.B. Zusammenfassen"
                className="bg-muted border-border"
                data-testid="input-action-label"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Prompt (Anweisung an KI)</label>
              <Textarea
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder="z.B. Bitte fasse zusammen, was bisher besprochen wurde."
                className="bg-muted border-border min-h-[100px]"
                data-testid="input-action-prompt"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={handleCancel} data-testid="button-cancel">
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-700"
              data-testid="button-save-action"
            >
              {createMutation.isPending || updateMutation.isPending ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
