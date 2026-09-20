import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ForceGraph2D from 'react-force-graph-2d';
import { Network, RefreshCw, X } from 'lucide-react';
import {
  BUCKET_COLORS,
  BUCKET_LABELS,
  fetchGraph,
  fetchNeighbors,
  rebuildGraph,
  type Bucket,
  type GraphEdge,
  type GraphNeighbor,
  type GraphNode,
} from '@/lib/graph';

const BUCKETS: Bucket[] = ['strong', 'fading', 'weak', 'critical'];

/** Soft lavender glow behind the graph so the canvas area is not stark white.
 *
 *  This sits on the wrapping div, not on the canvas: ForceGraph2D paints its
 *  background through canvas, which cannot parse var() or color-mix() (hence
 *  resolveColor below), while a plain element reads the theme tokens directly.
 *  The gradient fades to the same hue at zero alpha rather than to
 *  `transparent`, which would wash through grey on the way out, and lands on
 *  --surface so the edges match the surrounding card. Alphas are deliberately
 *  low so the bucket colours — especially the red "critical" nodes — stay
 *  legible on top of it. */
const GRAPH_BACKDROP = [
  'radial-gradient(ellipse 75% 65% at 50% 45%,',
  'oklch(var(--lavender) / 0.13) 0%,',
  'oklch(var(--lavender) / 0.06) 40%,',
  'oklch(var(--lavender) / 0) 72%),',
  'var(--surface)',
].join(' ');

/** Canvas cannot read `var(--token)` or `color-mix()`, so resolve each value to
 *  a concrete color by letting the browser compute it on a throwaway element. */
