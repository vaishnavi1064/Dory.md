import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Heart, Loader2 } from 'lucide-react';
import {
  MOODS,
  MOOD_CHART_COLORS,
  MOOD_CHANGED_EVENT,
  isMoodAskEnabled,
  type Mood,
  type MoodStatsResponse,
  fetchMoodStats,
} from '@/lib/mood';

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '365 days', days: 365 },
] as const;

export function MoodDashboard() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<MoodStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [askEnabled, setAskEnabled] = useState(isMoodAskEnabled);

  useEffect(() => {
    const sync = () => setAskEnabled(isMoodAskEnabled());
    window.addEventListener(MOOD_CHANGED_EVENT, sync);
    return () => window.removeEventListener(MOOD_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchMoodStats(days)
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setError('Could not load mood stats.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const barData = useMemo(
    () => MOODS.map(({ value, emoji, label }) => ({
      mood: `${emoji} ${label}`,
      key: value,
      count: stats?.mood_counts[value] ?? 0,
    })),
    [stats],
  );

  const pieData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'Create', value: stats.event_counts.create },
      { name: 'Review', value: stats.event_counts.review },
      { name: 'Quiz', value: stats.event_counts.quiz },
    ].filter((d) => d.value > 0);
  }, [stats]);

  const eventColors = ['var(--accent)', 'var(--good)', 'var(--warn)'];

  const lineData = useMemo(() => {
    if (!stats) return [];
    return stats.mood_over_time.map((row) => {
      const point: Record<string, string | number> = { date: row.date.slice(5) };
      for (const { value } of MOODS) {
        point[value] = row[value] ?? 0;
      }
      return point;
    });
  }, [stats]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[var(--text-3)]">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="app-card p-8 text-center">
        <p className="font-bold text-[var(--text-1)]">{error || 'No data'}</p>
      </div>
    );
  }

  const moodPageHeader = (
    <header className="mb-2">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Heart size={18} />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text-1)]">Your mood patterns</h1>
          <p className="text-sm text-[var(--text-3)]">How you&apos;ve been feeling across notes, reviews, and quizzes.</p>
        </div>
      </div>
    </header>
  );

  if (!askEnabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {moodPageHeader}
        <div className="app-card p-8 text-center">
          <p className="text-sm text-[var(--text-2)]">
            Mood tracking is paused. Enable &apos;Ask about my mood&apos; in Settings to
            start logging again.
          </p>
          <Link to="/settings" className="btn-primary mt-4 inline-flex">Open Settings</Link>
        </div>
      </div>
    );
  }

  if (stats.total_logs < 5) {
    const emptyMessage = stats.total_logs === 0
      ? "No mood data yet. Dory asks how you're feeling when you create notes, review chunks, or finish quizzes. Log 5 moods to see your patterns here."
      : `Almost there. You've logged ${stats.total_logs} of 5 moods needed to see patterns. Keep logging when you create notes, review, or quiz.`;

    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {moodPageHeader}
        <div className="app-card p-8 text-center">
          <p className="text-sm text-[var(--text-2)]">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Heart size={18} />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text-1)]">Your mood patterns</h1>
            <p className="text-sm text-[var(--text-3)]">How you&apos;ve been feeling across notes, reviews, and quizzes.</p>
          </div>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="corp-input h-9 w-auto min-w-[120px]"
          aria-label="Time range"
        >
          {RANGES.map(({ label, days: d }) => (
            <option key={d} value={d}>{label}</option>
          ))}
        </select>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.insights.slice(0, 4).map((text) => (
          <div key={text} className="app-card-muted p-4 text-sm font-medium text-[var(--text-2)]">{text}</div>
        ))}
      </div>

      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <div className="app-card p-5">
          <h2 className="app-section-title mb-4">Mood frequency</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="mood" tick={{ fontSize: 11, fill: 'var(--text-3)' }} interval={0} angle={-20} textAnchor="end" height={56} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {barData.map((entry) => (
                    <Cell key={entry.key} fill={MOOD_CHART_COLORS[entry.key as Mood]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="app-card p-5">
          <h2 className="app-section-title mb-4">By event type</h2>
          <div className="h-64">
            {pieData.length === 0 ? (
              <p className="text-sm text-[var(--text-3)]">No events in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={eventColors[i % eventColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="app-card p-5">
        <h2 className="app-section-title mb-4">Mood over time</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
              <Tooltip />
              <Legend />
              {MOODS.map(({ value, label }) => (
                <Line
                  key={value}
                  type="monotone"
                  dataKey={value}
                  name={label}
                  stroke={MOOD_CHART_COLORS[value]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
