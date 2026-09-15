import { useEffect, useState } from "react";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  frostedDialogOverlay,
  frostedDialogPanel,
} from "@/components/ui/dialog";
import { IconPlugConnectedXFilled } from "@/components/shared/filled-icons";
import { SpotifyIcon } from "@/components/shared/brand-icons";
import { useSpotifyPanelDialog } from "@/lib/store/spotify-panel";
import { useSpotifyAccounts } from "@/lib/store/spotify-accounts";
import { useSettingsStore } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

/**
 * Dedicated Spotify panel, opened from the Integrations tab's "Manage
 * Spotify" row. Covers account linking today (OAuth connect/switch/
 * disconnect, multi-account); playlist import and background sync join
 * this panel once those pieces land.
 */
export function SpotifyPanelDialog() {
  const open = useSpotifyPanelDialog((s) => s.open);
  const setOpen = useSpotifyPanelDialog((s) => s.setOpen);

  const clientId = useSettingsStore((s) => s.spotifyClientId);
  const setClientId = useSettingsStore((s) => s.setSpotifyClientId);
  const [clientIdDraft, setClientIdDraft] = useState(clientId ?? "");
  useEffect(() => setClientIdDraft(clientId ?? ""), [clientId]);

  const { accounts, loading, connecting, refresh, connect, switchAccount, logout } =
    useSpotifyAccounts();

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleConnect = async () => {
    try {
      const account = await connect();
      toast.success(`Connected to Spotify as ${account.displayName}`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  };

  const handleLogout = async (id: string, name: string) => {
    try {
      await logout(id);
      toast.success(`Disconnected ${name} from Spotify`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={frostedDialogOverlay}
        className={cn(
          "w-[460px] max-w-[calc(100vw-2rem)] gap-5 rounded-2xl px-[26px] pb-[22px] pt-6 shadow-[0_30px_70px_-20px_var(--k850)] sm:max-w-[460px]",
          frostedDialogPanel,
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-px top-0 h-px bg-[linear-gradient(90deg,transparent,var(--w160),transparent)]"
        />
        <DialogClose className="absolute right-4 top-4 z-[2] grid size-7 cursor-pointer place-items-center rounded-lg border border-w070 bg-w030 text-t6 transition-colors duration-[140ms] hover:bg-w080 hover:text-t2">
          <IconX className="size-3" />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader className="gap-2 pr-[34px]">
          <DialogTitle className="flex items-center gap-2.5 text-2xl font-bold leading-none tracking-[-0.02em] text-t1">
            <SpotifyIcon className="size-6 shrink-0 text-[#1DB954]" />
            Spotify
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-[1.5] text-t4 text-pretty">
            Connect your own Spotify Developer app to link an account.
            Playlist import and sync land here once they're wired up.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="spotify-client-id"
            className="text-[13px] font-semibold text-t3"
          >
            Client ID
          </label>
          <Input
            id="spotify-client-id"
            value={clientIdDraft}
            onChange={(e) => setClientIdDraft(e.target.value)}
            onBlur={() => setClientId(clientIdDraft.trim() || null)}
            placeholder="From your own Spotify Developer app"
            className="h-9 text-[13px]"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <p className="text-[12px] leading-snug text-t7">
            Register an app at developer.spotify.com, add
            http://127.0.0.1/callback as a redirect URI, and paste its
            Client ID here. Not a secret — nothing else is needed.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {loading && accounts.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <IconLoader2 className="size-5 animate-spin text-t6" />
            </div>
          ) : (
            accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-w075 bg-w028 px-3 py-2.5"
              >
                <Avatar className="size-10 shrink-0">
                  {a.avatarUrl ? <AvatarImage src={a.avatarUrl} /> : null}
                  <AvatarFallback className="bg-w070 text-t5">
                    <SpotifyIcon className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold leading-tight text-t2">
                    {a.displayName}
                  </span>
                  {a.email ? (
                    <span className="truncate text-xs text-t7">
                      {a.email}
                    </span>
                  ) : null}
                </div>
                {a.isActive ? (
                  <span
                    className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium text-acc1"
                    style={{
                      borderColor: "rgba(var(--acc1rgb), 0.4)",
                      backgroundColor: "rgba(var(--acc1rgb), 0.1)",
                    }}
                  >
                    Active
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void switchAccount(a.id)}
                  >
                    Switch
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleLogout(a.id, a.displayName)}
                >
                  <IconPlugConnectedXFilled className="size-3.5" />
                </Button>
              </div>
            ))
          )}

          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={connecting}
            onClick={() => void handleConnect()}
          >
            {connecting ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <SpotifyIcon className="size-3.5" />
            )}
            {accounts.length > 0 ? "Add another account" : "Connect Spotify"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
