import { db } from "./db";
import { 
  type User, 
  type UpsertUser, 
  type TranscriptSegment,
  type InsertTranscriptSegment,
  type Show,
  type InsertShow,
  type SystemPrompt,
  type InsertSystemPrompt,
  type SpeakerMapping,
  type InsertSpeakerMapping,
  type Source,
  type InsertSource,
  type PronunciationVocab,
  type InsertPronunciationVocab,
  type ShowSummary,
  type InsertShowSummary,
  type TranscriptChunk,
  type InsertTranscriptChunk,
  type SourceChunk,
  type InsertSourceChunk,
  type UsageRecord,
  type InsertUsageRecord,
  type UserCredits,
  type InsertUserCredits,
  type CreditPurchase,
  type InsertCreditPurchase,
  type QuickAction,
  type InsertQuickAction,
  type UserQuickActionSelection,
  users,
  transcriptSegments,
  shows,
  systemPrompts,
  speakerMappings,
  sources,
  pronunciationVocab,
  showSummaries,
  transcriptChunks,
  sourceChunks,
  usageRecords,
  userCredits,
  creditPurchases,
  quickActions,
  userQuickActionSelections
} from "@shared/schema";
import { eq, desc, sql, and, inArray, isNull, or } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Show methods
  createShow(show: InsertShow): Promise<Show>;
  getShows(userId: string): Promise<Show[]>;
  getShow(id: number, userId?: string): Promise<Show | undefined>;
  updateShow(id: number, title: string, userId: string): Promise<Show | undefined>;
  deleteShow(id: number, userId: string): Promise<void>;
  
  // Transcript methods
  createTranscriptSegment(segment: InsertTranscriptSegment): Promise<TranscriptSegment>;
  getRecentTranscriptSegments(limit: number, showId?: number): Promise<TranscriptSegment[]>;
  getAllTranscriptSegments(showId?: number): Promise<TranscriptSegment[]>;
  searchTranscriptSegments(query: string, showId?: number): Promise<TranscriptSegment[]>;
  
  // System Prompt methods
  createSystemPrompt(prompt: InsertSystemPrompt): Promise<SystemPrompt>;
  getSystemPrompts(userId: string): Promise<SystemPrompt[]>;
  getSystemPrompt(id: number, userId?: string): Promise<SystemPrompt | undefined>;
  updateSystemPrompt(id: number, name: string, prompt: string, userId: string): Promise<SystemPrompt | undefined>;
  deleteSystemPrompt(id: number, userId: string): Promise<void>;
  
  // Speaker Mapping methods
  getSpeakerMappings(showId: number): Promise<SpeakerMapping[]>;
  setSpeakerMapping(showId: number, speakerIndex: number, displayName: string): Promise<SpeakerMapping>;
  deleteSpeakerMapping(showId: number, speakerIndex: number): Promise<void>;
  
  // Source methods
  createSource(source: InsertSource): Promise<Source>;
  getSources(userId: string): Promise<Source[]>;
  getSource(id: number, userId?: string): Promise<Source | undefined>;
  getSourcesByIds(ids: number[], userId: string): Promise<Source[]>;
  updateSource(id: number, title: string, textContent: string, userId: string): Promise<Source | undefined>;
  deleteSource(id: number, userId: string): Promise<void>;
  
  // Pronunciation Vocabulary methods
  getPronunciationVocab(userId: string): Promise<PronunciationVocab[]>;
  createPronunciationVocab(vocab: InsertPronunciationVocab): Promise<PronunciationVocab>;
  deletePronunciationVocab(id: number, userId: string): Promise<void>;
  
  // Show Summary methods
  getShowSummary(showId: number): Promise<ShowSummary | undefined>;
  createOrUpdateShowSummary(summary: InsertShowSummary): Promise<ShowSummary>;
  deleteShowSummary(showId: number): Promise<void>;
  
  // Transcript Chunk methods
  getTranscriptChunks(showId: number): Promise<TranscriptChunk[]>;
  createTranscriptChunk(chunk: InsertTranscriptChunk): Promise<TranscriptChunk>;
  deleteTranscriptChunks(showId: number): Promise<void>;
  updateChunkEmbedding(chunkId: number, embedding: string): Promise<void>;
  getLastChunkedSegmentId(showId: number): Promise<number | null>;
  getNextChunkIndex(showId: number): Promise<number>;
  getSegmentsAfter(showId: number, afterId: number): Promise<TranscriptSegment[]>;
  
  // Source Chunk methods
  getSourceChunks(sourceId: number): Promise<SourceChunk[]>;
  getAllSourceChunks(): Promise<SourceChunk[]>;
  createSourceChunk(chunk: InsertSourceChunk): Promise<SourceChunk>;
  deleteSourceChunks(sourceId: number): Promise<void>;
  updateSourceChunkEmbedding(chunkId: number, embedding: string): Promise<void>;
  
  // Usage Record methods
  createUsageRecord(record: InsertUsageRecord): Promise<UsageRecord>;
  getUsageRecords(): Promise<UsageRecord[]>;
  getUsageStats(showId?: number | null): Promise<{ transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>;
  getUsageByDay(days: number, showId?: number | null): Promise<Array<{ date: string; transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>>;
  getUsageByShow(days: number): Promise<Array<{ showId: number | null; showTitle: string | null; transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>>;
  
  // Admin methods
  getAllUsers(): Promise<User[]>;
  updateUserRole(userId: string, role: string): Promise<User | undefined>;
  getUsageStatsByUser(): Promise<Array<{ userId: string | null; email: string | null; firstName: string | null; lastName: string | null; transcriptSeconds: number; voiceSeconds: number }>>;
  getUsageByUser(days: number): Promise<Array<{ userId: string | null; email: string | null; firstName: string | null; lastName: string | null; date: string; transcriptSeconds: number; voiceSeconds: number }>>;
  
  // User preferences
  updateVoicePreference(userId: string, voicePreference: string): Promise<User | undefined>;
  
  // User Credits methods
  getUserCredits(userId: string): Promise<UserCredits | undefined>;
  createUserCredits(userId: string, transcriptSeconds?: number, voiceSeconds?: number): Promise<UserCredits>;
  addCredits(userId: string, transcriptSeconds: number, voiceSeconds: number): Promise<UserCredits>;
  deductCredits(userId: string, transcriptSeconds: number, voiceSeconds: number): Promise<UserCredits | null>;
  
  // Credit Purchase methods
  createCreditPurchase(purchase: InsertCreditPurchase): Promise<CreditPurchase>;
  getCreditPurchase(stripeSessionId: string): Promise<CreditPurchase | undefined>;
  updateCreditPurchaseStatus(stripeSessionId: string, status: string, paymentIntentId?: string): Promise<CreditPurchase | undefined>;
  getUserCreditPurchases(userId: string): Promise<CreditPurchase[]>;
  getAllCreditPurchases(): Promise<CreditPurchase[]>;
  updateCreditPurchaseStatusById(purchaseId: number, status: string): Promise<CreditPurchase | undefined>;
  
  // Quick Action methods
  getAllQuickActions(): Promise<QuickAction[]>; // All actions (system + all users)
  getSystemQuickActions(): Promise<QuickAction[]>; // System defaults only (userId NULL)
  getUserQuickActions(userId: string): Promise<QuickAction[]>; // User's own actions only
  getQuickActions(userId: string): Promise<QuickAction[]>; // For backwards compat - user's own
  createQuickAction(action: InsertQuickAction): Promise<QuickAction>;
  updateQuickAction(id: number, label: string, prompt: string, sortOrder?: number): Promise<QuickAction | undefined>;
  deleteQuickAction(id: number): Promise<void>;
  
  // Quick Action Selection methods
  getUserQuickActionSelections(userId: string): Promise<{ quickAction: QuickAction; isEnabled: boolean; sortOrder: number }[]>;
  setQuickActionSelection(userId: string, quickActionId: number, isEnabled: boolean, sortOrder?: number): Promise<void>;
  initializeUserSelections(userId: string): Promise<void>; // Create default selections for new user
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        }
      })
      .returning();
    return user;
  }

  // Show methods
  async createShow(show: InsertShow): Promise<Show> {
    const [created] = await db.insert(shows).values(show).returning();
    return created;
  }

  async getShows(userId: string): Promise<Show[]> {
    return db.select().from(shows).where(eq(shows.userId, userId)).orderBy(desc(shows.createdAt));
  }

  async getShow(id: number, userId?: string): Promise<Show | undefined> {
    const [show] = await db.select().from(shows).where(eq(shows.id, id));
    if (show && userId && show.userId !== userId) {
      return undefined; // User doesn't own this show
    }
    return show;
  }

  async updateShow(id: number, title: string, userId: string): Promise<Show | undefined> {
    const [updated] = await db.update(shows).set({ title })
      .where(and(eq(shows.id, id), eq(shows.userId, userId)))
      .returning();
    return updated;
  }

  async deleteShow(id: number, userId: string): Promise<void> {
    await db.delete(shows).where(and(eq(shows.id, id), eq(shows.userId, userId)));
  }

  // Transcript methods
  async createTranscriptSegment(segment: InsertTranscriptSegment): Promise<TranscriptSegment> {
    const [created] = await db.insert(transcriptSegments).values(segment).returning();
    return created;
  }

  async getRecentTranscriptSegments(limit: number = 10, showId?: number): Promise<TranscriptSegment[]> {
    if (showId) {
      return db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.showId, showId))
        .orderBy(desc(transcriptSegments.timestamp))
        .limit(limit);
    }
    return db
      .select()
      .from(transcriptSegments)
      .orderBy(desc(transcriptSegments.timestamp))
      .limit(limit);
  }

  async getAllTranscriptSegments(showId?: number): Promise<TranscriptSegment[]> {
    if (showId) {
      return db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.showId, showId))
        .orderBy(transcriptSegments.timestamp);
    }
    return db
      .select()
      .from(transcriptSegments)
      .orderBy(transcriptSegments.timestamp);
  }

  async searchTranscriptSegments(query: string, showId?: number): Promise<TranscriptSegment[]> {
    if (showId) {
      return db
        .select()
        .from(transcriptSegments)
        .where(sql`${transcriptSegments.showId} = ${showId} AND ${transcriptSegments.text} ILIKE ${'%' + query + '%'}`)
        .orderBy(desc(transcriptSegments.timestamp))
        .limit(3000);
    }
    return db
      .select()
      .from(transcriptSegments)
      .where(sql`${transcriptSegments.text} ILIKE ${'%' + query + '%'}`)
      .orderBy(desc(transcriptSegments.timestamp))
      .limit(3000);
  }

  // System Prompt methods
  async createSystemPrompt(prompt: InsertSystemPrompt): Promise<SystemPrompt> {
    const [created] = await db.insert(systemPrompts).values(prompt).returning();
    return created;
  }

  async getSystemPrompts(userId: string): Promise<SystemPrompt[]> {
    return db.select().from(systemPrompts).where(eq(systemPrompts.userId, userId)).orderBy(desc(systemPrompts.createdAt));
  }

  async getSystemPrompt(id: number, userId?: string): Promise<SystemPrompt | undefined> {
    const [prompt] = await db.select().from(systemPrompts).where(eq(systemPrompts.id, id));
    if (prompt && userId && prompt.userId !== userId) {
      return undefined; // User doesn't own this prompt
    }
    return prompt;
  }

  async updateSystemPrompt(id: number, name: string, prompt: string, userId: string): Promise<SystemPrompt | undefined> {
    const [updated] = await db.update(systemPrompts).set({ name, prompt })
      .where(and(eq(systemPrompts.id, id), eq(systemPrompts.userId, userId)))
      .returning();
    return updated;
  }

  async deleteSystemPrompt(id: number, userId: string): Promise<void> {
    await db.delete(systemPrompts).where(and(eq(systemPrompts.id, id), eq(systemPrompts.userId, userId)));
  }

  // Speaker Mapping methods
  async getSpeakerMappings(showId: number): Promise<SpeakerMapping[]> {
    return db.select().from(speakerMappings).where(eq(speakerMappings.showId, showId)).orderBy(speakerMappings.speakerIndex);
  }

  async setSpeakerMapping(showId: number, speakerIndex: number, displayName: string): Promise<SpeakerMapping> {
    const existing = await db.select().from(speakerMappings)
      .where(and(eq(speakerMappings.showId, showId), eq(speakerMappings.speakerIndex, speakerIndex)));
    
    if (existing.length > 0) {
      const [updated] = await db.update(speakerMappings)
        .set({ displayName })
        .where(and(eq(speakerMappings.showId, showId), eq(speakerMappings.speakerIndex, speakerIndex)))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(speakerMappings)
        .values({ showId, speakerIndex, displayName })
        .returning();
      return created;
    }
  }

  async deleteSpeakerMapping(showId: number, speakerIndex: number): Promise<void> {
    await db.delete(speakerMappings)
      .where(and(eq(speakerMappings.showId, showId), eq(speakerMappings.speakerIndex, speakerIndex)));
  }

  // Source methods
  async createSource(source: InsertSource): Promise<Source> {
    const [created] = await db.insert(sources).values(source).returning();
    return created;
  }

  async getSources(userId: string): Promise<Source[]> {
    return db.select().from(sources).where(eq(sources.userId, userId)).orderBy(desc(sources.createdAt));
  }

  async getSource(id: number, userId?: string): Promise<Source | undefined> {
    const [source] = await db.select().from(sources).where(eq(sources.id, id));
    if (source && userId && source.userId !== userId) {
      return undefined; // User doesn't own this source
    }
    return source;
  }

  async getSourcesByIds(ids: number[], userId: string): Promise<Source[]> {
    if (ids.length === 0) return [];
    return db.select().from(sources).where(and(inArray(sources.id, ids), eq(sources.userId, userId)));
  }

  async updateSource(id: number, title: string, textContent: string, userId: string): Promise<Source | undefined> {
    const [updated] = await db.update(sources)
      .set({ title, textContent, updatedAt: new Date() })
      .where(and(eq(sources.id, id), eq(sources.userId, userId)))
      .returning();
    return updated;
  }

  async deleteSource(id: number, userId: string): Promise<void> {
    await db.delete(sources).where(and(eq(sources.id, id), eq(sources.userId, userId)));
  }

  // Pronunciation Vocabulary methods
  async getPronunciationVocab(userId: string): Promise<PronunciationVocab[]> {
    return db.select().from(pronunciationVocab).where(eq(pronunciationVocab.userId, userId)).orderBy(pronunciationVocab.word);
  }

  async createPronunciationVocab(vocab: InsertPronunciationVocab): Promise<PronunciationVocab> {
    const [created] = await db.insert(pronunciationVocab).values(vocab).returning();
    return created;
  }

  async deletePronunciationVocab(id: number, userId: string): Promise<void> {
    await db.delete(pronunciationVocab).where(and(eq(pronunciationVocab.id, id), eq(pronunciationVocab.userId, userId)));
  }

  // Show Summary methods
  async getShowSummary(showId: number): Promise<ShowSummary | undefined> {
    const [summary] = await db.select().from(showSummaries).where(eq(showSummaries.showId, showId));
    return summary;
  }

  async createOrUpdateShowSummary(summary: InsertShowSummary): Promise<ShowSummary> {
    const existing = await this.getShowSummary(summary.showId);
    if (existing) {
      const [updated] = await db.update(showSummaries)
        .set({ 
          summary: summary.summary, 
          tokenCount: summary.tokenCount,
          segmentCount: summary.segmentCount,
          updatedAt: new Date() 
        })
        .where(eq(showSummaries.showId, summary.showId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(showSummaries).values(summary).returning();
    return created;
  }

  async deleteShowSummary(showId: number): Promise<void> {
    await db.delete(showSummaries).where(eq(showSummaries.showId, showId));
  }

  // Transcript Chunk methods
  async getTranscriptChunks(showId: number): Promise<TranscriptChunk[]> {
    return db.select().from(transcriptChunks)
      .where(eq(transcriptChunks.showId, showId))
      .orderBy(transcriptChunks.chunkIndex);
  }

  async createTranscriptChunk(chunk: InsertTranscriptChunk): Promise<TranscriptChunk> {
    const [created] = await db.insert(transcriptChunks).values(chunk).returning();
    return created;
  }

  async deleteTranscriptChunks(showId: number): Promise<void> {
    await db.delete(transcriptChunks).where(eq(transcriptChunks.showId, showId));
  }

  async updateChunkEmbedding(chunkId: number, embedding: string): Promise<void> {
    await db.update(transcriptChunks)
      .set({ embedding })
      .where(eq(transcriptChunks.id, chunkId));
  }

  async getLastChunkedSegmentId(showId: number): Promise<number | null> {
    const [result] = await db.select({ maxEnd: sql<number>`MAX(${transcriptChunks.endSegmentId})` })
      .from(transcriptChunks)
      .where(eq(transcriptChunks.showId, showId));
    return result?.maxEnd || null;
  }

  async getNextChunkIndex(showId: number): Promise<number> {
    const [result] = await db.select({ maxIndex: sql<number>`COALESCE(MAX(${transcriptChunks.chunkIndex}), -1)` })
      .from(transcriptChunks)
      .where(eq(transcriptChunks.showId, showId));
    return (result?.maxIndex ?? -1) + 1;
  }

  async getSegmentsAfter(showId: number, afterId: number): Promise<TranscriptSegment[]> {
    return db.select().from(transcriptSegments)
      .where(sql`${transcriptSegments.showId} = ${showId} AND ${transcriptSegments.id} > ${afterId}`)
      .orderBy(transcriptSegments.id);
  }

  // Source Chunk methods
  async getSourceChunks(sourceId: number): Promise<SourceChunk[]> {
    return db.select().from(sourceChunks)
      .where(eq(sourceChunks.sourceId, sourceId))
      .orderBy(sourceChunks.chunkIndex);
  }

  async getAllSourceChunks(): Promise<SourceChunk[]> {
    return db.select().from(sourceChunks).orderBy(sourceChunks.sourceId, sourceChunks.chunkIndex);
  }

  async createSourceChunk(chunk: InsertSourceChunk): Promise<SourceChunk> {
    const [created] = await db.insert(sourceChunks).values(chunk).returning();
    return created;
  }

  async deleteSourceChunks(sourceId: number): Promise<void> {
    await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, sourceId));
  }

  async updateSourceChunkEmbedding(chunkId: number, embedding: string): Promise<void> {
    await db.update(sourceChunks)
      .set({ embedding })
      .where(eq(sourceChunks.id, chunkId));
  }

  // Usage Record methods
  async createUsageRecord(record: InsertUsageRecord): Promise<UsageRecord> {
    const [created] = await db.insert(usageRecords).values(record).returning();
    return created;
  }

  async getUsageRecords(): Promise<UsageRecord[]> {
    return db.select().from(usageRecords).orderBy(desc(usageRecords.createdAt));
  }

  async getUsageStats(showId?: number | null): Promise<{ transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }> {
    const transcriptConditions = [eq(usageRecords.type, 'transcript')];
    // Voice includes 'voice', 'voice_in', and 'voice_out' for backward compatibility
    const voiceConditions = [sql`${usageRecords.type} IN ('voice', 'voice_in', 'voice_out')`];
    const voiceInConditions = [eq(usageRecords.type, 'voice_in')];
    const voiceOutConditions = [eq(usageRecords.type, 'voice_out')];
    
    if (showId !== undefined && showId !== null) {
      transcriptConditions.push(eq(usageRecords.showId, showId));
      voiceConditions.push(eq(usageRecords.showId, showId));
      voiceInConditions.push(eq(usageRecords.showId, showId));
      voiceOutConditions.push(eq(usageRecords.showId, showId));
    }
    
    const transcriptResult = await db.select({ 
      total: sql<number>`COALESCE(SUM(${usageRecords.seconds}), 0)` 
    }).from(usageRecords).where(and(...transcriptConditions));
    
    const voiceResult = await db.select({ 
      total: sql<number>`COALESCE(SUM(${usageRecords.seconds}), 0)` 
    }).from(usageRecords).where(and(...voiceConditions));
    
    const voiceInResult = await db.select({ 
      total: sql<number>`COALESCE(SUM(${usageRecords.seconds}), 0)` 
    }).from(usageRecords).where(and(...voiceInConditions));
    
    const voiceOutResult = await db.select({ 
      total: sql<number>`COALESCE(SUM(${usageRecords.seconds}), 0)` 
    }).from(usageRecords).where(and(...voiceOutConditions));
    
    return {
      transcriptSeconds: Number(transcriptResult[0]?.total || 0),
      voiceSeconds: Number(voiceResult[0]?.total || 0),
      voiceInSeconds: Number(voiceInResult[0]?.total || 0),
      voiceOutSeconds: Number(voiceOutResult[0]?.total || 0)
    };
  }

  async getUsageByDay(days: number, showId?: number | null): Promise<Array<{ date: string; transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>> {
    let whereCondition = sql`${usageRecords.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`;
    
    if (showId !== undefined && showId !== null) {
      whereCondition = sql`${usageRecords.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days' AND ${usageRecords.showId} = ${showId}`;
    }
    
    const result = await db.select({
      date: sql<string>`DATE(${usageRecords.createdAt})::text`,
      type: usageRecords.type,
      total: sql<number>`SUM(${usageRecords.seconds})`
    })
    .from(usageRecords)
    .where(whereCondition)
    .groupBy(sql`DATE(${usageRecords.createdAt})`, usageRecords.type)
    .orderBy(sql`DATE(${usageRecords.createdAt})`);
    
    // Transform to daily aggregates
    const dayMap = new Map<string, { transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>();
    for (const row of result) {
      if (!dayMap.has(row.date)) {
        dayMap.set(row.date, { transcriptSeconds: 0, voiceSeconds: 0, voiceInSeconds: 0, voiceOutSeconds: 0 });
      }
      const day = dayMap.get(row.date)!;
      if (row.type === 'transcript') {
        day.transcriptSeconds = Number(row.total);
      } else if (row.type === 'voice' || row.type === 'voice_in' || row.type === 'voice_out') {
        day.voiceSeconds += Number(row.total);
      }
      if (row.type === 'voice_in') {
        day.voiceInSeconds = Number(row.total);
      } else if (row.type === 'voice_out') {
        day.voiceOutSeconds = Number(row.total);
      }
    }
    
    return Array.from(dayMap.entries()).map(([date, stats]) => ({ date, ...stats }));
  }
  
  async getUsageByShow(days: number): Promise<Array<{ showId: number | null; showTitle: string | null; transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>> {
    const whereCondition = sql`${usageRecords.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`;
    
    const result = await db.select({
      showId: usageRecords.showId,
      showTitle: shows.title,
      type: usageRecords.type,
      total: sql<number>`SUM(${usageRecords.seconds})`
    })
    .from(usageRecords)
    .leftJoin(shows, eq(usageRecords.showId, shows.id))
    .where(whereCondition)
    .groupBy(usageRecords.showId, shows.title, usageRecords.type);
    
    // Transform to per-show aggregates
    const showMap = new Map<number | null, { showTitle: string | null; transcriptSeconds: number; voiceSeconds: number; voiceInSeconds: number; voiceOutSeconds: number }>();
    for (const row of result) {
      const key = row.showId;
      if (!showMap.has(key)) {
        showMap.set(key, { showTitle: row.showTitle, transcriptSeconds: 0, voiceSeconds: 0, voiceInSeconds: 0, voiceOutSeconds: 0 });
      }
      const show = showMap.get(key)!;
      if (row.type === 'transcript') {
        show.transcriptSeconds = Number(row.total);
      } else if (row.type === 'voice' || row.type === 'voice_in' || row.type === 'voice_out') {
        show.voiceSeconds += Number(row.total);
      }
      if (row.type === 'voice_in') {
        show.voiceInSeconds = Number(row.total);
      } else if (row.type === 'voice_out') {
        show.voiceOutSeconds = Number(row.total);
      }
    }
    
    return Array.from(showMap.entries()).map(([showId, stats]) => ({ showId, ...stats }));
  }
  
  // Admin methods
  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }
  
  async updateUserRole(userId: string, role: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }
  
  async getUsageStatsByUser(): Promise<Array<{ userId: string | null; email: string | null; firstName: string | null; lastName: string | null; transcriptSeconds: number; voiceSeconds: number }>> {
    const result = await db.select({
      userId: usageRecords.userId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      type: usageRecords.type,
      total: sql<number>`SUM(${usageRecords.seconds})`
    })
    .from(usageRecords)
    .leftJoin(users, eq(usageRecords.userId, users.id))
    .groupBy(usageRecords.userId, users.email, users.firstName, users.lastName, usageRecords.type);
    
    const userMap = new Map<string | null, { email: string | null; firstName: string | null; lastName: string | null; transcriptSeconds: number; voiceSeconds: number }>();
    for (const row of result) {
      const key = row.userId;
      if (!userMap.has(key)) {
        userMap.set(key, { email: row.email, firstName: row.firstName, lastName: row.lastName, transcriptSeconds: 0, voiceSeconds: 0 });
      }
      const user = userMap.get(key)!;
      if (row.type === 'transcript') {
        user.transcriptSeconds = Number(row.total);
      } else if (row.type === 'voice') {
        user.voiceSeconds = Number(row.total);
      }
    }
    
    return Array.from(userMap.entries()).map(([userId, stats]) => ({ userId, ...stats }));
  }
  
  async getUsageByUser(days: number): Promise<Array<{ userId: string | null; email: string | null; firstName: string | null; lastName: string | null; date: string; transcriptSeconds: number; voiceSeconds: number }>> {
    const whereCondition = sql`${usageRecords.createdAt} >= NOW() - INTERVAL '${sql.raw(String(days))} days'`;
    
    const result = await db.select({
      userId: usageRecords.userId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      date: sql<string>`DATE(${usageRecords.createdAt})::text`,
      type: usageRecords.type,
      total: sql<number>`SUM(${usageRecords.seconds})`
    })
    .from(usageRecords)
    .leftJoin(users, eq(usageRecords.userId, users.id))
    .where(whereCondition)
    .groupBy(usageRecords.userId, users.email, users.firstName, users.lastName, sql`DATE(${usageRecords.createdAt})`, usageRecords.type)
    .orderBy(sql`DATE(${usageRecords.createdAt})`);
    
    const dayUserMap = new Map<string, { email: string | null; firstName: string | null; lastName: string | null; transcriptSeconds: number; voiceSeconds: number }>();
    for (const row of result) {
      const key = `${row.userId || 'unknown'}_${row.date}`;
      if (!dayUserMap.has(key)) {
        dayUserMap.set(key, { email: row.email, firstName: row.firstName, lastName: row.lastName, transcriptSeconds: 0, voiceSeconds: 0 });
      }
      const entry = dayUserMap.get(key)!;
      if (row.type === 'transcript') {
        entry.transcriptSeconds = Number(row.total);
      } else if (row.type === 'voice') {
        entry.voiceSeconds = Number(row.total);
      }
    }
    
    return Array.from(dayUserMap.entries()).map(([key, stats]) => {
      const [userId, date] = key.split('_');
      return { userId: userId === 'unknown' ? null : userId, date, ...stats };
    });
  }
  
  // User preferences
  async updateVoicePreference(userId: string, voicePreference: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ voicePreference, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }
  
  // User Credits methods
  async getUserCredits(userId: string): Promise<UserCredits | undefined> {
    const [credits] = await db.select().from(userCredits).where(eq(userCredits.userId, userId));
    return credits;
  }
  
  async createUserCredits(userId: string, transcriptSeconds: number = 0, voiceSeconds: number = 0): Promise<UserCredits> {
    const [created] = await db.insert(userCredits)
      .values({ userId, transcriptSeconds, voiceSeconds })
      .returning();
    return created;
  }
  
  async addCredits(userId: string, transcriptSeconds: number, voiceSeconds: number): Promise<UserCredits> {
    const existing = await this.getUserCredits(userId);
    if (existing) {
      const [updated] = await db.update(userCredits)
        .set({
          transcriptSeconds: sql`${userCredits.transcriptSeconds} + ${transcriptSeconds}`,
          voiceSeconds: sql`${userCredits.voiceSeconds} + ${voiceSeconds}`,
          updatedAt: new Date()
        })
        .where(eq(userCredits.userId, userId))
        .returning();
      return updated;
    }
    return this.createUserCredits(userId, transcriptSeconds, voiceSeconds);
  }
  
  async deductCredits(userId: string, transcriptSeconds: number, voiceSeconds: number): Promise<UserCredits | null> {
    const existing = await this.getUserCredits(userId);
    if (!existing) return null;
    
    const newTranscript = Math.max(0, existing.transcriptSeconds - transcriptSeconds);
    const newVoice = Math.max(0, existing.voiceSeconds - voiceSeconds);
    
    const [updated] = await db.update(userCredits)
      .set({
        transcriptSeconds: newTranscript,
        voiceSeconds: newVoice,
        updatedAt: new Date()
      })
      .where(eq(userCredits.userId, userId))
      .returning();
    return updated;
  }
  
  // Credit Purchase methods
  async createCreditPurchase(purchase: InsertCreditPurchase): Promise<CreditPurchase> {
    const [created] = await db.insert(creditPurchases).values(purchase).returning();
    return created;
  }
  
  async getCreditPurchase(stripeSessionId: string): Promise<CreditPurchase | undefined> {
    const [purchase] = await db.select().from(creditPurchases)
      .where(eq(creditPurchases.stripeSessionId, stripeSessionId));
    return purchase;
  }
  
  async updateCreditPurchaseStatus(stripeSessionId: string, status: string, paymentIntentId?: string): Promise<CreditPurchase | undefined> {
    const updateData: any = { status };
    if (paymentIntentId) {
      updateData.stripePaymentIntentId = paymentIntentId;
    }
    if (status === 'completed') {
      updateData.completedAt = new Date();
    }
    const [updated] = await db.update(creditPurchases)
      .set(updateData)
      .where(eq(creditPurchases.stripeSessionId, stripeSessionId))
      .returning();
    return updated;
  }
  
  async getUserCreditPurchases(userId: string): Promise<CreditPurchase[]> {
    return db.select().from(creditPurchases)
      .where(eq(creditPurchases.userId, userId))
      .orderBy(desc(creditPurchases.createdAt));
  }
  
  async getAllCreditPurchases(): Promise<CreditPurchase[]> {
    return db.select().from(creditPurchases)
      .orderBy(desc(creditPurchases.createdAt));
  }
  
  async updateCreditPurchaseStatusById(purchaseId: number, status: string): Promise<CreditPurchase | undefined> {
    const [updated] = await db.update(creditPurchases)
      .set({ status })
      .where(eq(creditPurchases.id, purchaseId))
      .returning();
    return updated;
  }
  
  // Quick Action methods
  async getAllQuickActions(): Promise<QuickAction[]> {
    return db.select().from(quickActions).orderBy(quickActions.sortOrder);
  }
  
  async getSystemQuickActions(): Promise<QuickAction[]> {
    return db.select().from(quickActions)
      .where(or(isNull(quickActions.userId), eq(quickActions.userId, '')))
      .orderBy(quickActions.sortOrder);
  }
  
  async getUserQuickActions(userId: string): Promise<QuickAction[]> {
    return db.select().from(quickActions)
      .where(eq(quickActions.userId, userId))
      .orderBy(quickActions.sortOrder);
  }
  
  async getQuickActions(userId: string): Promise<QuickAction[]> {
    // Get user's own actions only (backwards compat)
    return this.getUserQuickActions(userId);
  }
  
  async createQuickAction(action: InsertQuickAction): Promise<QuickAction> {
    const [created] = await db.insert(quickActions).values(action).returning();
    return created;
  }
  
  async updateQuickAction(id: number, label: string, prompt: string, sortOrder?: number): Promise<QuickAction | undefined> {
    const updateData: any = { label, prompt };
    if (sortOrder !== undefined) {
      updateData.sortOrder = sortOrder;
    }
    const [updated] = await db.update(quickActions)
      .set(updateData)
      .where(eq(quickActions.id, id))
      .returning();
    return updated;
  }
  
  async deleteQuickAction(id: number): Promise<void> {
    await db.delete(quickActions).where(eq(quickActions.id, id));
  }
  
  // Quick Action Selection methods
  async getUserQuickActionSelections(userId: string): Promise<{ quickAction: QuickAction; isEnabled: boolean; sortOrder: number }[]> {
    // Get all available actions (system + user's own)
    const systemActions = await this.getSystemQuickActions();
    const userActions = await this.getUserQuickActions(userId);
    const allActions = [...systemActions, ...userActions];
    
    // Get user's selection settings
    const selections = await db.select().from(userQuickActionSelections)
      .where(eq(userQuickActionSelections.userId, userId));
    
    const selectionMap = new Map(selections.map(s => [s.quickActionId, s]));
    
    // Map actions with their selection status (default to enabled for new actions)
    return allActions.map((action, index) => {
      const selection = selectionMap.get(action.id);
      return {
        quickAction: action,
        isEnabled: selection ? selection.isEnabled === 1 : true,
        sortOrder: selection ? selection.sortOrder : action.sortOrder
      };
    }).sort((a, b) => a.sortOrder - b.sortOrder);
  }
  
  async setQuickActionSelection(userId: string, quickActionId: number, isEnabled: boolean, sortOrder?: number): Promise<void> {
    const existing = await db.select().from(userQuickActionSelections)
      .where(and(
        eq(userQuickActionSelections.userId, userId),
        eq(userQuickActionSelections.quickActionId, quickActionId)
      ));
    
    if (existing.length > 0) {
      // Update existing selection
      const updateData: any = { isEnabled: isEnabled ? 1 : 0 };
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      await db.update(userQuickActionSelections)
        .set(updateData)
        .where(and(
          eq(userQuickActionSelections.userId, userId),
          eq(userQuickActionSelections.quickActionId, quickActionId)
        ));
    } else {
      // Create new selection
      await db.insert(userQuickActionSelections).values({
        userId,
        quickActionId,
        isEnabled: isEnabled ? 1 : 0,
        sortOrder: sortOrder ?? 0
      });
    }
  }
  
  async initializeUserSelections(userId: string): Promise<void> {
    // Check if user has any selections
    const existing = await db.select().from(userQuickActionSelections)
      .where(eq(userQuickActionSelections.userId, userId));
    
    if (existing.length === 0) {
      // Get system defaults and enable them all for new user
      const systemActions = await this.getSystemQuickActions();
      for (const action of systemActions) {
        await db.insert(userQuickActionSelections).values({
          userId,
          quickActionId: action.id,
          isEnabled: 1,
          sortOrder: action.sortOrder
        });
      }
    }
  }
}

export const storage = new DatabaseStorage();
