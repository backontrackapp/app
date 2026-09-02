/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_RING_PURCHASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
