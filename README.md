# Co-Host Local - Real-Time Voice Intelligence Platform

A self-hosted, real-time voice intelligence interface for podcast co-hosting. This application captures audio, streams it to speech-to-text services, maintains conversation context, and provides an AI co-host powered by Google Gemini 2.5 Flash Live API.

## Features

- **Real-time Transcription**: Live audio streaming with Deepgram Nova 3 STT
- **AI Co-Host**: Interactive voice conversation via Google Gemini 2.5 Flash Live API
- **Context Management**: Maintains conversation history and document sources
- **Shows Management**: Organize podcast episodes and transcripts
- **Quick Actions**: Pre-configured AI prompts for common tasks
- **Privacy First**: Local deployment, simple authentication, no external billing
- **Professional UI**: Dark mode design system with CSS custom properties

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Wouter, TanStack Query
- **Backend**: Express, Node.js 20, TypeScript ESM
- **Database**: SQLite (better-sqlite3) with Drizzle ORM
- **APIs**: Deepgram (STT), OpenAI (GPT), Google Gemini Live, ElevenLabs (TTS, optional)
- **Auth**: Simple username/password with Express sessions

## Prerequisites

- **Node.js** 20 or higher
- **npm** or **yarn**
- **API Keys**:
  - [Deepgram API Key](https://deepgram.com/) (required for transcription)
  - [Google AI API Key](https://ai.google.dev/) (required for AI Co-Host)
  - [OpenAI API Key](https://platform.openai.com/) (required for GPT features)
  - [ElevenLabs API Key](https://elevenlabs.io/) (optional, for voice synthesis)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd co-host-local
npm install
```

### 2. Configure Environment

Copy the example environment file and fill in your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Authentication & Security
SESSION_SECRET=your_random_secret_here_use_openssl_rand_base64_32
AUTH_USER=admin
AUTH_PASSWORD=your_secure_password_here

# Speech-to-Text (STT) Provider
DEEPGRAM_API_KEY=dg_your_key_here

# AI Providers
OPENAI_API_KEY=sk-your_key_here
GOOGLE_AI_API_KEY=your_google_ai_key_here

# Text-to-Speech (Optional)
ELEVENLABS_API_KEY=your_elevenlabs_key_here
```

**Security Notes**:
- Generate a strong `SESSION_SECRET` using: `openssl rand -base64 32`
- Change the default `AUTH_PASSWORD` to something secure
- Never commit your `.env` file to version control

### 3. Initialize Database

The SQLite database will be created automatically on first run. To manually push schema changes:

```bash
npm run db:push
```

Database file location: `./data/cohost.db`

### 4. Start Development Server

Run both the backend and frontend in development mode:

```bash
# Terminal 1: Start backend (Express server on port 5001)
npm run dev

# Terminal 2: Start frontend (Vite dev server on port 5000)
npm run dev:client
```

Open your browser to: **http://localhost:5000**

Login with the credentials you set in `.env`:
- **Username**: Value of `AUTH_USER` (default: `admin`)
- **Password**: Value of `AUTH_PASSWORD`

## Production Build

Build for production:

```bash
npm run build
```

This creates optimized bundles in the `./dist` directory.

Start the production server:

```bash
npm start
```

The server will run on the port specified in your `.env` (default: 5000).

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend server (development mode, port 5001) |
| `npm run dev:client` | Start Vite dev server (port 5000) |
| `npm run build` | Build client + server for production → `/dist` |
| `npm start` | Run production server |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push Drizzle schema changes to SQLite |

## Architecture

### Project Structure

```
co-host-local/
├── client/src/              # React frontend
│   ├── pages/              # VoiceAgent, CoHost, Sources, Shows, Admin, Login
│   ├── hooks/              # useWebSocketAudio, useCoHostWebSocket, use-auth
│   ├── components/ui/      # shadcn/ui components (Radix-based)
│   └── index.css           # CSS design system with custom properties
├── server/
│   ├── index.ts            # Express setup, server entry
│   ├── routes.ts           # All API routes + WebSocket handlers
│   ├── storage.ts          # Database CRUD operations (IStorage interface)
│   ├── db.ts               # SQLite connection via Drizzle
│   └── auth.ts             # Authentication middleware
├── shared/
│   ├── schema.ts           # Drizzle ORM schema (all tables, Zod schemas)
│   └── models/             # Shared TypeScript types
├── data/
│   └── cohost.db           # SQLite database (auto-created)
└── migrations/             # Database migrations
```

### WebSocket Endpoints

- **`/ws/audio`** - Audio streaming → Deepgram transcription (proxied)
- **`/ws/cohost`** - AI Co-Host ↔ Gemini Live API bridge

### API Routes

All REST endpoints are under `/api/*` and protected by authentication middleware:

- `POST /api/login` - Authenticate user
- `POST /api/logout` - Destroy session
- `GET /api/user` - Get current user info
- `GET /api/shows` - List podcast episodes
- `POST /api/shows` - Create new episode
- `GET /api/sources` - List document sources
- `POST /api/sources` - Upload document source
- `GET /api/quick-actions` - List AI prompt templates
- `POST /api/quick-actions` - Create custom prompt

Admin routes (protected by `isAdmin` middleware):
- `GET /api/admin/system-prompts` - Manage system prompts
- `POST /api/admin/system-prompts` - Create system prompt

### Database Schema

Key tables (see `shared/schema.ts` for full definitions):

- **`users`** - User accounts (currently single-user)
- **`sessions`** - Express session storage (for WebSocket auth)
- **`shows`** - Podcast episodes
- **`transcriptSegments`** - Transcription text with speaker info
- **`sources`** - Documents for Co-Host context (PDF, JSON, text)
- **`systemPrompts`** - Saved AI prompts
- **`quickActions`** - User and system prompt templates

### Authentication

- **Type**: Simple username/password
- **Storage**: Express sessions in SQLite
- **Config**: `AUTH_USER` and `AUTH_PASSWORD` in `.env`
- **Session Management**: memorystore in-memory cache, backed by SQLite for WebSocket auth
- **Protection**: All `/api/*` routes and WebSocket connections require authentication

### Design System

The app uses a professional CSS design system with custom properties for easy theming:

- **Colors**: Semantic tokens (`--color-primary`, `--color-background`, `--color-foreground`, etc.)
- **Typography**: Font sizes, weights, line heights (`--font-size-*`, `--font-weight-*`)
- **Spacing**: Consistent scale (`--spacing-xs` to `--spacing-3xl`)
- **Shadows**: Depth system (`--shadow-sm`, `--shadow-md`, `--shadow-lg`)
- **Default Theme**: Dark mode with slate colors and Kuble blue primary (#0D6EFD)

Customize the theme by editing `client/src/index.css`.

## Features Overview

### Voice Agent

Real-time audio transcription with speaker diarization. Stream audio from your microphone and see live transcripts.

### AI Co-Host

Interactive voice conversation with an AI co-host powered by Google Gemini 2.5 Flash Live API. The co-host can:
- Access conversation transcripts
- Reference uploaded document sources
- Respond to voice queries in real-time
- Use custom system prompts

### Sources

Upload and manage context documents for the AI co-host:
- **PDF**: Automatic text extraction
- **JSON**: Structured data
- **Text**: Plain text documents

### Shows

Organize podcast episodes with metadata:
- Episode title and description
- Guest information
- Recording date
- Linked transcripts

### Quick Actions

Pre-configured and custom AI prompts for common tasks:
- System defaults (built-in)
- User-created custom actions

## Troubleshooting

### Database Issues

If you encounter database errors, try recreating the database:

```bash
rm -rf data/cohost.db
npm run db:push
```

### Port Conflicts

If ports 5000 or 5001 are in use, update the `PORT` variable in `.env` and adjust Vite config in `vite.config.ts`.

### WebSocket Connection Fails

1. Ensure both backend (`npm run dev`) and frontend (`npm run dev:client`) are running
2. Check that you're logged in (session cookies required for WebSocket auth)
3. Verify API keys are set correctly in `.env`

### TypeScript Errors

Run type checking:

```bash
npm run check
```

## Contributing

This is a local deployment tool. For contributions or issues, please contact the maintainer.

## License

MIT

## Support

For questions or issues, please refer to the project documentation or contact the development team.
