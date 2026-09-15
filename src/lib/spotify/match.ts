import {
  artistScore,
  durationScore,
  parseTitle,
  qualifierFactor,
  titleIdentity,
} from "@/lib/lyrics/match";
import { fetchSearch } from "@/lib/innertube/search";
import type { ShelfItem } from "@/lib/innertube/types";

/**
 * Spotify -> YouTube Music track matching.
 *
 * YTM's own search has no shared identifier with Spotify to key off of —
 * `ShelfItem` carries no ISRC (confirmed by grep across the InnerTube
 * layer), and a raw ISRC string as a YTM search query reliably returns
 * nothing (this is a known InnerTube limitation, not something worth
 * working around here). So the industry-standard fallback for exactly
 * this situation — used by playlist-transfer tools like Soundiiz and
 * TuneMyMusic once no shared ID is available — is what this module does:
 * normalized title + artist agreement, scored, with duration as a
 * tiebreaker rather than a primary signal.
 *
 * The scoring itself reuses `lib/lyrics/match.ts`'s text primitives
 * (`parseTitle`, `titleIdentity`, `qualifierFactor`, `artistScore`,
 * `durationScore`) rather than re-deriving them: those were tuned against
 * real provider data for the exact same underlying problem — "is this
 * search hit the track I asked for" — and the hard-won rules there
 * (artist must agree, title similarity alone proves nothing, qualifiers
 * like "remix"/"live" veto but "remastered" doesn't, subset artist
 * credits are normal) apply just as much to a YTM search hit as to a
 * lyrics provider's. What's dropped is everything specific to a lyrics
 * *body* (empty-body checks, synced-lyrics overhang) — there is no body
 * here, only title/artist/duration.
 *
 * No fuzzy system reaches "always right" without a shared ID on both
 * sides — remixes, live takes, and regional re-releases can legitimately
 * share a title and artist at a similar duration. The floor below is
 * deliberately conservative: a track that doesn't clear it is reported
 * as unmatched rather than guessed into a playlist, per the decision to
 * never silently add the wrong song.
 */

export type SpotifyTrackQuery = {
  title: string;
  /** Credited artist names, in Spotify's own order. */
  artists: string[];
  durationSec?: number;
  /** Spotify's ISRC for this track, if present. Not used for the YTM
   *  search itself — carried through only so a future direct-ID
   *  crosswalk (or just a cache key) has it available. */
  isrc?: string;
};

export type SpotifyMatch = {
  videoId: string;
  title: string;
  artists: string[];
  album?: string;
  duration?: number;
  /** 0-1. See MATCH_FLOOR for the acceptance threshold. */
  confidence: number;
};

export type SpotifyMatchResult =
  | { status: "matched"; query: SpotifyTrackQuery; match: SpotifyMatch }
  | { status: "unmatched"; query: SpotifyTrackQuery };

/** Below this, report unmatched rather than the best of a bad set. Higher
 *  than the lyrics scorer's floor (0.55): a wrong lyrics pick is a visible
 *  annoyance the user can retry, a wrong playlist track is a silent,
 *  easy-to-miss error. */
export const MATCH_FLOOR = 0.72;

/** Scripts where a title can legitimately share zero characters with its
 *  own romanization or translation (see `lyrics/match.ts`'s cross-script
 *  handling). Two all-Latin titles that happen to share no bigrams are
 *  not a script mismatch — they're just two different songs, e.g. two
 *  unrelated tracks by the same artist ("Save Your Tears" vs "Blinding
 *  Lights"), which a perfect artist score must not paper over. */
const NON_LATIN_SCRIPT =
  /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function mightBeCrossScript(a: string, b: string): boolean {
  return NON_LATIN_SCRIPT.test(a) || NON_LATIN_SCRIPT.test(b);
}

function durationDelta(
  q: SpotifyTrackQuery,
  c: ShelfItem,
): number | undefined {
  if (q.durationSec === undefined || !c.duration) return undefined;
  return Math.round(c.duration) - Math.round(q.durationSec);
}

