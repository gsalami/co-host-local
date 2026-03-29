import { apiUrl, BASE_PATH } from "@/lib/config";
import { Switch, Route, Link, useLocation, Router } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import VoiceAgent from "@/pages/VoiceAgent";
import CoHost from "@/pages/CoHost";
import CombinedMode from "@/pages/CombinedMode";
import Sources from "@/pages/Sources";
import Shows from "@/pages/Shows";
import UsageDashboard from "@/pages/UsageDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import QuickActions from "@/pages/QuickActions";
import Help from "@/pages/Help";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import kubleLogo from "./assets/kuble-logo.png";
import { Radio, Mic, FileText, BarChart2, List, ShieldCheck, Menu, HelpCircle, RadioTower } from "lucide-react";
import { useState, useEffect } from "react";

function Header() {
  const [location, setLocation] = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  useEffect(() => {
    fetch(apiUrl("/api/admin/check"))
      .then(res => res.json())
      .then(data => setIsAdmin(data.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);
  
  const navItems = [
    { path: "/", label: "Aufnahme", icon: Radio },
    { path: "/cohost", label: "Co-Host", icon: Mic },
    { path: "/combined", label: "Co-Host & Aufnahme", icon: RadioTower },
    { path: "/sources", label: "Quellen", icon: FileText },
    { path: "/shows", label: "Sendungen", icon: List },
    { path: "/usage", label: "Nutzung", icon: BarChart2 },
  ];

  const handleNavClick = (path: string) => {
    setLocation(path);
    setMobileMenuOpen(false);
  };
  
  return (
    <header className="shrink-0 bg-card/80 backdrop-blur-sm border-b border-border/50 px-3 sm:px-4 py-2 z-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={kubleLogo} alt="Kuble" className="h-5 sm:h-6" />
          <span className="text-[10px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded hidden xs:inline">
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
                    ? "bg-primary/10 text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                data-testid={`nav-${path.slice(1) || "home"}`}
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </button>
            </Link>
          ))}

          <Link href="/help">
            <button
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                location === "/help"
                  ? "bg-primary/10 text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
                    ? "bg-accent/20 text-accent"
                    : "text-accent/70 hover:text-accent hover:bg-accent/10"
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
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <button className="p-2 text-muted-foreground hover:text-foreground" data-testid="button-mobile-menu">
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 bg-card border-border p-0">
              <div className="flex flex-col h-full">
                <div className="flex items-center p-4 border-b border-border">
                  <img src={kubleLogo} alt="Kuble" className="h-5" />
                </div>
                <nav className="flex-1 p-4 space-y-1">
                  {navItems.map(({ path, label, icon: Icon }) => (
                    <button
                      key={path}
                      onClick={() => handleNavClick(path)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                        location === path
                          ? "bg-primary/10 text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                      data-testid={`nav-mobile-${path.slice(1) || "home"}`}
                    >
                      <Icon className="size-5" />
                      <span>{label}</span>
                    </button>
                  ))}

                  <button
                    onClick={() => handleNavClick("/help")}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                      location === "/help"
                        ? "bg-primary/10 text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
                          ? "bg-accent/20 text-accent"
                          : "text-accent/70 hover:text-accent hover:bg-accent/10"
                      }`}
                      data-testid="nav-mobile-admin"
                    >
                      <ShieldCheck className="size-5" />
                      <span>Admin</span>
                    </button>
                  )}
                </nav>
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
          <Route path="/combined" component={CombinedMode} />
          <Route path="/sources" component={Sources} />
          <Route path="/shows" component={Shows} />
          <Route path="/usage" component={UsageDashboard} />
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Laden...</div>
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
    <Router base={BASE_PATH}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </QueryClientProvider>
    </Router>
  );
}

export default App;
