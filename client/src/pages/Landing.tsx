import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Mic, 
  FileText, 
  MessageSquare, 
  Zap, 
  CheckCircle2,
  ArrowRight,
  Radio,
  Upload,
  BarChart2,
  Shield,
  ChevronDown
} from "lucide-react";
import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const PRICING_PACKAGES = [
  {
    id: "teaser",
    name: "Teaser",
    priceChf: 10,
    transcriptMinutes: 60,
    voiceMinutes: 20,
    description: "Zum Ausprobieren"
  },
  {
    id: "episode",
    name: "Episode",
    priceChf: 20,
    transcriptMinutes: 150,
    voiceMinutes: 50,
    description: "Für einzelne Folgen",
    popular: true
  },
  {
    id: "staffel",
    name: "Staffel",
    priceChf: 50,
    transcriptMinutes: 450,
    voiceMinutes: 150,
    description: "Für eine Staffel"
  },
  {
    id: "produzent",
    name: "Produzent",
    priceChf: 100,
    transcriptMinutes: 1000,
    voiceMinutes: 330,
    description: "Für regelmässige Produktion"
  },
  {
    id: "podcast-imperium",
    name: "Podcast-Imperium",
    priceChf: 200,
    transcriptMinutes: 2000,
    voiceMinutes: 650,
    description: "Für Viel-Produzenten"
  }
];

const FEATURES = [
  {
    icon: FileText,
    title: "Live-Transkription",
    description: "Dein Gespräch wird in Echtzeit transkribiert. Du siehst sofort, was gesagt wurde.",
    details: [
      "Sprechererkennung für mehrere Personen",
      "Deutscher Sprachsupport",
      "Nachträgliche Bearbeitung möglich"
    ]
  },
  {
    icon: MessageSquare,
    title: "AI Co-Host",
    description: "Ein KI-Gesprächspartner, der zuhört und auf Wunsch antwortet. Per Stimme oder Text.",
    details: [
      "Verschiedene Stimmen wählbar (Puck, Kore)",
      "Hört dem Gespräch live zu",
      "Beantwortet Fragen zum Kontext"
    ]
  },
  {
    icon: Upload,
    title: "Quellen & Kontext",
    description: "Lade Dokumente hoch, die der Co-Host als Hintergrundwissen nutzt.",
    details: [
      "PDF, Markdown, Text-Dateien",
      "Bilder und Audio-Dateien",
      "Texte direkt einfügen"
    ]
  },
  {
    icon: BarChart2,
    title: "Nutzung & Credits",
    description: "Transparente Abrechnung. Du siehst immer, wie viel du verbraucht hast.",
    details: [
      "Minuten-genaue Erfassung",
      "Getrennte Credits für Transkription und Voice",
      "Kaufhistorie einsehbar"
    ]
  }
];

const FAQ_ITEMS = [
  {
    question: "Wie funktioniert die Abrechnung?",
    answer: "Du kaufst Credit-Pakete im Voraus. Transkription und AI Co-Host werden getrennt abgerechnet. Es gibt keine versteckten Kosten oder Abos."
  },
  {
    question: "Werden meine Aufnahmen gespeichert?",
    answer: "Nur die Transkripte werden gespeichert, nicht die Audio-Dateien selbst. Das spart Speicher und schützt deine Privatsphäre."
  },
  {
    question: "Welche Sprache wird unterstützt?",
    answer: "Die Transkription ist für Deutsch optimiert. Englische Begriffe werden ebenfalls gut erkannt."
  },
  {
    question: "Kann ich den AI Co-Host auch ohne Transkription nutzen?",
    answer: "Ja, du kannst den Co-Host auch separat nutzen. Er verbraucht dann nur Voice-Credits."
  },
  {
    question: "Was passiert, wenn meine Credits aufgebraucht sind?",
    answer: "Du erhältst eine Warnung und kannst jederzeit neue Credits kaufen. Laufende Aufnahmen werden nicht abrupt gestoppt."
  }
];

