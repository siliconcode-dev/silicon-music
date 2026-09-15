import { create } from "zustand";

type State = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

/** Ephemeral visibility for the dedicated Spotify panel dialog, opened
 *  from the Integrations tab's "Manage Spotify" row. */
export const useSpotifyPanelDialog = create<State>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openSpotifyPanel(): void {
  useSpotifyPanelDialog.setState({ open: true });
}
