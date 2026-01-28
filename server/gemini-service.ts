import { GoogleGenAI } from "@google/genai";

const googleAiApiKey = process.env.GOOGLE_AI_API_KEY;

if (!googleAiApiKey) {
  console.warn("GOOGLE_AI_API_KEY not set - Gemini services will not work");
}

const ai = googleAiApiKey ? new GoogleGenAI({ apiKey: googleAiApiKey }) : null;

const SUMMARY_MODEL = "gemini-1.5-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";

export interface SummaryResult {
  summary: string;
  tokenCount: number;
}

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

export async function generateSummary(
  text: string,
  maxTokens: number = 6000
): Promise<SummaryResult> {
  if (!ai) {
    throw new Error("Gemini API not configured");
  }

  const response = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Du bist ein Experte für das Zusammenfassen von Podcast-Transkripten.

Erstelle eine strukturierte Zusammenfassung des folgenden Transkripts. Die Zusammenfassung sollte:
1. Die Hauptthemen und Kernaussagen erfassen
2. Wichtige Namen, Orte, Daten und Fakten beibehalten
3. Die Sprecher-Perspektiven unterscheiden (falls erkennbar)
4. Maximal ${maxTokens} Tokens lang sein
5. In der gleichen Sprache wie das Original sein

TRANSKRIPT:
${text}

ZUSAMMENFASSUNG:`
          }
        ]
      }
    ],
    config: {
      maxOutputTokens: maxTokens,
      temperature: 0.3
    }
  });

  const summary = response.text || "";
  
  let tokenCount = Math.ceil(summary.length / 4);
  try {
    const tokenCountResponse = await ai.models.countTokens({
      model: SUMMARY_MODEL,
      contents: [{ role: "user", parts: [{ text: summary }] }]
    });
    tokenCount = tokenCountResponse.totalTokens || tokenCount;
  } catch (e) {
    console.warn("Token counting failed, using estimate:", e);
  }

  return {
    summary,
    tokenCount
  };
}

export async function generateChunkSummary(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API not configured");
  }

  const response = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Fasse diesen Abschnitt (${chunkIndex + 1}/${totalChunks}) eines Podcast-Transkripts kurz zusammen.
Behalte wichtige Fakten, Namen und Kernaussagen bei. Maximal 500 Wörter.

ABSCHNITT:
${chunkText}

ZUSAMMENFASSUNG:`
          }
        ]
      }
    ],
    config: {
      maxOutputTokens: 1000,
      temperature: 0.3
    }
  });

  return response.text || "";
}

