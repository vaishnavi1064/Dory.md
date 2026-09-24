export const config = {
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  // Single source for the backend origin. Set VITE_API_URL in production.
  apiBaseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8001',
  discoveryPollMs: Number(import.meta.env.VITE_DISCOVERY_POLL_MS ?? 30000),
} as const;