export default function Landing() {
  const [showAllPackages, setShowAllPackages] = useState(false);
  
  const visiblePackages = showAllPackages ? PRICING_PACKAGES : PRICING_PACKAGES.slice(0, 3);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-purple-900/10 to-slate-950" />
        <div className="relative max-w-6xl mx-auto px-4 py-16 md:py-24">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm mb-6">
              <Radio className="size-4" />
              <span>Für Podcast-Produzenten</span>
            </div>
            
            <h1 className="text-3xl md:text-5xl font-bold mb-6 leading-tight" data-testid="text-hero-title">
              Podcast aufnehmen mit Live-Transkription und AI Co-Host
            </h1>
            
            <p className="text-lg md:text-xl text-gray-400 mb-8 leading-relaxed">
              Zeichne deine Gespräche auf, sieh das Transkript in Echtzeit und nutze einen KI-Assistenten, 
              der mithört und auf Fragen antwortet.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8" 
                data-testid="button-cta-primary"
                onClick={() => window.location.href = "/api/login"}
              >
                Kostenlos ausprobieren
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <a href="#features">
                <Button size="lg" variant="outline" className="w-full sm:w-auto border-gray-600 text-gray-300 hover:bg-white/5" data-testid="button-cta-secondary">
                  Mehr erfahren
                </Button>
              </a>
            </div>
            
            <p className="mt-4 text-sm text-gray-500">
              5 Minuten Transkription + 5 Minuten Voice gratis
            </p>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-16 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">So funktioniert's</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="text-lg font-semibold mb-2">Aufnehmen</h3>
              <p className="text-gray-400">
                Starte eine Aufnahme mit deinem Mikrofon oder Tab-Audio. Das Gespräch wird live erfasst.
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-purple-600 text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="text-lg font-semibold mb-2">Transkribieren</h3>
              <p className="text-gray-400">
                Die Sprache wird in Echtzeit in Text umgewandelt. Du siehst sofort, was gesagt wurde.
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-600 text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">Mit Co-Host moderieren</h3>
              <p className="text-gray-400">
                Der AI Co-Host hört mit und kann auf Zuruf Fragen beantworten oder Themen recherchieren.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Funktionen</h2>
          <p className="text-gray-400 text-center mb-12 max-w-2xl mx-auto">
            Alles, was du für die Podcast-Produktion brauchst, in einer Anwendung.
          </p>
          
          <div className="grid md:grid-cols-2 gap-6">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <feature.icon className="size-6 text-blue-400" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-white">{feature.title}</CardTitle>
                      <p className="text-gray-400 mt-1">{feature.description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {feature.details.map((detail, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
                        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                        {detail}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-16 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">Pakete</h2>
          <p className="text-gray-400 text-center mb-8 max-w-2xl mx-auto">
            Keine Abos, keine versteckten Kosten. Kaufe Credits, wenn du sie brauchst.
          </p>
          
          <div className="inline-flex items-center gap-2 justify-center w-full mb-8">
            <Zap className="size-4 text-green-400" />
            <span className="text-green-400 text-sm font-medium">
              5 Min Transkription + 5 Min Voice gratis zum Start
            </span>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {visiblePackages.map((pkg) => (
              <Card 
                key={pkg.id} 
                className={`relative bg-slate-800/50 border-slate-700 ${pkg.popular ? 'ring-2 ring-blue-500' : ''}`}
                data-testid={`card-package-${pkg.id}`}
              >
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-600 text-white text-xs px-3 py-1 rounded-full">
                      Beliebt
                    </span>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-xl text-white">{pkg.name}</CardTitle>
                  <p className="text-sm text-gray-400">{pkg.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <span className="text-3xl font-bold text-white">CHF {pkg.priceChf}</span>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2 text-gray-300">
                      <FileText className="size-4 text-blue-400" />
                      {pkg.transcriptMinutes} Min Transkription
                    </li>
                    <li className="flex items-center gap-2 text-gray-300">
                      <Mic className="size-4 text-purple-400" />
                      {pkg.voiceMinutes} Min Voice
                    </li>
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {!showAllPackages && (
            <div className="text-center">
              <Button 
                variant="ghost" 
                onClick={() => setShowAllPackages(true)}
                className="text-gray-400 hover:text-white"
                data-testid="button-show-all-packages"
              >
                Alle Pakete anzeigen
                <ChevronDown className="ml-2 size-4" />
              </Button>
            </div>
          )}
          
          <div className="mt-8 text-center">
            <Button 
              size="lg" 
              className="bg-blue-600 hover:bg-blue-700" 
              data-testid="button-cta-pricing"
              onClick={() => window.location.href = "/api/login"}
            >
              Jetzt starten
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="py-12 bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-8 text-sm text-gray-400">
            <div className="flex items-center gap-2">
              <Shield className="size-5 text-green-500" />
              <span>Sichere Zahlung via Stripe</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-blue-500" />
              <span>Keine Audio-Speicherung</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-purple-500" />
              <span>Deepgram + Gemini AI</span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 border-t border-slate-800">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">Häufige Fragen</h2>
          
          <Accordion type="single" collapsible className="space-y-2">
            {FAQ_ITEMS.map((item, index) => (
              <AccordionItem 
                key={index} 
                value={`faq-${index}`}
                className="bg-slate-800/30 border border-slate-700 rounded-lg px-4"
                data-testid={`faq-item-${index}`}
              >
                <AccordionTrigger className="text-left text-white hover:no-underline" data-testid={`faq-trigger-${index}`}>
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-gray-400">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <Radio className="size-5 text-blue-400" />
              <span className="font-semibold">Podcast Co-Host</span>
            </div>
            
            <div className="flex gap-6 text-sm text-gray-400">
              <a href="https://rtk.kuble.com" target="_blank" rel="noopener noreferrer" className="hover:text-white" data-testid="link-footer-connect">
                Connect with us
              </a>
              <a href="https://www.kuble.com/kontaktiere-uns" target="_blank" rel="noopener noreferrer" className="hover:text-white" data-testid="link-footer-contact">
                Kontakt
              </a>
            </div>
            
            <p className="text-sm text-gray-500">
              Ein Produkt von Kuble
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
