/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MU_API?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
