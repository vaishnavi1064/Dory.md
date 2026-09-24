/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCKS: string
  readonly VITE_API_URL: string
  readonly VITE_DISCOVERY_POLL_MS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
