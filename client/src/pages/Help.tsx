import { useState } from "react";
import { 
  Radio, 
  Mic, 
  FileText, 
  List, 
  BarChart2, 
  Wallet, 
  Zap,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Sparkles
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

interface HelpSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  features: {
    title: string;
    description: string;
    tip?: string;
  }[];
  faq?: {
    question: string;
    answer: string;
  }[];
}

const helpSections: HelpSection[] = [
  {
    id: "recording",
    icon: <Radio className="size-5 text-cyan-400" />,
    title: "Aufnahme & Transkription",
    description: "Nimm deine Podcasts auf und erhalte automatische Live-Transkripte.",
    features: [
      {
        title: "Mikrofon-Aufnahme",
        description: "Nimm deine Stimme direkt über dein Mikrofon auf. Die Transkription erfolgt in Echtzeit.",
        tip: "Verwende ein gutes Headset für beste Audioqualität."
      },
      {
        title: "Tab-Audio",
        description: "Nimm Audio aus einem anderen Browser-Tab auf - ideal für Remote-Gäste über Zoom, Meet oder andere Plattformen.",
        tip: "Wähle 'Tab teilen' und aktiviere 'Tab-Audio teilen'."
      },
      {
        title: "Kombiniert (Mikrofon + Tab)",
        description: "Nimm gleichzeitig deine Stimme und Tab-Audio auf - perfekt für Interviews mit Remote-Gästen.",
      },
      {
        title: "Speaker-Erkennung",
        description: "Das System erkennt automatisch verschiedene Sprecher und markiert sie farblich im Transkript.",
        tip: "Du kannst Sprechern Namen zuweisen über die Sendungs-Einstellungen."
      },
      {
        title: "Sendungen",
        description: "Organisiere deine Aufnahmen in Sendungen/Episoden. Jede Sendung speichert das komplette Transkript.",
      }
    ],
    faq: [
      {
        question: "Welche Sprache wird unterstützt?",
        answer: "Die Transkription ist für Deutsch konfiguriert. Englische Begriffe werden ebenfalls gut erkannt."
      },
      {
        question: "Wird meine Aufnahme gespeichert?",
        answer: "Nur das Transkript wird gespeichert, nicht die Audio-Datei selbst. Das spart Speicher und schützt deine Privatsphäre."
      }
    ]
  },
  {
    id: "cohost",
    icon: <Mic className="size-5 text-purple-400" />,
    title: "AI Co-Host",
    description: "Dein KI-Assistent für Live-Unterstützung während der Aufnahme.",
    features: [
      {
        title: "Echtzeit-Gespräch",
        description: "Sprich direkt mit dem AI Co-Host über Push-to-Talk. Er hört zu und antwortet mit natürlicher Stimme.",
        tip: "Halte den grossen Mikrofon-Button gedrückt zum Sprechen."
      },
      {
        title: "Text-Chat",
        description: "Du kannst auch per Text mit dem Co-Host kommunizieren - ideal wenn du nicht sprechen kannst.",
      },
      {
        title: "Stimmen-Auswahl",
        description: "Wähle zwischen verschiedenen KI-Stimmen: 'Kore' (weiblich) oder 'Puck' (männlich).",
      },
      {
        title: "Transkript-Kontext",
        description: "Der Co-Host kennt automatisch das bisherige Transkript deiner Sendung und kann darauf Bezug nehmen.",
      },
      {
        title: "Sprache wählen",
        description: "Der Co-Host kann auf Deutsch oder Englisch antworten - wähle die Sprache vor Session-Start.",
      }
    ],
    faq: [
      {
        question: "Verbraucht der Co-Host Credits?",
        answer: "Ja, Voice-Credits werden für Sprechen (voice_in) und Antworten (voice_out) abgezogen. Der Verbrauch wird live angezeigt."
      },
      {
        question: "Kann der Co-Host recherchieren?",
        answer: "Ja! Nutze die Quick Action 'Recherchieren' oder bitte ihn einfach, etwas im Internet nachzuschlagen."
      }
    ]
  },
  {
    id: "sources",
    icon: <FileText className="size-5 text-blue-400" />,
    title: "Quellen & Kontext",
    description: "Lade Dokumente hoch, die der Co-Host als Wissensgrundlage nutzt.",
    features: [
      {
        title: "PDF-Upload",
        description: "Lade PDF-Dokumente hoch - der Text wird automatisch extrahiert und dem Co-Host zur Verfügung gestellt.",
      },
      {
        title: "Text & Markdown",
        description: "Füge Texte oder Markdown-Dokumente als Kontext hinzu.",
      },
      {
        title: "JSON-Daten",
        description: "Strukturierte Daten im JSON-Format können ebenfalls als Kontext verwendet werden.",
      },
      {
        title: "Kontext-Auswahl",
        description: "Vor jeder Co-Host Session wählst du aus, welche Quellen aktiv sein sollen.",
        tip: "Wähle nur relevante Quellen aus - zu viel Kontext kann die Antworten verwässern."
      }
    ],
    faq: [
      {
        question: "Wie gross dürfen Dateien sein?",
        answer: "PDFs sollten nicht grösser als 10 MB sein. Sehr lange Dokumente werden automatisch gekürzt."
      }
    ]
  },
  {
    id: "quickactions",
    icon: <Zap className="size-5 text-yellow-400" />,
    title: "Quick Actions",
    description: "Schnellaktionen für häufige Anfragen an den Co-Host.",
    features: [
      {
        title: "Standard-Aktionen",
        description: "Vordefinierte Aktionen wie 'Zusammenfassen', 'Recherchieren' und 'Erklären' sind für alle Benutzer verfügbar.",
      },
      {
        title: "Eigene Aktionen erstellen",
        description: "Erstelle eigene Quick Actions mit individuellen Prompts für deine Workflows.",
        tip: "Gehe zu /quick-actions um deine Aktionen zu verwalten."
      },
      {
        title: "Ein-/Ausschalten",
        description: "Du kannst jede Aktion ein- oder ausschalten, ohne sie zu löschen. Deaktivierte Aktionen erscheinen nicht im Co-Host.",
      }
    ]
  },
  {
    id: "shows",
    icon: <List className="size-5 text-green-400" />,
    title: "Sendungen verwalten",
    description: "Organisiere deine Podcast-Episoden und Transkripte.",
    features: [
      {
        title: "Sendung erstellen",
        description: "Erstelle eine neue Sendung für jede Episode. Das Transkript wird automatisch zugeordnet.",
      },
      {
        title: "Transkript ansehen",
        description: "Öffne eine Sendung um das komplette Transkript mit Sprecher-Markierungen zu sehen.",
      },
      {
        title: "Sprecher benennen",
        description: "Gib den erkannten Sprechern Namen (z.B. 'Speaker 0' → 'Max'), um das Transkript lesbarer zu machen.",
      },
      {
        title: "Sendung löschen",
        description: "Lösche Sendungen die du nicht mehr brauchst. Das zugehörige Transkript wird ebenfalls gelöscht.",
      }
    ]
  },
  {
    id: "credits",
    icon: <Wallet className="size-5 text-amber-400" />,
    title: "Credits & Guthaben",
    description: "So funktioniert das Credit-System für Transkription und Voice.",
    features: [
      {
        title: "Zwei Credit-Typen",
        description: "Transkript-Credits für die Aufnahme, Voice-Credits für den Co-Host. Beide werden in Minuten gezählt.",
      },
      {
        title: "Gratis-Guthaben",
        description: "Neue Benutzer erhalten 5 Minuten Transkription + 5 Minuten Voice zum Ausprobieren.",
      },
      {
        title: "Credit-Pakete",
        description: "Kaufe Credit-Pakete von 'Teaser' (CHF 10) bis 'Podcast-Imperium' (CHF 200) - je grösser das Paket, desto mehr Credits pro Franken.",
      },
      {
        title: "Live-Anzeige",
        description: "Dein aktuelles Guthaben siehst du jederzeit oben in der Navigation. Bei niedrigem Guthaben wirst du gewarnt.",
      }
    ],
    faq: [
      {
        question: "Was passiert wenn meine Credits aufgebraucht sind?",
        answer: "Die Aufnahme und der Co-Host stoppen automatisch. Kaufe ein neues Paket um fortzufahren."
      },
      {
        question: "Verfallen ungenutzte Credits?",
        answer: "Nein, deine Credits bleiben erhalten bis du sie nutzt."
      }
    ]
  },
  {
    id: "usage",
    icon: <BarChart2 className="size-5 text-rose-400" />,
    title: "Nutzungsstatistiken",
    description: "Behalte den Überblick über deinen Verbrauch.",
    features: [
      {
        title: "Verbrauch pro Sendung",
        description: "Sieh wie viele Minuten du pro Sendung für Transkription und Voice genutzt hast.",
      },
      {
        title: "Gesamtübersicht",
        description: "Eine Zusammenfassung zeigt deinen gesamten bisherigen Verbrauch.",
      },
      {
        title: "Grafische Darstellung",
        description: "Diagramme helfen dir, Muster in deiner Nutzung zu erkennen.",
      }
    ]
  }
];

