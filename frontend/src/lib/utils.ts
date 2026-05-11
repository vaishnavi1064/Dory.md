import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function computeRetention(
  createdAt: string,
  stabilityS: number,
  complexityK: number,
  offsetHours = 0
): number {
  const now = Date.now() + offsetHours * 3_600_000;
  const elapsedHours = (now - new Date(createdAt).getTime()) / 3_600_000;
  return Math.exp(-elapsedHours / (stabilityS * complexityK));
}

export function formatRetentionPct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatHours(hours: number): string {
  if (hours === 0) return 'now';
  if (hours < 24) return `+${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `+${days}d ${rem}h` : `+${days}d`;
}

export function urgencyLabel(avgRetention: number): 'low' | 'medium' | 'high' {
  if (avgRetention >= 0.7) return 'low';
  if (avgRetention >= 0.4) return 'medium';
  return 'high';
}

export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}
