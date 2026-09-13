import { config } from '@/lib/config';
import { clearTokens, getAccessToken, refreshAccessToken } from '@/lib/tokens';

export type Bucket = 'strong' | 'fading' | 'weak' | 'critical';

export interface GraphNode {
  id: string;
  label: string;
  retention: number;
  bucket: Bucket;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNeighbor {
  chunk_id: string;
  label: string;
  weight: number;
  type: string;
  retention: number;
  bucket: Bucket;
}

export interface GraphRebuildResponse {
  edges_created: number;
  edges_total: number;
}

export interface GraphParams {
  bucket?: Bucket;
  focusChunkId?: string;
  limit?: number;
}

/** Node colors reuse the retention-bucket tokens the badges already use:
 *  strong = --good, fading = --warn, weak/critical = --danger. */
export const BUCKET_COLORS: Record<Bucket, string> = {
  strong: 'var(--good)',
  fading: 'var(--warn)',
  weak: 'color-mix(in oklab, var(--danger) 70%, var(--warn))',
  critical: 'var(--danger)',
};

export const BUCKET_LABELS: Record<Bucket, string> = {
  strong: 'Strong',
  fading: 'Fading',
  weak: 'Weak',
  critical: 'Critical',
};

async function graphFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const doFetch = (tok: string | null) =>
    fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

  let res = await doFetch(token);
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await doFetch(newToken);
    else {
      clearTokens();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
      throw new Error('Session expired.');
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchGraph(params: GraphParams = {}): Promise<GraphResponse> {
  const query = new URLSearchParams();
  if (params.bucket) query.set('bucket', params.bucket);
  if (params.focusChunkId) query.set('focus_chunk_id', params.focusChunkId);
  if (params.limit != null) query.set('limit', String(params.limit));
  const suffix = query.toString();
  return graphFetch<GraphResponse>(`/api/graph${suffix ? `?${suffix}` : ''}`);
}

export async function fetchNeighbors(chunkId: string): Promise<GraphNeighbor[]> {
  return graphFetch<GraphNeighbor[]>(`/api/graph/chunk/${encodeURIComponent(chunkId)}/neighbors`);
}

export async function rebuildGraph(): Promise<GraphRebuildResponse> {
  return graphFetch<GraphRebuildResponse>('/api/graph/rebuild', { method: 'POST' });
}
