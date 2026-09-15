import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { useSettingsStore } from "@/lib/store/settings";

/** Mirrors `SpotifyAccountSummary` in `src-tauri/src/spotify_auth.rs`. */
export type SpotifyAccountSummary = {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isActive: boolean;
};

type BeginLoginResponse = {
  loginId: string;
  authorizeUrl: string;
};

type State = {
  accounts: SpotifyAccountSummary[];
  /** True while `list_accounts` is in flight. */
  loading: boolean;
  /** True from the moment the browser tab opens until the callback lands
   *  (or the login is cancelled/times out) — a single login at a time. */
  connecting: boolean;
  refresh: () => Promise<void>;
  /** Opens the system browser for a fresh Spotify login using the Client
   *  ID from Settings, and resolves once the account is linked. Throws
   *  with a human-readable message on failure (no configured Client ID,
   *  denied consent, timeout, network error) for the caller to toast. */
  connect: () => Promise<SpotifyAccountSummary>;
  switchAccount: (id: string) => Promise<void>;
  logout: (id: string) => Promise<void>;
};

/**
 * Client-side mirror of the Rust-owned Spotify account list
 * (`spotify_accounts.json` + per-account encrypted tokens). Not
 * persisted here — Rust is the source of truth, this store just caches
 * the last `list_accounts` result so the panel doesn't flash empty on
 * every render. Call `refresh()` after mount and after any mutation.
 */
export const useSpotifyAccounts = create<State>()((set, get) => ({
  accounts: [],
  loading: false,
  connecting: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const accounts = await invoke<SpotifyAccountSummary[]>(
        "spotify_list_accounts",
      );
      set({ accounts });
    } finally {
      set({ loading: false });
    }
  },

  connect: async () => {
    if (get().connecting) {
      throw new Error("A Spotify login is already in progress.");
    }
    const clientId = useSettingsStore.getState().spotifyClientId?.trim();
    if (!clientId) {
      throw new Error(
        "Add your Spotify Client ID above before connecting an account.",
      );
    }
    set({ connecting: true });
    try {
      const { loginId, authorizeUrl } = await invoke<BeginLoginResponse>(
        "spotify_begin_login",
        { clientId },
      );
      await openUrl(authorizeUrl);
      const account = await invoke<SpotifyAccountSummary>(
        "spotify_await_login",
        { loginId },
      );
      await get().refresh();
      return account;
    } finally {
      set({ connecting: false });
    }
  },

  switchAccount: async (id) => {
    await invoke("spotify_switch_account", { id });
    await get().refresh();
  },

  logout: async (id) => {
    await invoke("spotify_logout", { id });
    await get().refresh();
  },
}));
