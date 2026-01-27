import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2 } from "lucide-react";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    
    if (!sessionId) {
      setStatus("error");
      setMessage("Keine Session-ID gefunden");
      return;
    }

    fetch(`/api/checkout/success?session_id=${sessionId}`)
      .then(r => {
        if (r.status === 401) {
          // User needs to re-authenticate - redirect to login then back here
          window.location.href = `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (data.status === "success" || data.status === "already_processed") {
          setStatus("success");
          setMessage("Ihre Credits wurden erfolgreich hinzugefügt!");
        } else if (data.status === "pending") {
          setMessage("Zahlung wird noch verarbeitet...");
          setTimeout(() => window.location.reload(), 3000);
        } else {
          setStatus("error");
          setMessage(data.error || "Ein Fehler ist aufgetreten");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Fehler beim Verarbeiten der Zahlung");
      });
  }, []);

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-6">
      <Card className="bg-slate-800/50 border-slate-700 max-w-md w-full">
        <CardHeader className="text-center">
          {status === "loading" && (
            <Loader2 className="h-16 w-16 text-blue-400 animate-spin mx-auto mb-4" />
          )}
          {status === "success" && (
            <CheckCircle className="h-16 w-16 text-green-400 mx-auto mb-4" />
          )}
          <CardTitle className="text-white text-xl">
            {status === "loading" && "Verarbeitung..."}
            {status === "success" && "Zahlung erfolgreich!"}
            {status === "error" && "Fehler"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-slate-300">{message}</p>
          {status !== "loading" && (
            <Button 
              onClick={() => navigate("/credits")}
              data-testid="button-back-to-credits"
            >
              Zurück zu Credits
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
