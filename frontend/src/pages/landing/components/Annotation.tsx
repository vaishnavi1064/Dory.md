import { clsx } from 'clsx';

interface AnnotationProps {
  children: string;
  className?: string;
  /** Which way the hand-drawn arrow sweeps out of the text. */
  arrow?: 'down-left' | 'down-right' | 'up-right';
}

/** Handwritten marginalia with a hand-drawn arrow.
 *
 *  Desktop only — .landing-annotation is display:none until 1280px, because
 *  these sit in margin space that simply does not exist on a phone. Decorative,
 *  so the whole thing is aria-hidden.
 */
const ARROWS: Record<NonNullable<AnnotationProps['arrow']>, string> = {
  // Hand-wobbled cubics rather than clean curves, so they read as drawn.
  'down-left': 'M78 6 C 60 26, 40 34, 14 52',
  'down-right': 'M8 6 C 26 26, 48 34, 74 54',
  'up-right': 'M8 56 C 26 36, 48 24, 74 8',
};

const HEADS: Record<NonNullable<AnnotationProps['arrow']>, string> = {
  'down-left': 'M14 52 l 12 -4 M14 52 l 3 -12',
  'down-right': 'M74 54 l -12 -3 M74 54 l -3 -12',
  'up-right': 'M74 8 l -12 2 M74 8 l -1 12',
};

export function Annotation({ children, className, arrow = 'down-right' }: AnnotationProps) {
  return (
    <div aria-hidden className={clsx('landing-annotation', className)}>
      <p className="max-w-[13rem] -rotate-3">{children}</p>
      <svg
        viewBox="0 0 84 62"
        width="74"
        height="56"
        fill="none"
        className="mt-1 opacity-80"
        stroke="oklch(var(--lavender) / 0.8)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ARROWS[arrow]} />
        <path d={HEADS[arrow]} />
      </svg>
    </div>
  );
}
