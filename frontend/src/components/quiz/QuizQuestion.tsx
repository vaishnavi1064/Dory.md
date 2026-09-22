import { useState } from 'react';
import { CheckCircle2, Lightbulb, ChevronRight, Timer } from 'lucide-react';
import type { QuizQuestion as QuizQuestionType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { categoryColors } from '@/styles/theme';

interface QuizQuestionProps {
  question: QuizQuestionType;
  questionNumber: number;
  total: number;
  onAnswer: (selectedIndex: number, timeTakenMs: number) => void;
}

export function QuizQuestion({ question, questionNumber, total, onAnswer }: QuizQuestionProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [startTime] = useState(Date.now());
  const catColor = categoryColors[question.category] ?? 'var(--accent)';
  const progress = ((questionNumber - 1) / total) * 100;

  // Answers are graded server-side and revealed on the results screen. The
  // client is not told the correct option while the quiz is running, so the
  // choice can be changed until it is committed with Next.
  function handleSelect(idx: number) {
    setSelected(idx);
  }

  function handleNext() {
    if (selected === null) return;
    onAnswer(selected, Date.now() - startTime);
    setSelected(null);
    setShowHint(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="app-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-[var(--text-2)]">Question {questionNumber} of {total}</span>
          <span className="tag capitalize" style={{ color: catColor, background: `color-mix(in oklab, ${catColor} 8%, transparent)`, borderColor: `color-mix(in oklab, ${catColor} 27%, transparent)` }}>
            <Timer size={13} /> {question.difficulty} {question.category}
          </span>
        </div>
        <div className="retention-bar-track">
          <div className="retention-bar-fill bg-[var(--accent)]" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="app-card p-5">
        <p className="text-lg font-bold leading-relaxed text-[var(--text-1)]">{question.question}</p>

        {question.hint && (
          <button type="button" onClick={() => setShowHint(!showHint)} className="btn-ghost mt-4">
            <Lightbulb size={15} />
            {showHint ? 'Hide hint' : 'Show hint'}
          </button>
        )}

        {showHint && question.hint && (
          <div className="mt-3 rounded-lg border border-[color-mix(in_oklab,var(--info)_25%,transparent)] bg-[color-mix(in_oklab,var(--info)_8%,transparent)] p-3 text-sm text-[var(--text-2)]">
            {question.hint}
          </div>
        )}

        <div className="mt-5 space-y-2">
          {question.options.map((option, idx) => {
            const isSelected = idx === selected;

            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(idx)}
                aria-pressed={isSelected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-bold transition',
                  isSelected
                    ? 'border-[var(--accent-border)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--text-1)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--accent-border)] hover:bg-[var(--surface)]'
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/30 text-xs">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="flex-1">{option}</span>
                {isSelected && <CheckCircle2 size={17} className="text-[var(--accent)]" />}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={selected === null}
          className="btn-primary mt-5 w-full"
        >
          {questionNumber === total ? 'See results' : 'Next question'}
          <ChevronRight size={15} />
        </button>
        <p className="mt-2 text-center text-sm text-[var(--text-4)]">
          {questionNumber === total
            ? 'Your answers are graded when you finish.'
            : 'You can change your answer until you move on.'}
        </p>
      </div>
    </div>
  );
}
