import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function CheckoutCancel() {
  const [, navigate] = useLocation();

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-6">
      <Card className="bg-slate-800/50 border-slate-700 max-w-md w-full">
        <CardHeader className="text-center">
          <XCircle className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <CardTitle className="text-white text-xl">Zahlung abgebrochen</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-slate-300">
            Der Kauf wurde abgebrochen. Es wurden keine Kosten erhoben.
          </p>
          <Button 
            onClick={() => navigate("/credits")}
            data-testid="button-back-to-credits"
          >
            Zurück zu Credits
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
