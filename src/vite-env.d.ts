/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * WebSocket URL of the authoritative game server, e.g. ws://localhost:2567.
   * When unset the game runs offline against the local reducer instead.
   */
  readonly VITE_GAME_SERVER?: string;
  readonly VITE_GAME_BUILD_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
