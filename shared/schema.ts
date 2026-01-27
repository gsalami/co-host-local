import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth schema (users and sessions from Replit Auth)
export * from "./models/auth";

// Shows - groups transcript segments by recording session
export const shows = pgTable("shows", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  userId: varchar("user_id"), // Owner of the show
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Transcript segments - stores all final transcription segments
export const transcriptSegments = pgTable("transcript_segments", {
  id: serial("id").primaryKey(),
  showId: integer("show_id").references(() => shows.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  speaker: integer("speaker"),
  timestamp: timestamp("timestamp").default(sql`CURRENT_TIMESTAMP`).notNull(),
  metadata: text("metadata"),
});

// Schemas
export const insertShowSchema = createInsertSchema(shows).omit({
  id: true,
  createdAt: true,
});

export const insertTranscriptSegmentSchema = createInsertSchema(transcriptSegments).omit({
  id: true,
  timestamp: true,
});

// Types
export type Show = typeof shows.$inferSelect;
export type InsertShow = z.infer<typeof insertShowSchema>;

export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type InsertTranscriptSegment = z.infer<typeof insertTranscriptSegmentSchema>;

// System Prompts for Co-Host
export const systemPrompts = pgTable("system_prompts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"), // Owner of the prompt
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSystemPromptSchema = createInsertSchema(systemPrompts).omit({
  id: true,
  createdAt: true,
});

export type SystemPrompt = typeof systemPrompts.$inferSelect;
export type InsertSystemPrompt = z.infer<typeof insertSystemPromptSchema>;

// Speaker Mappings - assigns names to speaker IDs per show
export const speakerMappings = pgTable("speaker_mappings", {
  id: serial("id").primaryKey(),
  showId: integer("show_id").notNull().references(() => shows.id, { onDelete: "cascade" }),
  speakerIndex: integer("speaker_index").notNull(),
  displayName: text("display_name").notNull(),
});

export const insertSpeakerMappingSchema = createInsertSchema(speakerMappings).omit({
  id: true,
});

export type SpeakerMapping = typeof speakerMappings.$inferSelect;
export type InsertSpeakerMapping = z.infer<typeof insertSpeakerMappingSchema>;

// Sources - reusable documents for Co-Host context
export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"), // Owner of the source
  title: text("title").notNull(),
  type: text("type").notNull(), // 'pdf', 'json', 'text', 'markdown'
  mimeType: text("mime_type").notNull(),
  originalFilename: text("original_filename").notNull(),
  textContent: text("text_content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;

// Pronunciation Vocabulary - words to pronounce in specific language
export const pronunciationVocab = pgTable("pronunciation_vocab", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"), // Owner of the vocab entry
  word: text("word").notNull(),
  language: text("language").notNull().default("en"), // 'en' for English, 'de' for German
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPronunciationVocabSchema = createInsertSchema(pronunciationVocab).omit({
  id: true,
  createdAt: true,
});

export type PronunciationVocab = typeof pronunciationVocab.$inferSelect;
export type InsertPronunciationVocab = z.infer<typeof insertPronunciationVocabSchema>;

// Show Summaries - AI-generated summaries for each show
export const showSummaries = pgTable("show_summaries", {
  id: serial("id").primaryKey(),
  showId: integer("show_id").notNull().references(() => shows.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  tokenCount: integer("token_count").notNull(),
  segmentCount: integer("segment_count").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertShowSummarySchema = createInsertSchema(showSummaries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ShowSummary = typeof showSummaries.$inferSelect;
export type InsertShowSummary = z.infer<typeof insertShowSummarySchema>;

// Transcript Chunks - grouped segments with embeddings for semantic search
export const transcriptChunks = pgTable("transcript_chunks", {
  id: serial("id").primaryKey(),
  showId: integer("show_id").notNull().references(() => shows.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  startSegmentId: integer("start_segment_id").notNull(),
  endSegmentId: integer("end_segment_id").notNull(),
  embedding: text("embedding"), // JSON array of floats
  tokenCount: integer("token_count").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertTranscriptChunkSchema = createInsertSchema(transcriptChunks).omit({
  id: true,
  createdAt: true,
});

export type TranscriptChunk = typeof transcriptChunks.$inferSelect;
export type InsertTranscriptChunk = z.infer<typeof insertTranscriptChunkSchema>;

// Source Chunks - chunked source documents with embeddings for semantic search
export const sourceChunks = pgTable("source_chunks", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  embedding: text("embedding"), // JSON array of floats
  tokenCount: integer("token_count").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertSourceChunkSchema = createInsertSchema(sourceChunks).omit({
  id: true,
  createdAt: true,
});

export type SourceChunk = typeof sourceChunks.$inferSelect;
export type InsertSourceChunk = z.infer<typeof insertSourceChunkSchema>;

// Quick Actions - customizable quick action buttons for Co-Host
// userId NULL = system default, userId set = user-created
export const quickActions = pgTable("quick_actions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"), // NULL for system defaults, set for user-created
  label: text("label").notNull(), // Button label shown in UI
  prompt: text("prompt").notNull(), // The prompt text sent to AI
  sortOrder: integer("sort_order").notNull().default(0), // For custom ordering
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertQuickActionSchema = createInsertSchema(quickActions).omit({
  id: true,
  createdAt: true,
});

export type QuickAction = typeof quickActions.$inferSelect;
export type InsertQuickAction = z.infer<typeof insertQuickActionSchema>;

// User Quick Action Selections - tracks which actions each user has enabled
export const userQuickActionSelections = pgTable("user_quick_action_selections", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  quickActionId: integer("quick_action_id").notNull().references(() => quickActions.id, { onDelete: "cascade" }),
  isEnabled: integer("is_enabled").notNull().default(1), // 1 = enabled, 0 = disabled
  sortOrder: integer("sort_order").notNull().default(0), // User's custom sort order
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserQuickActionSelectionSchema = createInsertSchema(userQuickActionSelections).omit({
  id: true,
  createdAt: true,
});

export type UserQuickActionSelection = typeof userQuickActionSelections.$inferSelect;
export type InsertUserQuickActionSelection = z.infer<typeof insertUserQuickActionSelectionSchema>;
