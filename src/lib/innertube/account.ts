import { innertubePost, type YtNode } from "./shared";

export type AccountInfo = {
  name: string;
  email: string;
  photoUrl?: string;
};

/**
 * Pull the signed-in user's display name, email and avatar from
 * `account/account_menu`. Anonymous calls return a generic sign-in
 * popup with no `activeAccountHeaderRenderer` — we treat that as
 * "not signed in" and return null.
 *
 * A transport failure REJECTS; it must never resolve to `null`. The
 * two used to be indistinguishable, which is what made the app claim
 * you were signed out after a cold boot or a resume from standby: the
 * request failed because the NIC wasn't up yet, the caller cached that
 * `null` as fresh authoritative data, and the sidebar rendered a
 * sign-in button at a session that was perfectly alive. `null` now
 * means one thing only: Google answered, and said anonymous.
 */
export async function fetchAccountInfo(): Promise<AccountInfo | null> {
  let json: YtNode;
  try {
    json = await innertubePost("account/account_menu", {});
  } catch (e) {
    console.warn("[auth] account_menu failed:", e);
    throw e;
  }

  const header: YtNode | undefined =
    json?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header
      ?.activeAccountHeaderRenderer;
  if (!header) return null;

  const readText = (node: YtNode | undefined): string =>
    node?.simpleText ??
    (node?.runs ?? [])
      .map((r: YtNode) => r?.text ?? "")
      .join("") ??
    "";

  const name = readText(header.accountName);
  const email = readText(header.email);
  const photos: YtNode[] = header.accountPhoto?.thumbnails ?? [];
  const photoUrl = photos[photos.length - 1]?.url as string | undefined;

  if (!name && !email) return null;
  return { name, email, photoUrl };
}