export default function Help() {
  const [expandedSection, setExpandedSection] = useState<string | null>("recording");

  return (
    <div className="h-full overflow-auto bg-slate-900 text-white p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 text-cyan-400 px-4 py-2 rounded-full mb-4">
            <HelpCircle className="size-5" />
            <span className="font-medium">Hilfe & Anleitung</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2" data-testid="text-help-title">
            Willkommen bei Podcast Co-Host
          </h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            Dein KI-Assistent für Podcast-Aufnahmen mit Live-Transkription und intelligenter Unterstützung.
          </p>
        </div>

        <div className="grid gap-4 mb-8">
          <Card className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border-cyan-500/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-cyan-500/20 rounded-lg">
                  <Sparkles className="size-6 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">Schnellstart</h3>
                  <ol className="text-sm text-gray-300 space-y-2">
                    <li className="flex items-start gap-2">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">1</Badge>
                      <span>Erstelle eine neue Sendung unter "Sendungen"</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">2</Badge>
                      <span>Starte die Aufnahme unter "Aufnahme" mit deinem Mikrofon</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Badge variant="secondary" className="mt-0.5 shrink-0">3</Badge>
                      <span>Nutze den "Co-Host" für KI-Unterstützung während der Aufnahme</span>
                    </li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          {helpSections.map((section) => (
            <Card 
              key={section.id} 
              className={`bg-slate-800 border-slate-700 transition-all cursor-pointer ${
                expandedSection === section.id ? 'ring-1 ring-cyan-500/50' : ''
              }`}
              data-testid={`help-section-${section.id}`}
            >
              <CardHeader 
                className="pb-2 cursor-pointer"
                onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-700/50 rounded-lg">
                      {section.icon}
                    </div>
                    <div>
                      <CardTitle className="text-base">{section.title}</CardTitle>
                      <p className="text-xs text-gray-400 mt-0.5">{section.description}</p>
                    </div>
                  </div>
                  {expandedSection === section.id ? (
                    <ChevronDown className="size-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="size-5 text-gray-400" />
                  )}
                </div>
              </CardHeader>
              
              {expandedSection === section.id && (
                <CardContent className="pt-2 border-t border-slate-700">
                  <div className="space-y-4">
                    {section.features.map((feature, idx) => (
                      <div key={idx} className="pl-4 border-l-2 border-slate-600">
                        <h4 className="font-medium text-sm text-white">{feature.title}</h4>
                        <p className="text-xs text-gray-400 mt-1">{feature.description}</p>
                        {feature.tip && (
                          <p className="text-xs text-cyan-400 mt-1 flex items-start gap-1">
                            <span className="font-medium">Tipp:</span> {feature.tip}
                          </p>
                        )}
                      </div>
                    ))}
                    
                    {section.faq && section.faq.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-700">
                        <h4 className="text-sm font-medium text-gray-300 mb-3">Häufige Fragen</h4>
                        <Accordion type="single" collapsible className="space-y-2">
                          {section.faq.map((item, idx) => (
                            <AccordionItem 
                              key={idx} 
                              value={`faq-${idx}`}
                              className="border-slate-600 bg-slate-700/30 rounded-lg px-3"
                            >
                              <AccordionTrigger className="text-sm py-2 hover:no-underline">
                                {item.question}
                              </AccordionTrigger>
                              <AccordionContent className="text-xs text-gray-400 pb-3">
                                {item.answer}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-700/50 rounded-lg">
                <MessageSquare className="size-5 text-gray-400" />
              </div>
              <div>
                <h3 className="font-medium text-sm">Noch Fragen?</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Frag einfach den Co-Host - er hilft dir gerne bei allen Fragen zur App!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
