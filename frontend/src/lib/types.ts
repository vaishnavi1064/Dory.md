export type Category = 'technical' | 'personal' | 'reference' | 'general';
export type SourceType = 'file' | 'note' | 'url' | 'clipboard';
export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export interface Chunk {
  id: string;
  content: string;
  source_type: SourceType;
  source_name: string;
  category: Category;
  created_at: string;
  last_accessed: string;
  access_count: number;
  stability_S: number;
  complexity_k: number;
  retention?: number;
  tags?: string[];
  folder?: string;
}

export type DiscoveryResponse =
  | { has_discovery: true; chunk: Chunk; reason: string }
  | { has_discovery: false };

export interface SearchResult {
  chunk: Chunk;
  score: number;
  highlight?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total: number;
}

export interface QuizQuestion {
  id: string;
  chunk_id: string;
  question: string;
  options: string[];
  correct_index: number;
  difficulty: QuizDifficulty;
  category: Category;
  hint?: string;
}

export interface QuizSession {
  session_id: string;
  questions: QuizQuestion[];
  created_at: string;
}

export interface QuizAnswer {
  question_id: string;
  selected_index: number;
  time_taken_ms: number;
}

export interface QuizResultItem {
  question_id: string;
  correct: boolean;
  selected_index: number;
  correct_index: number;
  stability_delta: number;
}

export interface QuizResults {
  session_id: string;
  score: number;
  total: number;
  results: QuizResultItem[];
  xp_earned: number;
  streaks: number;
}

export interface IngestResponse {
  chunk_id: string;
  category: Category;
  stability_S: number;
  complexity_k: number;
  message: string;
}

export interface FileIngestResponse {
  chunks_created: number;
  source: string;
}

export interface BackendChunk {
  chunk_id: string;
  content: string;
  source_file: string;
  category: string | null;
  retention: number;
  status: string;
  last_accessed: string;      // human-readable "5mo ago"
  last_accessed_iso: string;  // ISO 8601 for date math
  access_count: number;
  folder?: string | null;
}

export interface ChunkDetail {
  chunk_id: string;
  content: string;
  source_file: string;
  folder?: string | null;
}

export interface FadingResponse {
  chunks: BackendChunk[];
  total_fading: number;
}

export interface ChunksResponse {
  chunks: BackendChunk[];
  total: number;
}

export interface StatsResponse {
  total_chunks: number;
  avg_retention: number;
  strong: number;
  fading: number;
  weak: number;
  critical: number;
}
