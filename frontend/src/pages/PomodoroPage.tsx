import { useState, useEffect, useRef, useCallback } from 'react';
import { RotateCcw, SkipForward, Timer, TrendingUp, Flame, Clock, Play, Pause, Target, Coffee, Check } from 'lucide-react';
import { Confetti } from '@/components/timer/Confetti';
import { ensureAudio, ensureNotifPermission, notify, playChime } from '@/lib/timerEffects';

type StandardMode = 'work' | 'short' | 'long';
type Mode = StandardMode | 'custom';
type CustomPhase = 'focus' | 'break' | 'complete';

const DURATIONS: Record<StandardMode, number> = { work: 25 * 60, short: 5 * 60, long: 15 * 60 };
const LABELS: Record<StandardMode, string> = { work: 'Focus', short: 'Short break', long: 'Long break' };
const COLORS: Record<StandardMode, string> = { work: 'var(--accent)', short: 'var(--good)', long: 'var(--warn)' };
const WORK_MIN = 25;
const SESSION_KEY = 'dory_pomodoro_v1';
const TIMER_KEY = 'dory_pomodoro_timer';

const CUSTOM_FOCUS_KEY = 'dory.timer.custom.focus';
const CUSTOM_BREAK_KEY = 'dory.timer.custom.break';
const CELEBRATE_KEY = 'dory.timer.celebrate';

const FOCUS_MIN_LIMIT = { min: 1, max: 180 };
const BREAK_MIN_LIMIT = { min: 1, max: 60 };

interface StoredSession {
  mode: StandardMode;
  at: string;
  date: string;
}

interface PomodoroStore {
  sessions: StoredSession[];
  totalCycles: number;
}

interface TimerState {
  mode: Mode;
  pausedRemaining: number;
  startedAt: number | null;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadStore(): PomodoroStore {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') ?? { sessions: [], totalCycles: 0 }; }
  catch { return { sessions: [], totalCycles: 0 }; }
}

function saveStore(store: PomodoroStore) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(store));
}

function loadTimerState(): TimerState {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null') ?? { mode: 'work', pausedRemaining: DURATIONS.work, startedAt: null }; }
  catch { return { mode: 'work', pausedRemaining: DURATIONS.work, startedAt: null }; }
}

function saveTimerState(state: TimerState) {
  localStorage.setItem(TIMER_KEY, JSON.stringify(state));
}

function computeRemaining(state: TimerState) {
  if (state.startedAt === null) return state.pausedRemaining;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  return Math.max(0, state.pausedRemaining - elapsed);
}

