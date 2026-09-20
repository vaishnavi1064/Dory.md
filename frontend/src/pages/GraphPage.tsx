import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { Network, RefreshCw, X } from 'lucide-react';
import {
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
const TAU = Math.PI * 2;

/** Deep-space field the constellation sits on.
 *
 *  Literal colours throughout: the canvas cannot parse var() or oklch(), and
 *  the app's light warm+lavender tokens have no dark counterpart to borrow.
 *  Painted by CSS on the wrapping div, which keeps the card's rounded border
 *  and overflow clipping; the canvas layer above it stays fully transparent. */
const GRAPH_BACKDROP =
  'radial-gradient(ellipse 85% 75% at 50% 40%, #16203a 0%, #0d1326 45%, #070912 100%)';

/** Bucket colours, brightened for a dark field.
 *
 *  Same four meanings and the same hues as the light-theme badges (--good,
 *  --warn, the danger/warn mix, --danger) but at much higher lightness and
 *  chroma, so they read as coloured light rather than muddy paint on black.
 *  Kept as RGB triples so alpha variants compose without a colour parser. */
type Rgb = readonly [number, number, number];

const LUMINOUS: Record<Bucket, Rgb> = {
  strong: [86, 247, 178],
  fading: [255, 206, 92],
  weak: [255, 140, 84],
  critical: [255, 96, 118],
};

/** Cool light for the web between nodes. */
const LINK_RGB: Rgb = [150, 176, 255];
const LINK_ALPHA_FLOOR = 0.3;
const LINK_ALPHA_RANGE = 0.45;

const rgba = (c: Rgb, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

type SimNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
type SimLink = Omit<GraphEdge, 'source' | 'target'> & {
  source: string | SimNode;
  target: string | SimNode;
};

/** Core radius of a node's bright centre — bigger for better-connected notes. */
const coreRadius = (node: SimNode) => 2.2 + Math.min(node.degree, 8) * 0.55;

// ── Continuous drift ─────────────────────────────────────────────────────────
// d3 scales its own forces by alpha, so once the layout cools they stop acting
// and the graph freezes. This force ignores alpha and keeps nodes breathing:
// each one is nudged along a slow, phase-offset circle while a weak spring pulls
// it back toward an anchor that itself trails the node. The trailing anchor is
// what stops the drift accumulating into escape, so no restoring force from the
// cooled simulation is needed.

const DRIFT_FORCE = 0.03;
const DRIFT_SPRING = 0.0016;
const ANCHOR_FOLLOW = 0.0015;

interface ForceLike {
  (alpha: number): void;
  initialize?: (nodes: SimNode[]) => void;
}

function createDriftForce(): ForceLike {
  let nodes: SimNode[] = [];
  const anchors = new Map<string, { x: number; y: number }>();
  let tick = 0;

  const force: ForceLike = () => {
    tick += 1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.x == null || n.y == null) continue;

      let anchor = anchors.get(n.id);
      if (!anchor) {
        anchor = { x: n.x, y: n.y };
        anchors.set(n.id, anchor);
      }
      anchor.x += (n.x - anchor.x) * ANCHOR_FOLLOW;
      anchor.y += (n.y - anchor.y) * ANCHOR_FOLLOW;

      const phase = i * 1.7;
      n.vx = (n.vx ?? 0) + Math.cos(tick * 0.006 + phase) * DRIFT_FORCE
        - (n.x - anchor.x) * DRIFT_SPRING;
      n.vy = (n.vy ?? 0) + Math.sin(tick * 0.0047 + phase) * DRIFT_FORCE
        - (n.y - anchor.y) * DRIFT_SPRING;
    }
  };

  force.initialize = (ns) => {
    nodes = ns;
    anchors.clear();
  };
  return force;
}

