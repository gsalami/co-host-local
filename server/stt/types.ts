/**
 * Normalized transcript result emitted by STT providers.
 */
export type TranscriptResult = {
  text: string;
  isFinal: boolean;
  speaker?: number | null;
  timestamp?: string;
  speechDuration?: number;
  raw?: unknown;
};

/**
 * Callback invoked for partial and final transcripts.
 */
export type TranscriptCallback = (result: TranscriptResult) => void;
/**
 * Callback invoked when the STT provider encounters an error.
 */
export type ErrorCallback = (error: Error) => void;

/**
 * Streaming Speech-to-Text provider interface.
 */
export interface STTProvider {
  /**
   * Establish a streaming connection for the given language.
   */
  connect(
    language: string,
    onTranscript: TranscriptCallback,
    onError: ErrorCallback
  ): Promise<void>;
  /**
   * Send an audio chunk to the provider.
   */
  sendAudio(chunk: Buffer): void;
  /**
   * Close the streaming connection and release resources.
   */
  close(): void;
}
