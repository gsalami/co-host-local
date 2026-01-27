# Neural Voice Agent

A real-time voice intelligence interface built with React. This application captures audio, streams it to a speech-to-text service, maintains a semantic context of the conversation, and allows users to query an LLM based on that context.

## Features

- **Real-time Transcription**: Visual feedback for streaming speech-to-text.
- **Context Awareness**: Maintains "Top of Mind" (recent context) and "Long-term Memory" (vector retrieval).
- **Voice Intelligence**: Query the agent about the ongoing conversation.
- **Privacy First**: Explicit consent handling and secure API key management.

## Setup

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables (see `.env.example`).
4. Start the development server:
   ```bash
   npm run dev
   ```

## Architecture (Planned/Mockup)

- **Frontend**: React + Vite + Tailwind + Framer Motion.
- **Audio**: Web Audio API streams raw PCM data via WebSocket.
- **STT**: Deepgram Nova 2 (Streaming).
- **Memory**: SQLite (conversation logs) + PGVector/ChromaDB (embeddings).
- **LLM**: OpenAI GPT-4o for answering queries.

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys.
