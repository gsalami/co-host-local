import { apiUrl } from "@/lib/config";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Mic, FileText, Clock, Calendar, Radio, Search, ChevronDown, Check, MicOff, Volume2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Show {
  id: number;
  title: string;
  createdAt: string;
}

interface UsageStats {
  transcriptSeconds: number;
  voiceSeconds: number;
  voiceInSeconds: number;
  voiceOutSeconds: number;
}

interface DailyUsage {
  date: string;
  transcriptSeconds: number;
  voiceSeconds: number;
  voiceInSeconds: number;
  voiceOutSeconds: number;
}

interface ShowUsage {
  showId: number | null;
  showTitle: string | null;
  transcriptSeconds: number;
  voiceSeconds: number;
  voiceInSeconds: number;
  voiceOutSeconds: number;
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

export default function UsageDashboard() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [dailyData, setDailyData] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");
  const [shows, setShows] = useState<Show[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<string>("all");
  const [showSearch, setShowSearch] = useState("");
  const [showSelectorOpen, setShowSelectorOpen] = useState(false);
  const [showUsage, setShowUsage] = useState<ShowUsage[]>([]);

  useEffect(() => {
    fetch(apiUrl("/api/shows"))
      .then(res => res.json())
      .then(setShows)
      .catch(console.error);
  }, []);

  const fetchStats = async () => {
    try {
      const showParam = selectedShowId !== "all" ? `&showId=${selectedShowId}` : "";
      const [statsRes, dailyRes, showUsageRes] = await Promise.all([
        fetch(apiUrl(`/api/usage/stats?${showParam.replace("&", "")}`)),
        fetch(apiUrl(`/api/usage/daily?days=${days}${showParam}`)),
        fetch(apiUrl(`/api/usage/by-show?days=${days}`))
      ]);
      
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (dailyRes.ok) {
        setDailyData(await dailyRes.json());
      }
      if (showUsageRes.ok) {
        setShowUsage(await showUsageRes.json());
      }
    } catch (error) {
      console.error("Error fetching usage data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [days, selectedShowId]);

  const chartData = dailyData.map(d => ({
    date: new Date(d.date).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }),
    Transcript: Math.round(d.transcriptSeconds / 60 * 10) / 10,
    Voice: Math.round(d.voiceSeconds / 60 * 10) / 10
  }));

  const totalSeconds = (stats?.transcriptSeconds || 0) + (stats?.voiceSeconds || 0);

  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white" data-testid="text-dashboard-title">Nutzungs-Dashboard</h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-1">Übersicht über Ihre Transcript- und Voice-Nutzung</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <Popover open={showSelectorOpen} onOpenChange={setShowSelectorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-64 justify-between bg-muted border-border text-xs sm:text-sm" data-testid="button-show-selector">
                  <div className="flex items-center gap-2 truncate">
                    <Radio className="h-3 w-3 sm:h-4 sm:w-4 text-primary shrink-0" />
                    <span className="truncate">
                      {selectedShowId === "all" 
                        ? "Alle Sendungen" 
                        : shows.find(s => String(s.id) === selectedShowId)?.title || "Sendung wählen"}
                    </span>
                  </div>
                  <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Sendung suchen..."
                      value={showSearch}
                      onChange={(e) => setShowSearch(e.target.value)}
                      className="pl-8 bg-secondary border-border"
                      data-testid="input-show-search"
                    />
                  </div>
                </div>
                <ScrollArea className="h-64">
                  <div className="p-1">
                    <button
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md hover:bg-muted ${selectedShowId === "all" ? "bg-muted" : ""}`}
                      onClick={() => { setSelectedShowId("all"); setShowSelectorOpen(false); setShowSearch(""); }}
                      data-testid="option-all-shows"
                    >
                      <span>Alle Sendungen</span>
                      {selectedShowId === "all" && <Check className="h-4 w-4 text-primary" />}
                    </button>
                    {shows
                      .filter(show => show.title.toLowerCase().includes(showSearch.toLowerCase()))
                      .map(show => (
                        <button
                          key={show.id}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md hover:bg-muted ${selectedShowId === String(show.id) ? "bg-muted" : ""}`}
                          onClick={() => { setSelectedShowId(String(show.id)); setShowSelectorOpen(false); setShowSearch(""); }}
                          data-testid={`option-show-${show.id}`}
                        >
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="truncate">{show.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(show.createdAt).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </span>
                          </div>
                          {selectedShowId === String(show.id) && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <span className="text-sm text-muted-foreground">{user?.firstName || user?.email}</span>
            <Button variant="outline" size="sm" onClick={() => logout()} data-testid="button-logout">
              Abmelden
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card className="bg-secondary/50 border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Transcript</CardTitle>
              <FileText className="h-3 w-3 sm:h-4 sm:w-4 text-accent" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-transcript-seconds">
                {loading ? "..." : formatSeconds(stats?.transcriptSeconds || 0)}
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">Deepgram Transkription</p>
            </CardContent>
          </Card>

          <Card className="bg-secondary/50 border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Voice</CardTitle>
              <Mic className="h-3 w-3 sm:h-4 sm:w-4 text-purple-400" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-voice-seconds">
                {loading ? "..." : formatSeconds(stats?.voiceSeconds || 0)}
              </div>
              <div className="hidden sm:flex items-center gap-4 mt-2 text-xs">
                <div className="flex items-center gap-1">
                  <Mic className="h-3 w-3 text-success" />
                  <span className="text-muted-foreground">In:</span>
                  <span className="text-white font-medium" data-testid="text-voice-in-seconds">
                    {loading ? "..." : formatSeconds(stats?.voiceInSeconds || 0)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Volume2 className="h-3 w-3 text-primary" />
                  <span className="text-muted-foreground">Out:</span>
                  <span className="text-white font-medium" data-testid="text-voice-out-seconds">
                    {loading ? "..." : formatSeconds(stats?.voiceOutSeconds || 0)}
                  </span>
                </div>
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">Gemini Co-Host</p>
            </CardContent>
          </Card>

          <Card className="bg-secondary/50 border-border col-span-2 sm:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Gesamt</CardTitle>
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-success" />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-lg sm:text-2xl font-bold text-white" data-testid="text-total-seconds">
                {loading ? "..." : formatSeconds(totalSeconds)}
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">Alle Dienste kombiniert</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-secondary/50 border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-white">Nutzung pro Tag</CardTitle>
            </div>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-32 bg-muted border-border" data-testid="select-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Heute</SelectItem>
                <SelectItem value="7">7 Tage</SelectItem>
                <SelectItem value="14">14 Tage</SelectItem>
                <SelectItem value="30">30 Tage</SelectItem>
                <SelectItem value="90">90 Tage</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">Laden...</div>
            ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Keine Nutzungsdaten vorhanden
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1e293b', 
                      border: '1px solid #475569',
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Legend />
                  <Bar dataKey="Transcript" fill="#22d3ee" name="Transcript (Min)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Voice" fill="#a855f7" name="Voice (Min)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Usage by Show Table */}
        <Card className="bg-secondary/50 border-border mt-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-white">Nutzung pro Sendung</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">Laden...</div>
            ) : showUsage.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                Keine Nutzungsdaten vorhanden
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-show-usage">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Sendung</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium">Transcript</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium">Voice</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium">Gesamt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {showUsage
                      .sort((a, b) => (b.transcriptSeconds + b.voiceSeconds) - (a.transcriptSeconds + a.voiceSeconds))
                      .map((item, index) => (
                        <tr key={item.showId ?? 'none'} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-3 px-4 text-white">
                            {item.showTitle || <span className="text-muted-foreground italic">Ohne Sendung</span>}
                          </td>
                          <td className="py-3 px-4 text-right text-accent font-mono">
                            {formatSeconds(item.transcriptSeconds)}
                          </td>
                          <td className="py-3 px-4 text-right text-purple-400 font-mono">
                            {formatSeconds(item.voiceSeconds)}
                          </td>
                          <td className="py-3 px-4 text-right text-white font-mono font-medium">
                            {formatSeconds(item.transcriptSeconds + item.voiceSeconds)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