/**
 * Score one YTM search hit against a Spotify track. Pure and
 * network-free so it's unit-testable on its own — `matchSpotifyTrack`
 * below is the only caller that also does I/O.
 */
export function scoreSpotifyCandidate(
  q: SpotifyTrackQuery,
  c: ShelfItem,
): number | null {
  if (c.kind !== "song" && c.kind !== "video") return null;

  const queryArtist = q.artists.join(", ");
  const candidateArtist = (c.artists ?? []).map((a) => a.name).join(", ");
  if (!queryArtist.trim() || !candidateArtist.trim()) return null;

  const qTitle = parseTitle(q.title, queryArtist);
  const cTitle = parseTitle(c.title, candidateArtist);

  const identity = titleIdentity(qTitle, cTitle);
  const crossScript = identity === 0 && mightBeCrossScript(q.title, c.title);
  const aScore = artistScore(queryArtist, candidateArtist, durationDelta(q, c));

  if (crossScript) {
    // No shared characters is uninformative rather than negative (e.g. a
    // Cyrillic Spotify title against a transliterated YTM one) — the
    // artist has to carry the whole decision when this happens.
    if (aScore < 0.85) return null;
  } else if (identity < 0.85) {
    return null;
  }

  if (aScore < 0.45) return null;

  const delta = durationDelta(q, c);
  const dScore =
    q.durationSec === undefined || c.duration === undefined
      ? 0.5
      : durationScore(delta);

  const qFactor = qualifierFactor(qTitle, cTitle);

  const score =
    (crossScript ? 0.9 : identity) * aScore * qFactor * (0.55 + 0.45 * dScore);
  return Math.max(0, Math.min(1, score));
}

/** Runs a Spotify track through YTM search and returns the best match
 *  above `MATCH_FLOOR`, or `null` when nothing clears it (including a
 *  search transport failure — treated the same as no result, since the
 *  caller's job either way is to report this one track as unmatched and
 *  move on rather than fail the whole import). */
export async function matchSpotifyTrack(
  query: SpotifyTrackQuery,
): Promise<SpotifyMatch | null> {
  const searchQuery = `${query.title} ${query.artists.join(" ")}`.trim();
  if (!searchQuery) return null;

  let candidates: ShelfItem[];
  try {
    const results = await fetchSearch(searchQuery, "songs");
    candidates = results.shelves.flatMap((s) => s.items);
  } catch {
    return null;
  }

  let best: { item: ShelfItem; score: number } | null = null;
  for (const item of candidates) {
    const score = scoreSpotifyCandidate(query, item);
    if (score === null) continue;
    if (!best || score > best.score) best = { item, score };
  }
  if (!best || best.score < MATCH_FLOOR) return null;

  return {
    videoId: best.item.id,
    title: best.item.title,
    artists: (best.item.artists ?? []).map((a) => a.name),
    album: best.item.album,
    duration: best.item.duration,
    confidence: best.score,
  };
}

export type MatchProgress = { done: number; total: number };

/**
 * Matches many Spotify tracks against YTM search with bounded
 * concurrency, so a several-hundred-track playlist import doesn't fire
 * that many `search` calls at once. A small hand-rolled worker pool
 * rather than a dependency: the whole thing is a shared cursor plus a
 * fixed number of loops racing over it.
 */
export async function matchSpotifyTracks(
  tracks: SpotifyTrackQuery[],
  opts: { concurrency?: number; onProgress?: (p: MatchProgress) => void } = {},
): Promise<SpotifyMatchResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const results: SpotifyMatchResult[] = new Array(tracks.length);
  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= tracks.length) return;
      const query = tracks[i];
      const match = await matchSpotifyTrack(query);
      results[i] = match ? { status: "matched", query, match } : { status: "unmatched", query };
      done++;
      opts.onProgress?.({ done, total: tracks.length });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tracks.length) }, worker),
  );
  return results;
}
