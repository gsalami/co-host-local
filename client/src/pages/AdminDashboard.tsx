import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, Mic, Clock, Shield, ShieldCheck, RefreshCw, CreditCard, Plus, ShoppingCart } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  createdAt: string | null;
}

interface UserUsage {
  userId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  transcriptSeconds: number;
  voiceSeconds: number;
}

interface UserCredits {
  userId: string;
  transcriptSeconds: number;
  voiceSeconds: number;
}

interface CreditPurchase {
  id: number;
  userId: string;
  packageName: string;
  amountChf: number;
  transcriptSecondsAdded: number;
  voiceSecondsAdded: number;
  status: string;
  stripeSessionId: string;
  createdAt: string;
}

function formatSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds} Sek`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [userUsage, setUserUsage] = useState<UserUsage[]>([]);
  const [userCreditsMap, setUserCreditsMap] = useState<Record<string, UserCredits>>({});
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [syncingStripe, setSyncingStripe] = useState(false);
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [processingPurchase, setProcessingPurchase] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addTranscriptMinutes, setAddTranscriptMinutes] = useState("");
  const [addVoiceMinutes, setAddVoiceMinutes] = useState("");
  const [addingCredits, setAddingCredits] = useState(false);
  const [purchases, setPurchases] = useState<CreditPurchase[]>([]);
  const [updatingPurchaseId, setUpdatingPurchaseId] = useState<number | null>(null);

  const refreshData = async () => {
    try {
      const [usageRes, creditsRes, purchasesRes] = await Promise.all([
        fetch("/api/admin/usage/by-user"),
        fetch("/api/admin/credits/by-user"),
        fetch("/api/admin/purchases")
      ]);
      if (usageRes.ok) {
        setUserUsage(await usageRes.json());
      }
      if (creditsRes.ok) {
        const creditsData: UserCredits[] = await creditsRes.json();
        const creditsMap: Record<string, UserCredits> = {};
        creditsData.forEach(c => { creditsMap[c.userId] = c; });
        setUserCreditsMap(creditsMap);
      }
      if (purchasesRes.ok) {
        setPurchases(await purchasesRes.json());
      }
    } catch (error) {
      console.error("Error refreshing data:", error);
    }
  };

  const handlePurchaseStatusChange = async (purchaseId: number, newStatus: string) => {
    setUpdatingPurchaseId(purchaseId);
    try {
      const res = await fetch(`/api/admin/purchases/${purchaseId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const { purchase, userCredits } = await res.json();
        setPurchases(purchases.map(p => p.id === purchaseId ? purchase : p));
        
        // Update credits map if userCredits returned
        if (userCredits) {
          setUserCreditsMap(prev => ({ ...prev, [userCredits.userId]: userCredits }));
        }
        
        const creditNote = (newStatus === 'refunded' || newStatus === 'cancelled') 
          ? ' Credits wurden abgezogen.' 
          : (newStatus === 'completed' ? ' Credits wurden gutgeschrieben.' : '');
        
        toast({
          title: "Status aktualisiert",
          description: `Kauf #${purchaseId} ist jetzt "${newStatus}".${creditNote}`
        });
      } else {
        const data = await res.json();
        toast({
          title: "Fehler",
          description: data.error || "Status konnte nicht aktualisiert werden.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error updating purchase status:", error);
      toast({
        title: "Fehler",
        description: "Status konnte nicht aktualisiert werden.",
        variant: "destructive"
      });
    } finally {
      setUpdatingPurchaseId(null);
    }
  };

  const handleAddCredits = async () => {
    if (!selectedUserId) {
      toast({ title: "Fehler", description: "Benutzer auswählen", variant: "destructive" });
      return;
    }
    const transcriptMin = parseInt(addTranscriptMinutes) || 0;
    const voiceMin = parseInt(addVoiceMinutes) || 0;
    if (transcriptMin <= 0 && voiceMin <= 0) {
      toast({ title: "Fehler", description: "Mindestens ein Wert muss positiv sein", variant: "destructive" });
      return;
    }
    setAddingCredits(true);
    try {
      const res = await fetch("/api/admin/add-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId: selectedUserId, 
          transcriptMinutes: transcriptMin, 
          voiceMinutes: voiceMin,
          reason: "Manual admin credit addition"
        })
      });
      const data = await res.json();
      if (res.ok) {
        const selectedUser = users.find(u => u.id === selectedUserId);
        toast({ 
          title: "Credits hinzugefügt", 
          description: `+${transcriptMin} Min Transcript, +${voiceMin} Min Voice für ${selectedUser?.email || selectedUserId}` 
        });
        setAddTranscriptMinutes("");
        setAddVoiceMinutes("");
        setSelectedUserId("");
        // Refresh usage data to show updated totals
        refreshData();
      } else {
        toast({ title: "Fehler", description: data.error || "Credits konnten nicht hinzugefügt werden", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Fehler", description: "Credits konnten nicht hinzugefügt werden", variant: "destructive" });
    } finally {
      setAddingCredits(false);
    }
  };

  const handleProcessPurchase = async () => {
    if (!sessionIdInput.trim()) {
      toast({ title: "Fehler", description: "Session-ID erforderlich", variant: "destructive" });
      return;
    }
    setProcessingPurchase(true);
    try {
      const res = await fetch("/api/admin/process-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdInput.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Erfolg", description: `Credits hinzugefügt: ${data.packageId}` });
        setSessionIdInput("");
      } else {
        toast({ title: "Fehler", description: data.error || "Verarbeitung fehlgeschlagen", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Fehler", description: "Verarbeitung fehlgeschlagen", variant: "destructive" });
    } finally {
      setProcessingPurchase(false);
    }
  };

  useEffect(() => {
    fetch("/api/admin/check")
      .then(res => res.json())
      .then(data => {
        setIsAdmin(data.isAdmin);
        setCheckingAdmin(false);
      })
      .catch(() => setCheckingAdmin(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    
    const fetchData = async () => {
      try {
        const [usersRes, usageRes, creditsRes, purchasesRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/admin/usage/by-user"),
          fetch("/api/admin/credits/by-user"),
          fetch("/api/admin/purchases")
        ]);
        
        if (usersRes.ok) {
          setUsers(await usersRes.json());
        }
        if (usageRes.ok) {
          setUserUsage(await usageRes.json());
        }
        if (creditsRes.ok) {
          const creditsData: UserCredits[] = await creditsRes.json();
          const creditsMap: Record<string, UserCredits> = {};
          creditsData.forEach(c => { creditsMap[c.userId] = c; });
          setUserCreditsMap(creditsMap);
        }
        if (purchasesRes.ok) {
          setPurchases(await purchasesRes.json());
        }
      } catch (error) {
        console.error("Error fetching admin data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAdmin]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole })
      });
      
      if (res.ok) {
        const updatedUser = await res.json();
        setUsers(users.map(u => u.id === userId ? { ...u, role: updatedUser.role } : u));
        toast({
          title: "Rolle aktualisiert",
          description: `Benutzer ist jetzt ${newRole === 'admin' ? 'Administrator' : 'Benutzer'}.`
        });
      } else {
        toast({
          title: "Fehler",
          description: "Rolle konnte nicht aktualisiert werden.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error updating role:", error);
      toast({
        title: "Fehler",
        description: "Rolle konnte nicht aktualisiert werden.",
        variant: "destructive"
      });
    }
  };

  const handleStripeSync = async () => {
    setSyncingStripe(true);
    try {
      const res = await fetch("/api/admin/stripe/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Stripe synchronisiert",
          description: `${data.productsCount} aktive Produkte gefunden.`
        });
      } else {
        toast({
          title: "Fehler",
          description: data.details || data.error || "Stripe konnte nicht synchronisiert werden.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error syncing Stripe:", error);
      toast({
        title: "Fehler",
        description: "Stripe konnte nicht synchronisiert werden.",
        variant: "destructive"
      });
    } finally {
      setSyncingStripe(false);
    }
  };

  const getUserUsage = (userId: string) => {
    return userUsage.find(u => u.userId === userId) || { transcriptSeconds: 0, voiceSeconds: 0 };
  };

  const getUserEmail = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user?.email || user?.firstName || userId.substring(0, 8) + "...";
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'completed': return 'default';
      case 'pending': return 'secondary';
      case 'cancelled': return 'outline';
      case 'refunded': return 'destructive';
      default: return 'secondary';
    }
  };

  const totalTranscriptSeconds = userUsage.reduce((sum, u) => sum + u.transcriptSeconds, 0);
  const totalVoiceSeconds = userUsage.reduce((sum, u) => sum + u.voiceSeconds, 0);
  const totalSeconds = totalTranscriptSeconds + totalVoiceSeconds;

  if (checkingAdmin) {
    return (
      <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="p-4 sm:p-6 max-w-6xl mx-auto flex items-center justify-center h-full">
          <div className="text-white text-base sm:text-lg">Laden...</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="p-4 sm:p-6 max-w-6xl mx-auto flex flex-col items-center justify-center h-full gap-4">
          <Shield className="h-12 w-12 sm:h-16 sm:w-16 text-red-400" />
          <h1 className="text-xl sm:text-2xl font-bold text-white">Zugriff verweigert</h1>
          <p className="text-slate-400 text-sm sm:text-base">Sie haben keine Administratorrechte.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6 text-green-400" />
              <h1 className="text-xl sm:text-2xl font-bold text-white" data-testid="text-admin-title">Admin-Dashboard</h1>
            </div>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Benutzer und Nutzung verwalten</p>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleStripeSync}
              disabled={syncingStripe}
              data-testid="button-sync-stripe"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncingStripe ? 'animate-spin' : ''}`} />
              {syncingStripe ? 'Sync...' : 'Stripe Sync'}
            </Button>
            <span className="text-sm text-slate-400">{user?.firstName || user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => logout()} data-testid="button-logout">
              Abmelden
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-slate-400">Benutzer</CardTitle>
              <Users className="h-3 w-3 sm:h-4 sm:w-4 text-blue-400" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-user-count">
                {loading ? "..." : users.length}
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-1 hidden sm:block">Registrierte Benutzer</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-slate-400">Transcript</CardTitle>
              <FileText className="h-3 w-3 sm:h-4 sm:w-4 text-cyan-400" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-total-transcript">
                {loading ? "..." : formatSeconds(totalTranscriptSeconds)}
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-1 hidden sm:block">Transkription</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-slate-400">Voice</CardTitle>
              <Mic className="h-3 w-3 sm:h-4 sm:w-4 text-purple-400" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-total-voice">
                {loading ? "..." : formatSeconds(totalVoiceSeconds)}
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-1 hidden sm:block">Co-Host</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-slate-400">Gesamt</CardTitle>
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-green-400" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-total-usage">
                {loading ? "..." : formatSeconds(totalSeconds)}
              </div>
              <p className="text-[10px] sm:text-xs text-slate-500 mt-1 hidden sm:block">Alle Dienste</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-800/50 border-slate-700 mb-4 sm:mb-6">
          <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
            <div className="flex items-center gap-2">
              <Plus className="h-3 w-3 sm:h-4 sm:w-4 text-green-400" />
              <CardTitle className="text-white text-sm sm:text-base">Credits manuell hinzufügen</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white" data-testid="select-add-credits-user">
                  <SelectValue placeholder="Benutzer wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName && u.lastName 
                        ? `${u.firstName} ${u.lastName}` 
                        : u.email || u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Transcript Min"
                value={addTranscriptMinutes}
                onChange={(e) => setAddTranscriptMinutes(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                data-testid="input-add-transcript-minutes"
              />
              <Input
                type="number"
                placeholder="Voice Min"
                value={addVoiceMinutes}
                onChange={(e) => setAddVoiceMinutes(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                data-testid="input-add-voice-minutes"
              />
              <Button
                onClick={handleAddCredits}
                disabled={addingCredits || !selectedUserId}
                data-testid="button-add-credits"
              >
                {addingCredits ? "..." : "Hinzufügen"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-4 sm:mb-6">
          <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-3 w-3 sm:h-4 sm:w-4 text-amber-400" />
              <CardTitle className="text-white text-sm sm:text-base">Ausstehenden Kauf verarbeiten</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Stripe Session-ID (cs_live_...)"
                value={sessionIdInput}
                onChange={(e) => setSessionIdInput(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white flex-1"
                data-testid="input-session-id"
              />
              <Button
                onClick={handleProcessPurchase}
                disabled={processingPurchase || !sessionIdInput.trim()}
                data-testid="button-process-purchase"
              >
                {processingPurchase ? "Verarbeite..." : "Verarbeiten"}
              </Button>
            </div>
            <p className="text-slate-500 text-xs mt-2">Session-ID aus Stripe Dashboard oder credit_purchases Tabelle</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 mb-4 sm:mb-6">
          <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-3 w-3 sm:h-4 sm:w-4 text-blue-400" />
              <CardTitle className="text-white text-sm sm:text-base">Käufe verwalten</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-0 sm:px-6 pb-3 sm:pb-6">
            {purchases.length === 0 ? (
              <div className="h-24 flex items-center justify-center text-slate-400 text-sm">
                Keine Käufe vorhanden
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-400 whitespace-nowrap">Datum</TableHead>
                      <TableHead className="text-slate-400 hidden sm:table-cell">Benutzer</TableHead>
                      <TableHead className="text-slate-400 whitespace-nowrap">Paket</TableHead>
                      <TableHead className="text-slate-400 text-right whitespace-nowrap hidden sm:table-cell">Preis</TableHead>
                      <TableHead className="text-slate-400 whitespace-nowrap">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map(p => (
                      <TableRow key={p.id} className="border-slate-700" data-testid={`row-purchase-${p.id}`}>
                        <TableCell className="text-slate-300 whitespace-nowrap">
                          {new Date(p.createdAt).toLocaleDateString("de-CH", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit"
                          })}
                        </TableCell>
                        <TableCell className="text-slate-300 hidden sm:table-cell">{getUserEmail(p.userId)}</TableCell>
                        <TableCell className="text-white font-medium">{p.packageName}</TableCell>
                        <TableCell className="text-right text-green-400 hidden sm:table-cell">CHF {(p.amountChf / 100).toFixed(0)}</TableCell>
                        <TableCell>
                          <Select
                            value={p.status}
                            onValueChange={(value) => handlePurchaseStatusChange(p.id, value)}
                            disabled={updatingPurchaseId === p.id}
                          >
                            <SelectTrigger 
                              className="w-24 sm:w-32 h-7 sm:h-8 bg-slate-700 border-slate-600 text-xs sm:text-sm" 
                              data-testid={`select-purchase-status-${p.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">
                                <Badge variant="secondary" className="text-xs">Pending</Badge>
                              </SelectItem>
                              <SelectItem value="completed">
                                <Badge variant="default" className="text-xs">Completed</Badge>
                              </SelectItem>
                              <SelectItem value="cancelled">
                                <Badge variant="outline" className="text-xs">Cancelled</Badge>
                              </SelectItem>
                              <SelectItem value="refunded">
                                <Badge variant="destructive" className="text-xs">Refunded</Badge>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
            <div className="flex items-center gap-2">
              <Users className="h-3 w-3 sm:h-4 sm:w-4 text-slate-400" />
              <CardTitle className="text-white text-sm sm:text-base">Benutzer-Übersicht</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-0 sm:px-6 pb-3 sm:pb-6">
            {loading ? (
              <div className="h-40 sm:h-64 flex items-center justify-center text-slate-400 text-sm">Laden...</div>
            ) : users.length === 0 ? (
              <div className="h-40 sm:h-64 flex items-center justify-center text-slate-400 text-sm">
                Keine Benutzer vorhanden
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table className="text-xs sm:text-sm">
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-400 whitespace-nowrap">Benutzer</TableHead>
                    <TableHead className="text-slate-400 hidden md:table-cell">E-Mail</TableHead>
                    <TableHead className="text-slate-400 whitespace-nowrap">Rolle</TableHead>
                    <TableHead className="text-slate-400 text-right whitespace-nowrap">Credits T</TableHead>
                    <TableHead className="text-slate-400 text-right whitespace-nowrap">Credits V</TableHead>
                    <TableHead className="text-slate-400 text-right whitespace-nowrap hidden sm:table-cell">Nutzung T</TableHead>
                    <TableHead className="text-slate-400 text-right whitespace-nowrap hidden sm:table-cell">Nutzung V</TableHead>
                    <TableHead className="text-slate-400 hidden lg:table-cell">Registriert</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => {
                    const usage = getUserUsage(u.id);
                    const credits = userCreditsMap[u.id];
                    return (
                      <TableRow key={u.id} className="border-slate-700" data-testid={`row-user-${u.id}`}>
                        <TableCell className="text-white font-medium whitespace-nowrap">
                          {u.firstName && u.lastName 
                            ? `${u.firstName} ${u.lastName}` 
                            : u.firstName || u.email?.split("@")[0] || "Unbekannt"}
                        </TableCell>
                        <TableCell className="text-slate-300 hidden md:table-cell">{u.email || "-"}</TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(value) => handleRoleChange(u.id, value)}
                          >
                            <SelectTrigger className="w-20 sm:w-28 h-7 sm:h-8 bg-slate-700 border-slate-600 text-xs sm:text-sm" data-testid={`select-role-${u.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">
                                <div className="flex items-center gap-1 sm:gap-2">
                                  <Users className="h-3 w-3" />
                                  <span className="hidden sm:inline">Benutzer</span>
                                  <span className="sm:hidden">User</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="admin">
                                <div className="flex items-center gap-1 sm:gap-2">
                                  <ShieldCheck className="h-3 w-3" />
                                  Admin
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right text-green-400 whitespace-nowrap">{credits ? formatSeconds(credits.transcriptSeconds) : "-"}</TableCell>
                        <TableCell className="text-right text-green-400 whitespace-nowrap">{credits ? formatSeconds(credits.voiceSeconds) : "-"}</TableCell>
                        <TableCell className="text-right text-cyan-400 whitespace-nowrap hidden sm:table-cell">{formatSeconds(usage.transcriptSeconds)}</TableCell>
                        <TableCell className="text-right text-purple-400 whitespace-nowrap hidden sm:table-cell">{formatSeconds(usage.voiceSeconds)}</TableCell>
                        <TableCell className="text-slate-400 hidden lg:table-cell whitespace-nowrap">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString("de-CH", { 
                            day: "2-digit", 
                            month: "2-digit", 
                            year: "numeric" 
                          }) : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
