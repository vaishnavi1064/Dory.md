import { BookOpen, BrainCircuit, Search, Sparkles, Upload } from 'lucide-react';

/**
 * A styled, static picture of the Dory dashboard.
 *
 * TIER-2 SWAP POINT. Deliberately NOT the real app: no data fetching, no auth,
 * no shared components with /dashboard, so the marketing page can never break
 * because a product surface changed. Everything here is hardcoded copy.
 *
 * Colours are pinned dark rather than themed, for the same reason the graph
 * field is: this is a photograph of the product sitting on a dark band, not a
 * surface the visitor is meant to interact with. It keeps its look in both
 * themes.
 *
 * The 3D tilt lives on the wrapper (.landing-stage / .landing-tilt in Hero), so
 * an R3F replacement can drop into the same slot without touching layout.
 */

const BUCKETS = [
  { label: 'STRONG', count: 12, color: 'var(--good)' },
  { label: 'FADING', count: 8, color: 'var(--warn)' },
  { label: 'WEAK', count: 6, color: 'var(--weak)' },
  { label: 'CRITICAL', count: 3, color: 'var(--danger)' },
];

const REVIEW = [
  { title: 'Attention is all you need — scaled dot-product', due: 'Due now', pct: 34 },
  { title: 'CAP theorem: pick CP or AP', due: 'Due now', pct: 21 },
  { title: 'FSRS stability vs. difficulty', due: 'In 2h', pct: 58 },
];

const CATEGORIES = [
  { name: 'AI / ML', pct: 72, color: 'var(--violet)' },
  { name: 'Systems', pct: 54, color: 'var(--info)' },
  { name: 'Productivity', pct: 41, color: 'var(--warn)' },
  { name: 'Personal', pct: 23, color: 'var(--danger)' },
];

const ACTIONS = [
  { icon: Upload, label: 'Upload' },
  { icon: Search, label: 'Search' },
  { icon: BrainCircuit, label: 'Quiz' },
  { icon: BookOpen, label: 'Library' },
];

export function DashboardMock() {
  return (
    <div className="landing-mock w-full select-none" aria-hidden>
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-[oklch(1_0_0/0.08)] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.72_0.16_25)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.82_0.14_80)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.78_0.14_150)]" />
        <span className="ml-3 text-[0.7rem] font-semibold text-[var(--landing-deep-subtle)]">
          dory.md / memory health
        </span>
      </div>

      <div className="space-y-3 p-4">
        {/* bucket counts */}
        <div className="grid grid-cols-4 gap-2">
          {BUCKETS.map((b) => (
            <div key={b.label} className="landing-mock-row px-2.5 py-2.5">
              <p
                className="text-[0.56rem] font-extrabold tracking-[0.1em]"
                style={{ color: b.color }}
              >
                {b.label}
              </p>
              <p className="mt-1 text-[1.45rem] font-extrabold leading-none text-[var(--landing-deep-fg)]">
                {b.count}
              </p>
            </div>
          ))}
        </div>

        {/* today's review */}
        <div className="landing-mock-row p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[0.72rem] font-extrabold text-[var(--landing-deep-fg)]">
              Today&rsquo;s review
            </p>
            <span className="rounded-full bg-[oklch(var(--lavender)/0.18)] px-2 py-0.5 text-[0.6rem] font-bold text-[oklch(var(--lavender))]">
              3 due
            </span>
          </div>
          <div className="space-y-2">
            {REVIEW.map((r) => (
              <div key={r.title} className="flex items-center gap-2.5">
                <div className="h-6 w-1 shrink-0 rounded-full bg-[oklch(var(--lavender)/0.5)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.68rem] font-semibold text-[var(--landing-deep-muted)]">
                    {r.title}
                  </p>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[oklch(1_0_0/0.08)]">
                    <div
                      className="h-full rounded-full bg-[oklch(var(--lavender))]"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-[0.6rem] font-bold text-[var(--landing-deep-subtle)]">
                  {r.due}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* knowledge by category */}
          <div className="landing-mock-row p-3">
            <p className="mb-2.5 text-[0.72rem] font-extrabold text-[var(--landing-deep-fg)]">
              Knowledge by category
            </p>
            <div className="space-y-2">
              {CATEGORIES.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between">
                    <span className="text-[0.62rem] font-semibold text-[var(--landing-deep-muted)]">
                      {c.name}
                    </span>
                    <span className="text-[0.62rem] font-bold text-[var(--landing-deep-subtle)]">
                      {c.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[oklch(1_0_0/0.08)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${c.pct}%`, background: c.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* quick actions */}
          <div className="landing-mock-row p-3">
            <p className="mb-2.5 text-[0.72rem] font-extrabold text-[var(--landing-deep-fg)]">
              Quick actions
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <div
                  key={a.label}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-[oklch(1_0_0/0.08)] bg-[oklch(1_0_0/0.03)] px-2 py-2"
                >
                  <a.icon size={13} className="text-[oklch(var(--lavender))]" />
                  <span className="text-[0.62rem] font-bold text-[var(--landing-deep-muted)]">
                    {a.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[oklch(var(--lavender)/0.12)] px-2 py-1.5">
              <Sparkles size={12} className="shrink-0 text-[oklch(var(--lavender))]" />
              <span className="truncate text-[0.6rem] font-bold text-[oklch(var(--lavender))]">
                2 notes are slipping
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