// The typings model every force as a bare (alpha) => void, so reaching the real
// d3 force objects to configure them needs a cast.
interface ChargeForce {
  strength(v: number): ChargeForce;
  distanceMax(v: number): ChargeForce;
}
interface LinkForce {
  distance(fn: (link: SimLink) => number): LinkForce;
}

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
  const fgRef = useRef<ForceGraphMethods<SimNode, SimLink> | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  const isEmpty = !loading && nodes.length === 0;
  const hasNoEdges = !loading && nodes.length > 0 && edges.length === 0;
  const graphReady = !loading && !isEmpty && size.width > 0;

  // Tune the forces, reheat, and frame the result whenever the data changes.
  useEffect(() => {
    if (!graphReady) return;
    const fg = fgRef.current;
    if (!fg) return;

    const charge = fg.d3Force('charge') as unknown as ChargeForce | undefined;
    charge?.strength(-165).distanceMax(700);

    const link = fg.d3Force('link') as unknown as LinkForce | undefined;
    // Stronger links sit closer together, so clusters read as clusters.
    link?.distance((l) => 42 + (1 - clamp01(l.weight)) * 130);

    fg.d3Force('drift', createDriftForce() as never);
    fg.d3ReheatSimulation();

    const t = setTimeout(() => fgRef.current?.zoomToFit(700, 55), 700);
    return () => clearTimeout(t);
  }, [graphReady, graphData]);

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
            <div className="absolute inset-0 grid place-items-center text-sm text-[#9aa3c4]">
              Loading your graph...
            </div>
          )}

          {isEmpty && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center">
              <div>
                <p className="font-bold text-[#eef1fb]">No connections yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-[#9aa3c4]">
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
            <p className="absolute inset-x-0 top-0 z-10 border-b border-[rgba(150,176,255,0.18)] bg-[rgba(13,19,38,0.88)] px-3 py-2 text-center text-xs text-[#c3cbe6]">
              These notes have no links yet — rebuild to connect them.
            </p>
          )}

          {graphReady && (
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              nodeRelSize={4}
              nodeLabel={(node: SimNode) =>
                `${node.label} — ${BUCKET_LABELS[node.bucket]} (${Math.round(node.retention * 100)}%)`
              }
              nodeCanvasObjectMode={() => 'replace'}
              nodeCanvasObject={(node: SimNode, ctx: CanvasRenderingContext2D) => {
                if (node.x == null || node.y == null) return;
                const tint = LUMINOUS[node.bucket];
                const core = coreRadius(node);
                const halo = core * 5.5;

                // Soft halo, so the node reads as a light source rather than a dot.
                const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, halo);
                glow.addColorStop(0, rgba(tint, 0.4));
                glow.addColorStop(0.4, rgba(tint, 0.12));
                glow.addColorStop(1, rgba(tint, 0));
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(node.x, node.y, halo, 0, TAU);
                ctx.fill();

                ctx.save();
                ctx.shadowColor = rgba(tint, 0.95);
                ctx.shadowBlur = 14;
                ctx.fillStyle = rgba(tint, 1);
                ctx.beginPath();
                ctx.arc(node.x, node.y, core, 0, TAU);
                ctx.fill();
                ctx.restore();

                // White-hot centre keeps the hue readable at small sizes.
                ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
                ctx.beginPath();
                ctx.arc(node.x, node.y, core * 0.36, 0, TAU);
                ctx.fill();
              }}
              nodePointerAreaPaint={(
                node: SimNode,
                color: string,
                ctx: CanvasRenderingContext2D,
              ) => {
                if (node.x == null || node.y == null) return;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, coreRadius(node) + 4, 0, TAU);
                ctx.fill();
              }}
              linkCanvasObjectMode={() => 'replace'}
              linkCanvasObject={(link: SimLink, ctx: CanvasRenderingContext2D) => {
                const s = link.source as SimNode;
                const t = link.target as SimNode;
                if (typeof s !== 'object' || typeof t !== 'object') return;
                if (s.x == null || s.y == null || t.x == null || t.y == null) return;

                const w = clamp01(link.weight);
                ctx.save();
                // Additive blending so crossing threads brighten where they meet.
                ctx.globalCompositeOperation = 'lighter';
                // Floored alpha keeps the weakest links part of the web.
                ctx.strokeStyle = rgba(LINK_RGB, LINK_ALPHA_FLOOR + LINK_ALPHA_RANGE * w);
                ctx.lineWidth = 0.5 + 0.6 * w;
                ctx.shadowColor = rgba(LINK_RGB, 0.7);
                ctx.shadowBlur = 5;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(t.x, t.y);
                ctx.stroke();
                ctx.restore();
              }}
              onNodeClick={onNodeClick}
              d3AlphaDecay={0.014}
              d3VelocityDecay={0.32}
              // The drift force ignores alpha, so the engine must keep ticking
              // after the layout has cooled for the graph to stay alive.
              cooldownTicks={Infinity}
              cooldownTime={Infinity}
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
