import { useState, useEffect, useCallback } from "react";

export interface CreditStatus {
  transcriptSeconds: number;
  voiceSeconds: number;
  transcriptStatus: "ok" | "low" | "depleted";
  voiceStatus: "ok" | "low" | "depleted";
  canTranscribe: boolean;
  canUseVoice: boolean;
}

export function useCredits() {
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/credits/check");
      if (response.ok) {
        const data = await response.json();
        setCredits(data);
        setError(null);
      } else {
        setError("Failed to fetch credits");
      }
    } catch (e) {
      setError("Failed to fetch credits");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const formatMinutes = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      return `${hours}h ${remainingMins}m`;
    }
    return `${minutes}m`;
  };

  return { 
    credits, 
    loading, 
    error, 
    refresh,
    formatMinutes,
    hasLowCredits: credits ? (credits.transcriptStatus !== "ok" || credits.voiceStatus !== "ok") : false,
    hasCriticalCredits: credits ? (credits.transcriptStatus === "depleted" || credits.voiceStatus === "depleted") : false
  };
}