export async function aggregateSummaries(
  summaries: string[]
): Promise<SummaryResult> {
  if (!ai) {
    throw new Error("Gemini API not configured");
  }

  const combinedSummaries = summaries.map((s, i) => `[Teil ${i + 1}]\n${s}`).join("\n\n");

  const response = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Erstelle eine kohärente Gesamtzusammenfassung aus diesen Teil-Zusammenfassungen eines Podcasts.
Die finale Zusammenfassung sollte:
1. Alle wichtigen Themen und Fakten enthalten
2. Eine klare Struktur haben
3. Redundanzen vermeiden
4. Maximal 6000 Tokens lang sein

TEIL-ZUSAMMENFASSUNGEN:
${combinedSummaries}

GESAMTZUSAMMENFASSUNG:`
          }
        ]
      }
    ],
    config: {
      maxOutputTokens: 6000,
      temperature: 0.3
    }
  });

  const summary = response.text || "";
  
  let tokenCount = Math.ceil(summary.length / 4);
  try {
    const tokenCountResponse = await ai.models.countTokens({
      model: SUMMARY_MODEL,
      contents: [{ role: "user", parts: [{ text: summary }] }]
    });
    tokenCount = tokenCountResponse.totalTokens || tokenCount;
  } catch (e) {
    console.warn("Token counting failed, using estimate:", e);
  }

  return {
    summary,
    tokenCount
  };
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!ai) {
    throw new Error("Gemini API not configured");
  }

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ role: "user", parts: [{ text }] }]
  });

  const embedding = response.embeddings?.[0]?.values || [];
  
  let tokenCount = Math.ceil(text.length / 4);
  try {
    const tokenCountResponse = await ai.models.countTokens({
      model: SUMMARY_MODEL,
      contents: [{ role: "user", parts: [{ text }] }]
    });
    tokenCount = tokenCountResponse.totalTokens || tokenCount;
  } catch (e) {
    console.warn("Token counting failed, using estimate");
  }

  return {
    embedding,
    tokenCount
  };
}

export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  
  for (const text of texts) {
    const result = await generateEmbedding(text);
    results.push(result);
  }
  
  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

export async function countTokens(text: string): Promise<number> {
  if (!ai) {
    return Math.ceil(text.length / 4);
  }

  try {
    const response = await ai.models.countTokens({
      model: SUMMARY_MODEL,
      contents: [{ role: "user", parts: [{ text }] }]
    });
    return response.totalTokens || Math.ceil(text.length / 4);
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function splitIntoChunks(
  text: string,
  targetChunkSize: number = 450,
  overlapSize: number = 100
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  const wordsPerToken = 0.75;
  const wordsPerChunk = Math.floor(targetChunkSize * wordsPerToken);
  const overlapWords = Math.floor(overlapSize * wordsPerToken);
  
  let startIndex = 0;
  
  while (startIndex < words.length) {
    const endIndex = Math.min(startIndex + wordsPerChunk, words.length);
    const chunk = words.slice(startIndex, endIndex).join(" ");
    chunks.push(chunk);
    
    if (endIndex >= words.length) break;
    
    startIndex = endIndex - overlapWords;
    if (startIndex <= chunks.length * (wordsPerChunk - overlapWords)) {
      startIndex = endIndex - overlapWords;
    }
  }
  
  return chunks;
}

export interface ChunkWithScore {
  id: number;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  score: number;
}

export async function retrieveRelevantChunks(
  query: string,
  chunks: Array<{ id: number; chunkIndex: number; text: string; tokenCount: number; embedding: string | null }>,
  topK: number = 6,
  maxTokens: number = 3000
): Promise<ChunkWithScore[]> {
  if (chunks.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);
  
  const scoredChunks: ChunkWithScore[] = chunks
    .filter(c => c.embedding)
    .map(chunk => {
      const chunkEmbedding = JSON.parse(chunk.embedding!) as number[];
      const score = cosineSimilarity(queryEmbedding.embedding, chunkEmbedding);
      return {
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        score
      };
    })
    .sort((a, b) => b.score - a.score);

  const selected: ChunkWithScore[] = [];
  let totalTokens = 0;

  for (const chunk of scoredChunks) {
    if (selected.length >= topK) break;
    if (totalTokens + chunk.tokenCount > maxTokens) continue;
    
    selected.push(chunk);
    totalTokens += chunk.tokenCount;
  }

  return selected.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export interface OptimizedContext {
  summary: string;
  summaryTokens: number;
  relevantChunks: string[];
  chunkTokens: number;
  totalTokens: number;
}

export async function buildOptimizedContext(
  summary: string | null,
  chunks: Array<{ id: number; chunkIndex: number; text: string; tokenCount: number; embedding: string | null }>,
  recentTranscript: string = "",
  maxTotalTokens: number = 10000
): Promise<OptimizedContext> {
  const summaryText = summary || "";
  const summaryTokens = summaryText ? await countTokens(summaryText) : 0;
  
  const recentTokens = recentTranscript ? await countTokens(recentTranscript) : 0;
  
  const chunkBudget = maxTotalTokens - summaryTokens - recentTokens - 500;
  
  let selectedChunks: ChunkWithScore[] = [];
  if (chunks.length > 0 && chunkBudget > 0) {
    selectedChunks = await retrieveRelevantChunks(
      recentTranscript || summaryText,
      chunks,
      6,
      Math.max(0, chunkBudget)
    );
  }

  const chunkTexts = selectedChunks.map(c => c.text);
  const chunkTokens = selectedChunks.reduce((sum, c) => sum + c.tokenCount, 0);

  return {
    summary: summaryText,
    summaryTokens,
    relevantChunks: chunkTexts,
    chunkTokens,
    totalTokens: summaryTokens + chunkTokens + recentTokens
  };
}

// Source Chunking - splits source text into chunks for embedding
const SOURCE_CHUNK_TARGET_TOKENS = 500;
const SOURCE_CHUNK_OVERLAP_TOKENS = 50;

export interface SourceChunkData {
  chunkIndex: number;
  text: string;
  tokenCount: number;
}

export async function chunkSourceText(text: string): Promise<SourceChunkData[]> {
  const totalTokens = await countTokens(text);
  
  if (totalTokens <= SOURCE_CHUNK_TARGET_TOKENS) {
    return [{
      chunkIndex: 0,
      text,
      tokenCount: totalTokens
    }];
  }

  const chunks: SourceChunkData[] = [];
  const words = text.split(/\s+/);
  const avgTokensPerWord = totalTokens / words.length;
  const wordsPerChunk = Math.floor(SOURCE_CHUNK_TARGET_TOKENS / avgTokensPerWord);
  const overlapWords = Math.floor(SOURCE_CHUNK_OVERLAP_TOKENS / avgTokensPerWord);
  
  let startIdx = 0;
  let chunkIndex = 0;

  while (startIdx < words.length) {
    const endIdx = Math.min(startIdx + wordsPerChunk, words.length);
    const chunkWords = words.slice(startIdx, endIdx);
    const chunkText = chunkWords.join(" ");
    const tokenCount = await countTokens(chunkText);
    
    chunks.push({
      chunkIndex,
      text: chunkText,
      tokenCount
    });

    startIdx = endIdx - overlapWords;
    if (startIdx >= words.length - overlapWords) {
      break;
    }
    chunkIndex++;
  }

  return chunks;
}

export async function retrieveRelevantSourceChunks(
  query: string,
  chunks: Array<{ id: number; chunkIndex: number; text: string; tokenCount: number; embedding: string | null; sourceId: number }>,
  topK: number = 5,
  maxTokens: number = 4000
): Promise<Array<{ id: number; sourceId: number; text: string; score: number; tokenCount: number }>> {
  if (chunks.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);
  
  const scored = chunks
    .filter(c => c.embedding)
    .map(chunk => {
      const chunkEmbedding = JSON.parse(chunk.embedding!) as number[];
      const score = cosineSimilarity(queryEmbedding.embedding, chunkEmbedding);
      return { ...chunk, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected: typeof scored = [];
  let totalTokens = 0;

  for (const chunk of scored) {
    if (selected.length >= topK) break;
    if (totalTokens + chunk.tokenCount > maxTokens) continue;
    selected.push(chunk);
    totalTokens += chunk.tokenCount;
  }

  return selected.map(c => ({
    id: c.id,
    sourceId: c.sourceId,
    text: c.text,
    score: c.score,
    tokenCount: c.tokenCount
  }));
}
