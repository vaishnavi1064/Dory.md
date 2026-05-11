export function retentionToColor(retention: number): string {
  if (retention >= 0.72) return '#3a8d54';
  if (retention >= 0.5) return '#c97917';
  if (retention >= 0.28) return '#d66a2f';
  return '#c94433';
}

export function retentionToGlow(retention: number): string {
  if (retention >= 0.72) return 'rgba(58, 141, 84, 0.2)';
  if (retention >= 0.5) return 'rgba(201, 121, 23, 0.2)';
  if (retention >= 0.28) return 'rgba(214, 106, 47, 0.2)';
  return 'rgba(201, 68, 51, 0.2)';
}

export function retentionToLabel(retention: number): string {
  if (retention >= 0.72) return 'Strong';
  if (retention >= 0.5) return 'Fading';
  if (retention >= 0.28) return 'Weak';
  return 'Critical';
}

export const categoryColors: Record<string, string> = {
  technical: '#466fb0',
  personal: '#147a72',
  reference: '#c97917',
  general: '#6d5bd0',
};