function resolveColor(value: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.style.color = fallback;
  probe.style.color = value;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

type SimNode = GraphNode & { x?: number; y?: number };
type SimLink = Omit<GraphEdge, 'source' | 'target'> & {
  source: string | SimNode;
  target: string | SimNode;
};

export function GraphPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [neighbors, setNeighbors] = useState<GraphNeighbor[] | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Resolve the theme tokens once; canvas needs literal color strings.
  const palette = useMemo(
    () => ({
      strong: resolveColor(BUCKET_COLORS.strong, '#3f9e6a'),
      fading: resolveColor(BUCKET_COLORS.fading, '#c98a2b'),
      weak: resolveColor(BUCKET_COLORS.weak, '#cf5f3a'),
      critical: resolveColor(BUCKET_COLORS.critical, '#d3453b'),
      link: resolveColor('var(--border-strong)', '#c9c4bb'),
    }),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGraph(bucket ? { bucket } : {});
      setNodes(data.nodes);
      setEdges(data.edges);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the graph.');
    } finally {
      setLoading(false);
    }
  }, [bucket]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the canvas matched to its container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // ForceGraph2D mutates the objects it is handed (it stores x/y on nodes and
  // swaps link endpoints for node references), so give it fresh copies.
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })) as SimNode[],
      links: edges.map((e) => ({ ...e })) as SimLink[],
    }),
    [nodes, edges],
  );

  const onNodeClick = useCallback(async (node: SimNode) => {
    setSelected(node);
    setNeighbors(null);
    try {
      setNeighbors(await fetchNeighbors(node.id));
    } catch {
      setNeighbors([]);
    }
  }, []);

  async function handleRebuild() {
    setRebuilding(true);
    setError(null);
    try {
      const result = await rebuildGraph();
      setNotice(
        result.edges_created > 0
          ? `Added ${result.edges_created} connection${result.edges_created === 1 ? '' : 's'}.`
          : 'Your graph is already up to date.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rebuild failed.');
    } finally {
      setRebuilding(false);
    }
  }

  const isEmpty = !loading && nodes.length === 0;
  const hasNoEdges = !loading && nodes.length > 0 && edges.length === 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--text-1)]">
            <Network size={18} className="text-[var(--accent)]" />
            Knowledge graph
          </h1>
          <p className="mt-0.5 text-sm text-[var(--text-3)]">
            Notes linked by meaning. Reviewing one strengthens the notes it connects to.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`tag ${bucket === null ? 'badge-strong' : ''}`}
            onClick={() => setBucket(null)}
          >
            All
          </button>
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              className={`tag ${bucket === b ? `badge-${b}` : ''}`}
              onClick={() => setBucket(bucket === b ? null : b)}
            >
              {BUCKET_LABELS[b]}
            </button>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRebuild}
            disabled={rebuilding}
          >
            <RefreshCw size={13} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? 'Rebuilding...' : 'Rebuild'}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {notice && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-xs font-medium text-[var(--text-2)]"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      {error && (
        <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <div
          ref={wrapRef}
          className="app-card relative min-h-[420px] flex-1 overflow-hidden p-0"
          style={{ background: GRAPH_BACKDROP }}
        >
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-sm text-[var(--text-3)]">
              Loading your graph...
            </div>
          )}

          {isEmpty && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center">
              <div>
                <p className="font-bold text-[var(--text-1)]">No connections yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-3)]">
                  Review or add notes to build your graph. If you already have notes, rebuild to
                  link them.
                </p>
                <button
                  type="button"
                  className="btn-primary mt-4"
                  onClick={handleRebuild}
                  disabled={rebuilding}
                >
                  {rebuilding ? 'Rebuilding...' : 'Build my graph'}
                </button>
              </div>
            </div>
          )}

          {hasNoEdges && (
            <p className="absolute inset-x-0 top-0 z-10 bg-[var(--accent-soft)] px-3 py-2 text-center text-xs text-[var(--text-2)]">
              These notes have no links yet — rebuild to connect them.
            </p>
          )}

          {!loading && !isEmpty && size.width > 0 && (
            <ForceGraph2D
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              nodeRelSize={4}
              nodeVal={(node: SimNode) => 1 + node.degree}
              nodeColor={(node: SimNode) => palette[node.bucket]}
              nodeLabel={(node: SimNode) =>
                `${node.label} — ${BUCKET_LABELS[node.bucket]} (${Math.round(node.retention * 100)}%)`
              }
              linkCanvasObject={(link: SimLink, ctx: CanvasRenderingContext2D) => {
                const s = link.source as SimNode;
                const t = link.target as SimNode;
                if (typeof s !== 'object' || typeof t !== 'object') return;
                if (s.x == null || s.y == null || t.x == null || t.y == null) return;
                ctx.save();
                // Opacity tracks edge weight, so stronger links read as stronger.
                ctx.globalAlpha = 0.15 + 0.65 * Math.max(0, Math.min(1, link.weight));
                ctx.strokeStyle = palette.link;
                ctx.lineWidth = 0.5 + 1.5 * Math.max(0, Math.min(1, link.weight));
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(t.x, t.y);
                ctx.stroke();
                ctx.restore();
              }}
              onNodeClick={onNodeClick}
              cooldownTicks={120}
            />
          )}
        </div>

        <AnimatePresence>
          {selected && (
            <motion.aside
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.16 }}
              className="app-card w-full max-w-xs shrink-0 overflow-y-auto p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <span className={`tag badge-${selected.bucket}`}>{BUCKET_LABELS[selected.bucket]}</span>
                <button
                  type="button"
                  aria-label="Close panel"
                  className="text-[var(--text-3)] hover:text-[var(--text-1)]"
                  onClick={() => setSelected(null)}
                >
                  <X size={15} />
                </button>
              </div>

              <p className="mt-2 text-sm font-medium text-[var(--text-1)]">{selected.label}</p>
              <p className="mt-1 text-xs text-[var(--text-3)]">
                {Math.round(selected.retention * 100)}% retained · {selected.degree} connection
                {selected.degree === 1 ? '' : 's'}
              </p>

              <h2 className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--text-3)]">
                Connected notes
              </h2>

              {neighbors === null && (
                <p className="mt-2 text-xs text-[var(--text-3)]">Loading...</p>
              )}
              {neighbors !== null && neighbors.length === 0 && (
                <p className="mt-2 text-xs text-[var(--text-3)]">No connections yet.</p>
              )}

              <ul className="mt-2 space-y-2">
                {(neighbors ?? []).map((n) => (
                  <li key={n.chunk_id} className="rounded-lg border border-[var(--border)] p-2">
                    <p className="text-xs text-[var(--text-2)]">{n.label}</p>
                    <p className="mt-1 text-[11px] text-[var(--text-3)]">
                      {BUCKET_LABELS[n.bucket]} · link {Math.round(n.weight * 100)}%
                    </p>
                  </li>
                ))}
              </ul>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
