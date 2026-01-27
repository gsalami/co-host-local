import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { CreditCard, Mic, FileText, Clock, Package, Check, ArrowRight, Zap } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Credits {
  userId: string;
  transcriptSeconds: number;
  voiceSeconds: number;
  updatedAt: string;
}

interface CreditPackage {
  id: string;
  name: string;
  description: string | null;
  priceChf: number;
  transcriptMinutes: number;
  voiceMinutes: number;
  packageId: string;
}

interface Purchase {
  id: number;
  createdAt: string;
  packageName: string;
  amountChf: number;
  transcriptSecondsAdded: number;
  voiceSecondsAdded: number;
  status: string;
}

function formatMinutes(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSecondsDetailed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const packageColors: Record<string, { bg: string; border: string; highlight: string }> = {
  "teaser": { bg: "from-slate-700 to-slate-800", border: "border-slate-600", highlight: "text-slate-300" },
  "episode": { bg: "from-blue-800 to-blue-900", border: "border-blue-500", highlight: "text-blue-300" },
  "staffel": { bg: "from-purple-800 to-purple-900", border: "border-purple-500", highlight: "text-purple-300" },
  "produzent": { bg: "from-amber-700 to-amber-900", border: "border-amber-500", highlight: "text-amber-300" },
  "podcast-imperium": { bg: "from-rose-700 to-rose-900", border: "border-rose-400", highlight: "text-rose-300" },
};

export default function Credits() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<Credits | null>(null);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/credits").then(r => r.json()),
      fetch("/api/credits/packages").then(r => r.json()),
      fetch("/api/credits/purchases").then(r => r.json())
    ])
      .then(([creditsData, packagesData, purchasesData]) => {
        setCredits(creditsData);
        setPackages(packagesData);
        setPurchases(purchasesData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePurchase = async (priceId: string) => {
    setPurchasing(priceId);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({
          title: "Fehler",
          description: data.error || "Checkout konnte nicht gestartet werden",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Checkout error:", error);
      toast({
        title: "Fehler",
        description: "Checkout konnte nicht gestartet werden",
        variant: "destructive"
      });
    } finally {
      setPurchasing(null);
    }
  };

  const totalTranscript = credits?.transcriptSeconds || 0;
  const totalVoice = credits?.voiceSeconds || 0;
  const maxCredits = 12000 * 60;
  const transcriptPercent = Math.min((totalTranscript / maxCredits) * 100, 100);
  const voicePercent = Math.min((totalVoice / maxCredits) * 100, 100);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="text-white">Laden...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-white" data-testid="text-credits-title">Guthaben</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Verwalten Sie Ihre Transkriptions- und Voice-Credits</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-400" />
                Transkription
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-3" data-testid="text-transcript-credits">
                {formatMinutes(totalTranscript)}
              </div>
              <Progress value={transcriptPercent} className="h-2" />
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white flex items-center gap-2">
                <Mic className="h-5 w-5 text-purple-400" />
                Voice (Co-Host)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-3" data-testid="text-voice-credits">
                {formatMinutes(totalVoice)}
              </div>
              <Progress value={voicePercent} className="h-2" />
            </CardContent>
          </Card>
        </div>

        <div className="mb-6 sm:mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4 flex items-center gap-2">
            <Package className="h-5 w-5" />
            Credits kaufen
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
            {packages.map((pkg) => {
              const colors = packageColors[pkg.packageId] || packageColors["teaser"];
              const isPopular = pkg.packageId === "staffel";
              
              return (
                <Card 
                  key={pkg.id} 
                  className={`relative bg-gradient-to-b ${colors.bg} ${colors.border} border-2 transition-transform hover:scale-105`}
                  data-testid={`card-package-${pkg.packageId}`}
                >
                  {isPopular && (
                    <div className="absolute -top-2 sm:-top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[10px] sm:text-xs px-2 sm:px-3 py-0.5 sm:py-1 rounded-full font-medium flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> Beliebt
                    </div>
                  )}
                  <CardHeader className="pb-1 sm:pb-2 pt-3 sm:pt-4 px-3 sm:px-6">
                    <CardTitle className={`text-sm sm:text-lg ${colors.highlight}`}>
                      {pkg.name}
                    </CardTitle>
                    <CardDescription className="text-slate-400 text-xs sm:text-sm line-clamp-2">
                      {pkg.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 sm:space-y-4 px-3 sm:px-6 pb-3 sm:pb-6">
                    <div className="text-xl sm:text-3xl font-bold text-white">
                      CHF {pkg.priceChf}
                    </div>
                    
                    <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm">
                      <div className="flex items-center gap-1.5 sm:gap-2 text-slate-300">
                        <Check className="h-3 w-3 sm:h-4 sm:w-4 text-green-400 shrink-0" />
                        <span className="truncate">{pkg.transcriptMinutes} Min Transkription</span>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 text-slate-300">
                        <Check className="h-3 w-3 sm:h-4 sm:w-4 text-green-400 shrink-0" />
                        <span className="truncate">{pkg.voiceMinutes} Min Voice</span>
                      </div>
                    </div>

                    <Button 
                      className="w-full text-xs sm:text-sm h-8 sm:h-10"
                      onClick={() => handlePurchase(pkg.id)}
                      disabled={purchasing === pkg.id}
                      data-testid={`button-buy-${pkg.packageId}`}
                    >
                      {purchasing === pkg.id ? (
                        "..."
                      ) : (
                        <>
                          Kaufen <ArrowRight className="ml-1 sm:ml-2 h-3 w-3 sm:h-4 sm:w-4" />
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {purchases.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Kaufhistorie
            </h2>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-0">
                <table className="w-full">
                  <thead className="border-b border-slate-700">
                    <tr className="text-left text-slate-400 text-sm">
                      <th className="p-4">Datum</th>
                      <th className="p-4">Paket</th>
                      <th className="p-4">Betrag</th>
                      <th className="p-4">Credits</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((purchase) => (
                      <tr key={purchase.id} className="border-b border-slate-700/50 last:border-0" data-testid={`row-purchase-${purchase.id}`}>
                        <td className="p-4 text-slate-300">
                          {new Date(purchase.createdAt).toLocaleDateString("de-CH")}
                        </td>
                        <td className="p-4 text-white capitalize">{purchase.packageName}</td>
                        <td className="p-4 text-white">CHF {(purchase.amountChf / 100).toFixed(2)}</td>
                        <td className="p-4 text-slate-300">
                          {Math.round(purchase.transcriptSecondsAdded / 60)}m + {Math.round(purchase.voiceSecondsAdded / 60)}m
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            purchase.status === "completed" 
                              ? "bg-green-500/20 text-green-400" 
                              : purchase.status === "refunded"
                              ? "bg-red-500/20 text-red-400"
                              : purchase.status === "cancelled"
                              ? "bg-slate-500/20 text-slate-400"
                              : "bg-yellow-500/20 text-yellow-400"
                          }`}>
                            {purchase.status === "completed" ? "Abgeschlossen" 
                              : purchase.status === "refunded" ? "Erstattet"
                              : purchase.status === "cancelled" ? "Storniert"
                              : "Ausstehend"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