function fmt(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function lastNDays(n: number) {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

function celebrateEnabled() {
  return localStorage.getItem(CELEBRATE_KEY) !== 'false'; // default ON
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function standardPhaseEndNotice(finishedMode: StandardMode): { title: string; body: string } {
  switch (finishedMode) {
    case 'work':
      return { title: 'Focus done', body: 'Time for a break' };
    case 'short':
      return { title: 'Break over', body: 'Back to focus' };
    case 'long':
      return { title: 'Long break over', body: 'Back to focus' };
  }
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 112;

export function PomodoroPage() {
  const [timerState, setTimerStateRaw] = useState<TimerState>(loadTimerState);
  const [remaining, setRemaining] = useState(() => computeRemaining(loadTimerState()));
  const [store, setStore] = useState<PomodoroStore>(loadStore);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Custom timer state (independent of the three standard modes) ──────────
  const [focusStr, setFocusStr] = useState<string>(() => localStorage.getItem(CUSTOM_FOCUS_KEY) ?? '25');
  const [breakStr, setBreakStr] = useState<string>(() => localStorage.getItem(CUSTOM_BREAK_KEY) ?? '5');
  const [customPhase, setCustomPhase] = useState<CustomPhase>('focus');
  const [customRemaining, setCustomRemaining] = useState(25 * 60);
  const [customRunning, setCustomRunning] = useState(false);
  const [customActive, setCustomActive] = useState(false); // started (running or paused or complete)
  const [ringFlash, setRingFlash] = useState(false);
  const [completeMotion, setCompleteMotion] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const mode = timerState.mode;
  const running = timerState.startedAt !== null;
  const total = mode === 'custom' ? 0 : DURATIONS[mode];
  const progress = mode === 'custom' || total === 0 ? 0 : (total - remaining) / total;
  const color = mode === 'custom' ? 'var(--accent)' : COLORS[mode];

  function setTimerState(next: TimerState) {
    setTimerStateRaw(next);
    saveTimerState(next);
  }

  const triggerFlash = useCallback(() => {
    setRingFlash(true);
    window.setTimeout(() => setRingFlash(false), 600);
  }, []);

  const finish = useCallback(() => {
    if (mode === 'custom') return;
    const finishedMode = mode;
    const { title, body } = standardPhaseEndNotice(finishedMode);
    notify(title, body);
    void playChime();
    triggerFlash();
    const entry: StoredSession = { mode: finishedMode, at: new Date().toISOString(), date: todayKey() };
    setStore((prev) => {
      const nextStore = {
        sessions: [...prev.sessions, entry],
        totalCycles: finishedMode === 'work' ? prev.totalCycles + 1 : prev.totalCycles,
      };
      saveStore(nextStore);
      const nextMode: Mode = finishedMode === 'work'
        ? (nextStore.totalCycles % 4 === 0 && nextStore.totalCycles > 0 ? 'long' : 'short')
        : 'work';
      const nextTimer = { mode: nextMode, pausedRemaining: DURATIONS[nextMode as StandardMode], startedAt: null };
      setTimerState(nextTimer);
      setRemaining(DURATIONS[nextMode as StandardMode]);
      return nextStore;
    });
  }, [mode, triggerFlash]);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          finish();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, finish]);

  useEffect(() => {
    // Restore a persisted timer once on mount; `finish` is stable enough here.
    const state = loadTimerState();
    if (state.startedAt !== null) {
      const nextRemaining = computeRemaining(state);
      if (nextRemaining <= 0) finish();
      else setRemaining(nextRemaining);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startTimer() {
    ensureAudio();
    void ensureNotifPermission();
    setTimerState({ mode, pausedRemaining: remaining, startedAt: Date.now() });
  }

  function pauseTimer() {
    setTimerState({ mode, pausedRemaining: remaining, startedAt: null });
  }

  function reset() {
    if (mode === 'custom') return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setTimerState({ mode, pausedRemaining: DURATIONS[mode], startedAt: null });
    setRemaining(DURATIONS[mode]);
  }

  // ── Custom timer derived values ───────────────────────────────────────────
  const focusNum = parseInt(focusStr, 10);
  const breakNum = parseInt(breakStr, 10);
  const focusValid = Number.isFinite(focusNum) && focusNum >= FOCUS_MIN_LIMIT.min && focusNum <= FOCUS_MIN_LIMIT.max;
  const breakValid = Number.isFinite(breakNum) && breakNum >= BREAK_MIN_LIMIT.min && breakNum <= BREAK_MIN_LIMIT.max;
  // Start is allowed with at least one valid input. Three cycle paths:
  // both → Focus→Break→Complete · focus-only → Focus→Complete · break-only → Break→Complete.
  const customInputsValid = focusValid || breakValid;
  const focusSecs = (focusValid ? focusNum : 0) * 60;
  const breakSecs = (breakValid ? breakNum : 0) * 60;

  const inputsReadOnly = customActive;
  // Which phase the session starts in (Focus runs first whenever it's set).
  const startPhase: CustomPhase = focusValid ? 'focus' : 'break';
  // Phase that drives the live preview / ring before the session is active.
  const displayPhase: CustomPhase = customActive ? customPhase : startPhase;
  const idleSecs = startPhase === 'break' ? breakSecs : focusSecs;
  const customDisplaySecs = customPhase === 'complete' ? 0 : (customActive ? customRemaining : idleSecs);
  const customTotal = displayPhase === 'break' ? breakSecs : focusSecs;
  const customRingProgress = customPhase === 'complete' ? 1 : (customTotal > 0 ? (customTotal - customDisplaySecs) / customTotal : 0);
  const customColor = displayPhase === 'focus' ? 'var(--accent)' : 'var(--good)';
  const customLabel = customPhase === 'complete' ? 'Session complete' : displayPhase === 'break' ? 'Custom break' : 'Custom focus';
  let completeStat = '';
  if (focusValid && breakValid) completeStat = `\u2713 ${focusNum} min focused \u00b7 ${breakNum} min break`;
  else if (focusValid) completeStat = `\u2713 ${focusNum} min focused`;
  else if (breakValid) completeStat = `\u2713 ${breakNum} min break`;

  const completeSession = useCallback(() => {
    void playChime();
    setCustomRunning(false);
    setCustomPhase('complete');
    const motion = celebrateEnabled() && !prefersReducedMotion();
    setCompleteMotion(motion);
    setShowConfetti(motion);
  }, []);

  const endFocus = useCallback(() => {
    if (breakValid) {
      // Both-filled mode: hand off to the Break phase.
      notify('Focus done', `Time for a ${breakNum}-minute break`);
      void playChime();
      triggerFlash();
      setCustomPhase('break');
      setCustomRemaining(breakSecs);
    } else {
      // Focus-only mode: no Break follows, so the session is complete.
      notify('Focus done', 'Session complete');
      completeSession();
    }
  }, [breakNum, breakValid, breakSecs, triggerFlash, completeSession]);

  const endBreak = useCallback(() => {
    notify('Break over', 'Session complete');
    completeSession();
  }, [completeSession]);

  // Custom countdown tick.
  useEffect(() => {
    if (!customRunning) return;
    const id = setInterval(() => setCustomRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [customRunning]);

  // Phase-end watcher: fires when the running countdown reaches zero.
  useEffect(() => {
    if (!customRunning || customRemaining > 0) return;
    if (customPhase === 'focus') endFocus();
    else if (customPhase === 'break') endBreak();
  }, [customRunning, customRemaining, customPhase, endFocus, endBreak]);

  function onFocusChange(v: string) {
    setFocusStr(v);
    localStorage.setItem(CUSTOM_FOCUS_KEY, v);
  }

  function onBreakChange(v: string) {
    setBreakStr(v);
    localStorage.setItem(CUSTOM_BREAK_KEY, v);
  }

  function resetCustomSession() {
    setCustomRunning(false);
    setCustomActive(false);
    setCustomPhase('focus');
    setCompleteMotion(false);
    setShowConfetti(false);
  }

  function startOrResumeCustom() {
    ensureAudio();
    void ensureNotifPermission();
    if (!customActive) {
      setCustomActive(true);
      setCustomPhase(startPhase);
      setCustomRemaining(idleSecs);
      setCustomRunning(true);
    } else {
      setCustomRunning(true); // resume from pause
    }
  }

  function startAgain() {
    ensureAudio();
    void ensureNotifPermission();
    setCompleteMotion(false);
    setShowConfetti(false);
    setCustomActive(true);
    setCustomPhase(startPhase);
    setCustomRemaining(idleSecs);
    setCustomRunning(true);
  }

  function restartCustom() {
    if (customPhase === 'complete') {
      setCustomActive(false);
      setCustomRunning(false);
      setCustomPhase(startPhase);
      setCustomRemaining(idleSecs);
      setCompleteMotion(false);
      setShowConfetti(false);
      return;
    }
    setCustomRemaining(customPhase === 'break' ? breakSecs : focusSecs);
  }

  function skipCustom() {
    if (!customActive || customPhase === 'complete') return;
    if (customPhase === 'focus') endFocus();
    else endBreak();
  }

  function pauseCustom() { setCustomRunning(false); }

  const handleConfettiDone = useCallback(() => setShowConfetti(false), []);

  function switchMode(nextMode: Mode) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    resetCustomSession();
    if (nextMode === 'custom') {
      setTimerState({ mode: 'custom', pausedRemaining: 0, startedAt: null });
      return;
    }
    setTimerState({ mode: nextMode, pausedRemaining: DURATIONS[nextMode], startedAt: null });
    setRemaining(DURATIONS[nextMode]);
  }

  // Custom primary (Start / Pause / Start again) wiring.
  let customPrimaryLabel: 'Start' | 'Pause' | 'Start again' = 'Start';
  let customPrimaryAction = startOrResumeCustom;
  if (customPhase === 'complete') { customPrimaryLabel = 'Start again'; customPrimaryAction = startAgain; }
  else if (customRunning) { customPrimaryLabel = 'Pause'; customPrimaryAction = pauseCustom; }
  const customPrimaryDisabled = customPrimaryLabel === 'Start' && !customInputsValid;
  const customRestartTitle = customPhase === 'complete' ? 'Reset and edit values' : 'Restart current phase';

  const today = todayKey();
  const todaySessions = store.sessions.filter((session) => session.date === today);
  const todayWorkMin = todaySessions.filter((session) => session.mode === 'work').length * WORK_MIN;
  const allWorkSessions = store.sessions.filter((session) => session.mode === 'work').length;
  const allBreaks = store.sessions.filter((session) => session.mode !== 'work').length;
  const weekDays = lastNDays(7);
  const weekCounts = weekDays.map((day) => store.sessions.filter((session) => session.date === day && session.mode === 'work').length);
  const weekMax = Math.max(...weekCounts, 1);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="app-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <Timer size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold text-[var(--text-1)]">Focus timer</h1>
              <p className="text-sm text-[var(--text-3)]">A persistent timer for deep work around review sessions.</p>
            </div>
          </div>
          <span className="tag"><Flame size={14} /> {todayWorkMin}m today</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="app-card p-6">
          <div className="mb-6 grid grid-cols-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1">
            {(['work', 'short', 'long', 'custom'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={mode === m ? 'btn-primary' : 'btn-ghost'}
                style={mode === m ? { background: m === 'custom' ? 'var(--accent)' : COLORS[m] } : undefined}
              >
                {m === 'custom' ? 'Custom' : LABELS[m]}
              </button>
            ))}
          </div>

          {mode === 'custom' ? (
            <div className="flex flex-col items-center">
              <div className="mb-6 grid w-full max-w-sm grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                <div className="app-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-[var(--text-2)]">
                    <Target size={16} /> <span className="font-bold">Focus</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={FOCUS_MIN_LIMIT.min}
                      max={FOCUS_MIN_LIMIT.max}
                      value={focusStr}
                      readOnly={inputsReadOnly}
                      onChange={(e) => onFocusChange(e.target.value)}
                      aria-label="Focus duration in minutes"
                      className="timer-number-input w-full bg-transparent text-3xl font-extrabold text-[var(--text-1)] outline-none disabled:opacity-60"
                    />
                    <span className="text-sm text-[var(--text-3)]">min</span>
                  </div>
                </div>
                <div className="app-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-[var(--text-2)]">
                    <Coffee size={16} /> <span className="font-bold">Break</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={BREAK_MIN_LIMIT.min}
                      max={BREAK_MIN_LIMIT.max}
                      value={breakStr}
                      readOnly={inputsReadOnly}
                      onChange={(e) => onBreakChange(e.target.value)}
                      aria-label="Break duration in minutes"
                      className="timer-number-input w-full bg-transparent text-3xl font-extrabold text-[var(--text-1)] outline-none disabled:opacity-60"
                    />
                    <span className="text-sm text-[var(--text-3)]">min</span>
                  </div>
                </div>
              </div>

              <div className={`relative h-72 w-72 ${completeMotion && customPhase === 'complete' ? 'timer-settle-bounce' : ''}`}>
                <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
                  <circle cx="140" cy="140" r="112" fill="none" className="stroke-secondary" strokeWidth="16" />
                  <circle
                    cx="140"
                    cy="140"
                    r="112"
                    fill="none"
                    stroke={customColor}
                    strokeWidth="16"
                    strokeLinecap="round"
                    strokeDasharray={`${RING_CIRCUMFERENCE}`}
                    strokeDashoffset={`${(1 - customRingProgress) * RING_CIRCUMFERENCE}`}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <span
                  className={`pointer-events-none absolute inset-0 rounded-full ${ringFlash ? 'timer-phase-flash' : ''} ${completeMotion && customPhase === 'complete' ? 'timer-complete-pulse' : ''}`}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {customPhase === 'complete' ? (
                    <Check size={84} strokeWidth={2.5} className="text-[var(--good)]" />
                  ) : (
                    <p className="text-6xl font-extrabold tabular-nums" style={{ color: customColor }}>{fmt(customDisplaySecs)}</p>
                  )}
                  <p className="mt-2 text-sm font-bold text-[var(--text-3)]">{customLabel}</p>
                  {customPhase === 'complete' && completeStat && (
                    <p className="mt-1 text-xs font-bold text-[var(--text-3)]">{completeStat}</p>
                  )}
                  {customRunning && <span className="tag mt-3" style={{ color: customColor, borderColor: 'currentColor' }}>Running</span>}
                </div>
                {showConfetti && <Confetti onDone={handleConfettiDone} />}
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button type="button" onClick={restartCustom} className="btn-secondary h-11 w-11 p-0" title={customRestartTitle} aria-label={customRestartTitle}><RotateCcw size={17} /></button>
                <button
                  type="button"
                  onClick={customPrimaryAction}
                  disabled={customPrimaryDisabled}
                  className="btn-primary min-w-36"
                  style={{ background: customColor }}
                  aria-label={customPrimaryDisabled ? 'Enter a duration of at least 1 minute for Focus or Break' : undefined}
                >
                  {customRunning ? <Pause size={17} /> : <Play size={17} />}
                  {customPrimaryLabel}
                </button>
                <button type="button" onClick={skipCustom} className="btn-secondary h-11 w-11 p-0" title="Skip"><SkipForward size={17} /></button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="relative h-72 w-72">
                <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
                  <circle cx="140" cy="140" r="112" fill="none" className="stroke-secondary" strokeWidth="16" />
                  <circle
                    cx="140"
                    cy="140"
                    r="112"
                    fill="none"
                    stroke={color}
                    strokeWidth="16"
                    strokeLinecap="round"
                    strokeDasharray={`${RING_CIRCUMFERENCE}`}
                    strokeDashoffset={`${(1 - progress) * RING_CIRCUMFERENCE}`}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <span
                  className={`pointer-events-none absolute inset-0 rounded-full ${ringFlash ? 'timer-phase-flash' : ''}`}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-6xl font-extrabold tabular-nums" style={{ color }}>{fmt(remaining)}</p>
                  <p className="mt-2 text-sm font-bold text-[var(--text-3)]">{LABELS[mode]}</p>
                  {running && <span className="tag mt-3" style={{ color, borderColor: 'currentColor' }}>Running</span>}
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button type="button" onClick={reset} className="btn-secondary h-11 w-11 p-0" title="Reset"><RotateCcw size={17} /></button>
                <button type="button" onClick={running ? pauseTimer : startTimer} className="btn-primary min-w-36" style={{ background: color }}>
                  {running ? <Pause size={17} /> : <Play size={17} />}
                  {running ? 'Pause' : 'Start'}
                </button>
                <button type="button" onClick={finish} className="btn-secondary h-11 w-11 p-0" title="Skip"><SkipForward size={17} /></button>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="app-card p-4">
              <TrendingUp size={18} className="text-[var(--accent)]" />
              <p className="mt-3 text-3xl font-extrabold text-[var(--text-1)]">{allWorkSessions}</p>
              <p className="text-sm text-[var(--text-3)]">Work sessions</p>
            </div>
            <div className="app-card p-4">
              <Clock size={18} className="text-[var(--warn)]" />
              <p className="mt-3 text-3xl font-extrabold text-[var(--text-1)]">{allBreaks}</p>
              <p className="text-sm text-[var(--text-3)]">Breaks</p>
            </div>
          </div>

          <div className="app-card p-4">
            <p className="app-label mb-4">This week</p>
            <div className="flex h-28 items-end gap-2">
              {weekCounts.map((count, index) => {
                const height = count === 0 ? 6 : Math.max(12, Math.round((count / weekMax) * 88));
                const label = new Date(`${weekDays[index]}T12:00:00`).toLocaleDateString([], { weekday: 'short' }).slice(0, 2);
                return (
                  <div key={weekDays[index]} className="flex flex-1 flex-col items-center gap-2">
                    <div className="w-full rounded-t bg-[var(--accent)]" style={{ height, opacity: count ? 0.9 : 0.18 }} />
                    <span className="text-xs font-bold text-[var(--text-3)]">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="app-card p-4">
            <p className="app-label mb-3">Recent sessions</p>
            {store.sessions.length === 0 ? (
              <p className="text-sm text-[var(--text-3)]">No focus sessions logged yet.</p>
            ) : (
              <div className="space-y-2">
                {[...store.sessions].reverse().slice(0, 8).map((session, index) => (
                  <div key={`${session.at}-${index}`} className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">
                    <span className="font-bold text-[var(--text-2)]">{LABELS[session.mode]}</span>
                    <span className="text-[var(--text-3)]">{new Date(session.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
