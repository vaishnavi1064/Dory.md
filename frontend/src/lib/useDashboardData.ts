import { useEffect, useState } from 'react';
import { getAllChunks } from './api';
import type { BackendChunk } from './types';

/** Shape returned to dashboard tree components. Just the bits we actually need. */
export interface TreeChunk {
  id: string;
  retention: number;
  category: string;
  last_accessed_iso: string;
  access_count: number;
}

/** Loads all chunks once, plus helpers to project retention into the future. */
export function useTreeData() {
  const [chunks, setChunks] = useState<TreeChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllChunks(2000)
      .then(r => {
        if (cancelled) return;
        setChunks(r.chunks.map((c: BackendChunk) => ({
          id: c.chunk_id,
          retention: c.retention,
          category: c.category ?? 'general',
          last_accessed_iso: c.last_accessed_iso,
          access_count: c.access_count,
        })));
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { chunks, loading, error };
}

/**
 * Project retention `offsetHours` into the future. Uses an Ebbinghaus-shaped
 * decay that respects per-chunk stability via the chunk's access count
 * (more reviews = slower decay). Cheap local approximation — for exact numbers
 * the backend's /api/health does the right math, but this is good enough for
 * the visual trees.
 */
export function projectRetention(c: TreeChunk, offsetHours: number): number {
  if (offsetHours <= 0) return c.retention;
  // Stability rough proxy: more reviews → slower decay. 24h per stability unit.
  const stability = (1 + 0.5 * Math.log1p(c.access_count)) * 9.0;
  const tauHours = stability * 24;
  // R(t + Δt) = R(t) · exp(-Δt/τ)
  return c.retention * Math.exp(-offsetHours / tauHours);
}
