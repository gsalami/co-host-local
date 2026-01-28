import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Radio } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
      <div className="text-center space-y-8">
        <div className="flex items-center justify-center gap-3">
          <Radio className="size-10 text-primary" />
          <h1 className="text-4xl font-bold text-white">Podcast Co-Host</h1>
        </div>
        <p className="text-muted-foreground text-lg">Dein AI-Podcast-Assistent</p>
        <Link href="/login">
          <Button size="lg" className="text-lg px-8 py-6">
            Login
          </Button>
        </Link>
      </div>
    </div>
  );
}
