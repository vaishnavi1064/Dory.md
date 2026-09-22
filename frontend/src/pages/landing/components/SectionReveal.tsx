import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { VIEWPORT, sectionReveal, useMotionPolicy } from '../motion';

interface SectionRevealProps {
  children: ReactNode;
  className?: string;
  /** Rendered as <section id> so the nav's anchor links have a target. */
  id?: string;
  as?: 'section' | 'div';
  delay?: number;
}

/** Fade + rise a block into view once, honouring reduced motion. */
export function SectionReveal({
  children,
  className,
  id,
  as = 'section',
  delay = 0,
}: SectionRevealProps) {
  const { variants } = useMotionPolicy();
  const Tag = as === 'section' ? motion.section : motion.div;

  return (
    <Tag
      id={id}
      className={className}
      variants={variants(sectionReveal)}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      transition={delay ? { delay } : undefined}
    >
      {children}
    </Tag>
  );
}
