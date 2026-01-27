# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start backend server (development mode)
npm run dev:client   # Start Vite dev server on port 5000
npm run build        # Build client + server for production → /dist
npm start            # Run production server
npm run check        # TypeScript type checking
npm run db:push      # Push Drizzle schema changes to PostgreSQL
```

## Architecture Overview

This is a **real-time voice intelligence platform** (Podcast Co-Host) with:
- Live audio transcription via WebSocket + Deepgram Nova 3
- AI Co-Host conversation via Google Gemini 2.5 Flash Live API
- Credit-based monetization with Stripe

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Wouter, TanStack Query
- **Backend**: Express, Node.js 20, TypeScript ESM
- **Database**: PostgreSQL + Drizzle ORM
- **APIs**: Deepgram (STT), OpenAI (GPT), Google Gemini, Stripe

### Project Structure
```
client/src/
  pages/           # VoiceAgent, CoHost, Sources, Shows, Credits, Admin
  hooks/           # useWebSocketAudio, useCoHostWebSocket, use-auth, use-credits
  components/ui/   # shadcn/ui components (Radix-based)

server/
  index.ts         # Express setup, server entry
  routes.ts        # All API routes + WebSocket handlers (~2700 lines)
  storage.ts       # Database CRUD operations (IStorage interface)
  db.ts            # Drizzle connection

shared/
  schema.ts        # Drizzle ORM schema (all tables, Zod schemas)
```

### WebSocket Endpoints
- `/ws/audio` - Audio streaming → Deepgram transcription (proxied)
- `/ws/cohost` - AI Co-Host ↔ Gemini Live API bridge

### API Routes Pattern
All REST endpoints under `/api/*`:
- Protected by `isAuthenticated` middleware
- User data isolated by `userId` in all queries
- Admin routes protected by `isAdmin` middleware

### Key Patterns

**Storage Layer** (`server/storage.ts`): All database operations go through `IStorage` interface. Every query filters by `userId` for data isolation.

**WebSocket Auth**: Session cookies validated via HMAC signature. Unauthenticated connections rejected.

**Real-time Transcript Sync**: Final transcripts from `/ws/audio` auto-forwarded to active Co-Host sessions via `activeCoHostSessions` Map.

**Credit System**:
- Free tier: 5 min transcript + 5 min voice on first access
- Deducted in real-time during recording/voice sessions
- Only actual speech duration counted (from Deepgram word timestamps)

**Quick Actions**: Two-tier system (system defaults with userId=NULL, user-created with userId set)

### Database Schema Highlights
Key tables in `shared/schema.ts`:
- `shows` - Podcast episodes
- `transcript_segments` - Transcription text with speaker info
- `sources` - Documents for Co-Host context (PDF, JSON, text)
- `system_prompts` - Saved AI prompts
- `user_credits` / `usage_records` - Credit tracking

### Environment Variables
See `.env.example`. Key vars:
- `DEEPGRAM_API_KEY` - Speech-to-text
- `OPENAI_API_KEY` - GPT models
- `GOOGLE_AI_API_KEY` - Gemini Live API
- `DATABASE_URL` - PostgreSQL connection
- `STRIPE_*` - Payment processing

## Code Review & Changes

### Kommunikation
- Erkläre Issues und Änderungen auf Deutsch
- Frage nach, wenn der Kontext unklar ist
- Bei größeren Änderungen: biete Follow-up Review an

### Wichtige Regeln
1. **Keine Annahmen** - Wenn Code oder Kontext fehlt, frag danach
2. **Priorisiere** - Fokussiere auf die wichtigsten Issues, nicht alles auf einmal
3. **Kontext bewahren** - Merke dir den Stand des Projekts im Gespräch
4. **Testbar** - Änderungen sollten testbar sein

### Review-Struktur (bei Code-Analyse)
- **Kritische Issues** - müssen sofort behoben werden
- **Verbesserungen** - sollten umgesetzt werden
- **Nice-to-have** - optionale Optimierungen
