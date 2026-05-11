import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, BrainCircuit, BookOpen, CalendarClock, ChevronRight,
  CheckCircle2, Clock3, Sparkles, UploadCloud,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getDiscovery, getFading, getStats } from '@/lib/api';
import { projectRetention, useTreeData } from '@/lib/useDashboardData';
import type { BackendChunk, DiscoveryResponse, StatsResponse } from '@/lib/types';
import { retentionToColor, retentionToLabel } from '@/styles/theme';

/* ─── Horizon chips (compact replacement for the big slider) ──────────── */

const HORIZONS = [
  { label: 'Now',   hours: 0 },
  { label: '+24h',  hours: 24 },
  { label: '+3d',   hours: 72 },
  { label: '+7d',   hours: 168 },
  { label: '+30d',  hours: 720 },
  { label: '+90d',  hours: 2160 },
];

/* ─── Utilities ──────────────────────────────────────────────────────── */

function pct(n = 0) { return `${Math.round(n * 100)}%`; }

function baseName(path: string) { return path.split(/[\\/]/).pop() ?? path; }

function chunkTitle(c: BackendChunk) {
  const firstLine = c.content.split('\n')[0].trim();
  if (firstLine.length > 76) return firstLine.slice(0, 76) + '…';
  return firstLine || baseName(c.source_file);
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const CATEGORY_EMOJI: Record<string, string> = {
  technical: '💻',
  'computer science': '💻',
  development: '💻',
  'ai/ml': '🤖',
  'system design': '🏗️',
  productivity: '📈',
  personal: '🌱',
  reference: '📚',
  general: '📝',
};

function categoryEmoji(raw: string): string {
  const k = (raw || '').toLowerCase();
  return CATEGORY_EMOJI[k] ?? '📝';
}

/* ─── Dashboard ──────────────────────────────────────────────────────── */

export function Dashboard() {
  const { user } = useAuth();
  const { chunks, loading } = useTreeData();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [fading, setFading] = useState<BackendChunk[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [horizonIndex, setHorizonIndex] = useState(0);
  const horizon = HORIZONS[horizonIndex];

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
    getFading(8).then(r => setFading(r.chunks)).catch(() => {});
    getDiscovery().then(setDiscovery).catch(() => {});
  }, []);

  const projected = useMemo(
    () => chunks.map(c => projectRetention(c, horizon.hours)),
    [chunks, horizon.hours],
  );

  const counts = useMemo(() => {
    if (horizon.hours === 0 && stats) {
      return { strong: stats.strong, fading: stats.fading, weak: stats.weak, critical: stats.critical };
    }
    const c = { strong: 0, fading: 0, weak: 0, critical: 0 };
    for (const r of projected) {
      if (r >= 0.72) c.strong++;
      else if (r >= 0.5) c.fading++;
      else if (r >= 0.28) c.weak++;
      else c.critical++;
    }
    return c;
  }, [projected, stats, horizon.hours]);

  const categoryRows = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    chunks.forEach((chunk, i) => {
      const row = map.get(chunk.category) ?? { count: 0, total: 0 };
      row.count += 1;
      row.total += projected[i] ?? chunk.retention;
      map.set(chunk.category, row);
    });
    return Array.from(map.entries())
      .map(([category, row]) => ({
        category,
        count: row.count,
        avg: row.count ? row.total / row.count : 0,
      }))
      .sort((a, b) => a.avg - b.avg);
  }, [chunks, projected]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const totalChunks = stats?.total_chunks ?? chunks.length;
  const avgRetention = useMemo(() => {
    if (horizon.hours === 0 && stats) return stats.avg_retention;
    if (!projected.length) return 0;
    return projected.reduce((s, r) => s + r, 0) / projected.length;
  }, [projected, stats, horizon.hours]);

  /* ─── Notion-style page ──────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-5xl space-y-7 py-2">
      {/* Page title block */}
      <header>
        <div className="text-4xl mb-2">🐟</div>
        <h1 className="text-3xl font-extrabold text-[var(--text-1)] leading-tight">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-3)]">
          {loading
            ? 'Loading your memory…'
            : `${totalChunks} memor${totalChunks === 1 ? 'y' : 'ies'} tracked · ${pct(avgRetention)} average retention · ${retentionToLabel(avgRetention).toLowerCase()}`}
        </p>
      </header>

      {/* Horizon chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Clock3 size={14} className="text-[var(--text-3)] shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] shrink-0 mr-1">
          Projection
        </span>
        {HORIZONS.map((h, i) => {
          const active = i === horizonIndex;
          return (
            <button
              key={h.label}
              onClick={() => setHorizonIndex(i)}
              className="shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-all"
              style={{
                background: active ? 'var(--accent)' : 'var(--surface-2)',
                color: active ? 'white' : 'var(--text-2)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              {h.label}
            </button>
          );
        })}
      </div>

      {/* Stat row */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Strong',   value: counts.strong,   dot: 'var(--good)',   hint: '≥ 72%' },
          { label: 'Fading',   value: counts.fading,   dot: 'var(--warn)',   hint: '50 – 72%' },
          { label: 'Weak',     value: counts.weak,     dot: '#d66a2f',       hint: '28 – 50%' },
          { label: 'Critical', value: counts.critical, dot: 'var(--danger)', hint: '< 28%' },
        ].map(({ label, value, dot, hint }, i) => (
          <motion.div
            key={label}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <div className="flex items-center gap-2">
              <span className="block h-2 w-2 rounded-full" style={{ background: dot }} />
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-3)]">
                {label}
              </span>
            </div>
            <motion.p
              className="mt-2 text-3xl font-extrabold text-[var(--text-1)]"
              key={`${label}-${value}`}
              initial={{ scale: 0.94, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            >
              {value}
            </motion.p>
            <p className="mt-1 text-[11px] font-mono text-[var(--text-3)]">{hint}</p>
          </motion.div>
        ))}
      </section>

      {/* Today's review — the centerpiece */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-1)]">Today's review</h2>
            <p className="mt-0.5 text-sm text-[var(--text-3)]">
              {fading.length > 0
                ? `${fading.length} memor${fading.length === 1 ? 'y' : 'ies'} need attention`
                : 'You\'re all caught up.'}
            </p>
          </div>
          {fading.length > 0 && (
            <Link to="/quiz" className="btn-primary text-sm">
              <BrainCircuit size={14} /> Start review
            </Link>
          )}
        </div>

        {loading ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-6 text-center text-sm text-[var(--text-3)]">
            Loading…
          </div>
        ) : fading.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-6 text-center">
            <CheckCircle2 size={28} className="mx-auto text-[var(--good)]" />
            <p className="mt-2 font-bold text-[var(--text-1)]">All caught up</p>
            <p className="mt-1 text-sm text-[var(--text-3)]">
              No memories are fading right now. Come back tomorrow.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden divide-y divide-[var(--border)]">
            {fading.map((chunk, i) => {
              const color = retentionToColor(chunk.retention);
              return (
                <motion.div
                  key={chunk.chunk_id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                >
                  <Link
                    to={`/library?chunk=${encodeURIComponent(chunk.chunk_id)}`}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    {/* Status dot */}
                    <span
                      className="block h-2 w-2 rounded-full shrink-0"
                      style={{ background: color }}
                    />

                    {/* Title + source */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-1)]">
                        {chunkTitle(chunk)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
                        {baseName(chunk.source_file)}
                      </p>
                    </div>

                    {/* Retention bar */}
                    <div className="hidden sm:block w-24 shrink-0">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full"
                          style={{ width: `${Math.max(2, chunk.retention * 100)}%`, background: color }}
                        />
                      </div>
                      <p className="mt-1 text-right text-[10px] font-mono font-bold" style={{ color }}>
                        {pct(chunk.retention)}
                      </p>
                    </div>

                    {/* Age */}
                    <span className="hidden md:block w-20 shrink-0 text-right text-xs text-[var(--text-3)]">
                      {relativeAge(chunk.last_accessed_iso)}
                    </span>

                    <ChevronRight size={14} className="shrink-0 text-[var(--text-4)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* Two-column: by category + recent activity */}
      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Knowledge by category */}
        <div>
          <h2 className="mb-3 text-lg font-bold text-[var(--text-1)]">Knowledge by category</h2>
          {categoryRows.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-6 text-center text-sm text-[var(--text-3)]">
              Ingest some notes to see categories.
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden divide-y divide-[var(--border)]">
              {categoryRows.map((row, i) => {
                const color = retentionToColor(row.avg);
                return (
                  <motion.div
                    key={row.category}
                    className="flex items-center gap-3 px-4 py-3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <span className="text-lg shrink-0">{categoryEmoji(row.category)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium capitalize text-[var(--text-1)] truncate">
                          {row.category}
                        </span>
                        <span className="text-xs text-[var(--text-3)] shrink-0">
                          {row.count} chunks · <span className="font-bold" style={{ color }}>{pct(row.avg)}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <motion.div
                          className="h-full rounded-full"
                          animate={{ width: `${row.avg * 100}%`, backgroundColor: color }}
                          transition={{ type: 'spring', stiffness: 160, damping: 22 }}
                        />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Side column: discovery + quick actions */}
        <aside className="space-y-5">
          <div>
            <h2 className="mb-3 text-lg font-bold text-[var(--text-1)]">Quick actions</h2>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
              <Link to="/library" className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--text-1)]">
                  <UploadCloud size={15} className="text-[var(--accent)]" /> Import notes
                </span>
                <ArrowRight size={14} className="text-[var(--text-4)]" />
              </Link>
              <Link to="/quiz" className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--text-1)]">
                  <BrainCircuit size={15} className="text-[var(--accent)]" /> Quiz fading chunks
                </span>
                <ArrowRight size={14} className="text-[var(--text-4)]" />
              </Link>
              <Link to="/library" className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--text-1)]">
                  <BookOpen size={15} className="text-[var(--accent)]" /> Browse library
                </span>
                <ArrowRight size={14} className="text-[var(--text-4)]" />
              </Link>
              <Link to="/calendar" className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--text-1)]">
                  <CalendarClock size={15} className="text-[var(--accent)]" /> Plan review week
                </span>
                <ArrowRight size={14} className="text-[var(--text-4)]" />
              </Link>
            </div>
          </div>

          {/* Discovery card (only renders if there's a discovery) */}
          {discovery && discovery.has_discovery && (
            <div>
              <h2 className="mb-3 text-lg font-bold text-[var(--text-1)]">Dory found something</h2>
              <motion.div
                className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-start gap-2.5">
                  <Sparkles size={16} className="text-[var(--accent)] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--text-1)]">{discovery.reason}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--text-2)]">
                      {chunkTitle(discovery.chunk as unknown as BackendChunk)}
                    </p>
                    <Link
                      to={`/library?chunk=${encodeURIComponent(discovery.chunk.id)}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[var(--accent)] hover:text-[var(--accent-hover)]"
                    >
                      Open <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
