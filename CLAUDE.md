# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start backend server (development mode, port 5001)
npm run dev:client   # Start Vite dev server on port 5000
npm run build        # Build client + server for production → /dist
npm start            # Run production server
npm run check        # TypeScript type checking
npm run db:push      # Push Drizzle schema changes to SQLite
```

## Architecture Overview

This is a **real-time voice intelligence platform** (Podcast Co-Host) with:
- Live audio transcription via WebSocket + Deepgram Nova 3
- AI Co-Host conversation via Google Gemini 2.5 Flash Live API
- Local deployment with simple authentication (no billing/credits)

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Wouter, TanStack Query
- **Backend**: Express, Node.js 20, TypeScript ESM
- **Database**: SQLite (better-sqlite3) + Drizzle ORM
- **APIs**: Deepgram (STT), OpenAI (GPT), Google Gemini, ElevenLabs (optional TTS)
- **Auth**: Simple username/password with Express sessions

### Project Structure
```
client/src/
  pages/           # VoiceAgent, CoHost, Sources, Shows, Admin, Login
  hooks/           # useWebSocketAudio, useCoHostWebSocket, use-auth
  components/ui/   # shadcn/ui components (Radix-based)
  index.css        # CSS design system with custom properties

server/
  index.ts         # Express setup, server entry
  routes.ts        # All API routes + WebSocket handlers (~2700 lines)
  storage.ts       # Database CRUD operations (IStorage interface)
  db.ts            # SQLite connection via Drizzle
  auth.ts          # Authentication middleware

shared/
  schema.ts        # Drizzle ORM schema (all tables, Zod schemas)
  models/          # Shared TypeScript types (auth, etc.)

data/
  cohost.db        # SQLite database (auto-created)
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

**Authentication**: Simple username/password from environment variables (`AUTH_USER`, `AUTH_PASSWORD` in `.env`). Session data stored in SQLite sessions table. All routes access user via `req.user.id`.

**Storage Layer** (`server/storage.ts`): All database operations go through `IStorage` interface. Every query filters by `userId` for data isolation.

**WebSocket Auth**: Session cookies validated via HMAC signature. Unauthenticated connections rejected.

**Real-time Transcript Sync**: Final transcripts from `/ws/audio` auto-forwarded to active Co-Host sessions via `activeCoHostSessions` Map.

**Quick Actions**: Two-tier system (system defaults with userId=NULL, user-created with userId set)

**Design System**: CSS custom properties in `client/src/index.css` provide semantic tokens for colors, typography, spacing, shadows. Dark mode is the default theme.

### Database Schema Highlights
Key tables in `shared/schema.ts`:
- `users` - User accounts (currently single-user)
- `sessions` - Express session storage (for WebSocket auth)
- `shows` - Podcast episodes
- `transcriptSegments` - Transcription text with speaker info
- `sources` - Documents for Co-Host context (PDF, JSON, text)
- `systemPrompts` - Saved AI prompts
- `quickActions` - User and system prompt templates

### Environment Variables
See `.env.example`. Key vars:
- `SESSION_SECRET` - Express session secret (generate with: `openssl rand -base64 32`)
- `AUTH_USER` - Login username (default: `admin`)
- `AUTH_PASSWORD` - Login password (set to something secure)
- `DEEPGRAM_API_KEY` - Speech-to-text (required)
- `OPENAI_API_KEY` - GPT models (required)
- `GOOGLE_AI_API_KEY` - Gemini Live API (required)
- `ELEVENLABS_API_KEY` - Text-to-speech (optional)

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
