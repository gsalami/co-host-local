import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useCredits } from "@/hooks/use-credits";
import NotFound from "@/pages/not-found";
import VoiceAgent from "@/pages/VoiceAgent";
import CoHost from "@/pages/CoHost";
import Sources from "@/pages/Sources";
import Shows from "@/pages/Shows";
import UsageDashboard from "@/pages/UsageDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import Credits from "@/pages/Credits";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import CheckoutCancel from "@/pages/CheckoutCancel";
import QuickActions from "@/pages/QuickActions";
import Help from "@/pages/Help";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import kubleLogo from "./assets/kuble-logo.png";
import { Radio, Mic, FileText, BarChart2, List, ShieldCheck, Wallet, AlertTriangle, Menu, HelpCircle } from "lucide-react";
import { useState, useEffect } from "react";

function Header() {
  const [location, setLocation] = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { credits, formatMinutes, hasLowCredits, hasCriticalCredits } = useCredits();
  
  useEffect(() => {
    fetch("/api/admin/check")
      .then(res => res.json())
      .then(data => setIsAdmin(data.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);
  
  const navItems = [
    { path: "/", label: "Aufnahme", icon: Radio },
    { path: "/cohost", label: "Co-Host", icon: Mic },
    { path: "/sources", label: "Quellen", icon: FileText },
    { path: "/shows", label: "Sendungen", icon: List },
    { path: "/usage", label: "Nutzung", icon: BarChart2 },
  ];

  const handleNavClick = (path: string) => {
    setLocation(path);
    setMobileMenuOpen(false);
  };
  
  return (
    <header className="shrink-0 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/50 px-3 sm:px-4 py-2 z-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={kubleLogo} alt="Kuble" className="h-5 sm:h-6" />
          <span className="text-[10px] font-medium text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded hidden xs:inline">
            BETA
          </span>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link key={path} href={path}>
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  location === path
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
                data-testid={`nav-${path.slice(1) || "home"}`}
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </button>
            </Link>
          ))}
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/credits">
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    location === "/credits"
                      ? "bg-white/10 text-white"
                      : hasCriticalCredits
                        ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        : hasLowCredits
                          ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                  data-testid="nav-credits"
                >
                  {hasCriticalCredits ? (
                    <AlertTriangle className="size-4" />
                  ) : (
                    <Wallet className="size-4" />
                  )}
                  <span>{credits ? formatMinutes(credits.transcriptSeconds) : "..."}</span>
                </button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs space-y-1">
                <div>Transkription: {credits ? formatMinutes(credits.transcriptSeconds) : "..."}</div>
                <div>Voice: {credits ? formatMinutes(credits.voiceSeconds) : "..."}</div>
                {hasCriticalCredits && <div className="text-red-400 font-medium">Credits aufgebraucht!</div>}
                {hasLowCredits && !hasCriticalCredits && <div className="text-amber-400 font-medium">Credits niedrig</div>}
              </div>
            </TooltipContent>
          </Tooltip>
          
          <Link href="/help">
            <button
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                location === "/help"
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
              data-testid="nav-help"
              title="Hilfe"
            >
              <HelpCircle className="size-4" />
            </button>
          </Link>
          
          {isAdmin && (
            <Link href="/admin">
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  location === "/admin"
                    ? "bg-green-500/20 text-green-400"
                    : "text-green-400/70 hover:text-green-400 hover:bg-green-500/10"
                }`}
                data-testid="nav-admin"
              >
                <ShieldCheck className="size-4" />
                <span>Admin</span>
              </button>
            </Link>
          )}
        </nav>

        {/* Mobile Navigation */}
        <div className="flex md:hidden items-center gap-2">
          {/* Credits button always visible on mobile */}
          <Link href="/credits">
            <button
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs transition-colors ${
                hasCriticalCredits
                  ? "bg-red-500/20 text-red-400"
                  : hasLowCredits
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-gray-400"
              }`}
              data-testid="nav-credits-mobile"
            >
              {hasCriticalCredits ? <AlertTriangle className="size-4" /> : <Wallet className="size-4" />}
              <span>{credits ? formatMinutes(credits.transcriptSeconds) : "..."}</span>
            </button>
          </Link>

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <button className="p-2 text-gray-400 hover:text-white" data-testid="button-mobile-menu">
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 bg-slate-900 border-slate-700 p-0">
              <div className="flex flex-col h-full">
                <div className="flex items-center p-4 border-b border-slate-700">
                  <img src={kubleLogo} alt="Kuble" className="h-5" />
                </div>
                <nav className="flex-1 p-4 space-y-1">
                  {navItems.map(({ path, label, icon: Icon }) => (
                    <button
                      key={path}
                      onClick={() => handleNavClick(path)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                        location === path
                          ? "bg-white/10 text-white"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
                      }`}
                      data-testid={`nav-mobile-${path.slice(1) || "home"}`}
                    >
                      <Icon className="size-5" />
                      <span>{label}</span>
                    </button>
                  ))}
                  
                  <button
                    onClick={() => handleNavClick("/credits")}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                      location === "/credits"
                        ? "bg-white/10 text-white"
                        : hasCriticalCredits
                          ? "bg-red-500/10 text-red-400"
                          : hasLowCredits
                            ? "bg-amber-500/10 text-amber-400"
                            : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                    data-testid="nav-mobile-credits"
                  >
                    {hasCriticalCredits ? <AlertTriangle className="size-5" /> : <Wallet className="size-5" />}
                    <span>Credits</span>
                    <span className="ml-auto text-xs opacity-70">
                      {credits ? formatMinutes(credits.transcriptSeconds) : "..."}
                    </span>
                  </button>
                  
                  <button
                    onClick={() => handleNavClick("/help")}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                      location === "/help"
                        ? "bg-white/10 text-white"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                    data-testid="nav-mobile-help"
                  >
                    <HelpCircle className="size-5" />
                    <span>Hilfe</span>
                  </button>
                  
                  {isAdmin && (
                    <button
                      onClick={() => handleNavClick("/admin")}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                        location === "/admin"
                          ? "bg-green-500/20 text-green-400"
                          : "text-green-400/70 hover:text-green-400 hover:bg-green-500/10"
                      }`}
                      data-testid="nav-mobile-admin"
                    >
                      <ShieldCheck className="size-5" />
                      <span>Admin</span>
                    </button>
                  )}
                </nav>
                
                <div className="p-4 border-t border-slate-700">
                  <div className="text-xs text-gray-500 space-y-1">
                    <div className="flex justify-between">
                      <span>Transkription:</span>
                      <span className="text-gray-400">{credits ? formatMinutes(credits.transcriptSeconds) : "..."}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Voice:</span>
                      <span className="text-gray-400">{credits ? formatMinutes(credits.voiceSeconds) : "..."}</span>
                    </div>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function AuthenticatedRouter() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Route path="/" component={VoiceAgent} />
          <Route path="/cohost" component={CoHost} />
          <Route path="/sources" component={Sources} />
          <Route path="/shows" component={Shows} />
          <Route path="/usage" component={UsageDashboard} />
          <Route path="/credits" component={Credits} />
          <Route path="/checkout/success" component={CheckoutSuccess} />
          <Route path="/checkout/cancel" component={CheckoutCancel} />
          <Route path="/quick-actions" component={QuickActions} />
          <Route path="/help" component={Help} />
          <Route path="/admin" component={AdminDashboard} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

function AppContent() {
  const { isLoading, isAuthenticated } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">Laden...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Show landing page on root, login on all other routes
    if (location === "/") {
      return <Landing />;
    }
    return <Login />;
  }

  return <AuthenticatedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppContent />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
