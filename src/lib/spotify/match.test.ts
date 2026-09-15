import { describe, expect, it } from "vitest";
import { MATCH_FLOOR, scoreSpotifyCandidate, type SpotifyTrackQuery } from "@/lib/spotify/match";
import type { ShelfItem } from "@/lib/innertube/types";

function song(o: Partial<ShelfItem>): ShelfItem {
  return {
    kind: "song",
    id: "vid",
    title: "Untitled",
    thumbnails: [],
    ...o,
  };
}

describe("scoreSpotifyCandidate", () => {
  it("accepts an exact title/artist/duration match", () => {
    const q: SpotifyTrackQuery = {
      title: "Blinding Lights",
      artists: ["The Weeknd"],
      durationSec: 200,
    };
    const c = song({
      title: "Blinding Lights",
      artists: [{ name: "The Weeknd" }],
      duration: 200,
    });
    const score = scoreSpotifyCandidate(q, c);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(MATCH_FLOOR);
  });

  it("tolerates a few seconds of duration drift on an otherwise exact match", () => {
    const q: SpotifyTrackQuery = {
      title: "As It Was",
      artists: ["Harry Styles"],
      durationSec: 167,
    };
    const c = song({
      title: "As It Was",
      artists: [{ name: "Harry Styles" }],
      duration: 174,
    });
    expect(scoreSpotifyCandidate(q, c)!).toBeGreaterThanOrEqual(MATCH_FLOOR);
  });

  it("rejects a different song by the same artist at a similar duration", () => {
    // Two real Weeknd tracks in the same length neighborhood — a wrong
    // pick here means silently importing the wrong song, so identity has
    // to gate this even when duration alone would look plausible.
    const q: SpotifyTrackQuery = {
      title: "Save Your Tears",
      artists: ["The Weeknd"],
      durationSec: 215,
    };
    const c = song({
      title: "Blinding Lights",
      artists: [{ name: "The Weeknd" }],
      duration: 200,
    });
    expect(scoreSpotifyCandidate(q, c)).toBeNull();
  });

  it("rejects a same-title track by an unrelated artist", () => {
    const q: SpotifyTrackQuery = {
      title: "Stay",
      artists: ["The Kid LAROI", "Justin Bieber"],
      durationSec: 141,
    };
    const c = song({
      title: "Stay",
      artists: [{ name: "Rihanna" }],
      duration: 240,
    });
    expect(scoreSpotifyCandidate(q, c)).toBeNull();
  });

  it("accepts a subset artist credit (featured artist dropped)", () => {
    // The most common correct storage form across providers: one artist
    // out of a multi-artist credit survives on the destination side.
    const q: SpotifyTrackQuery = {
      title: "Stay",
      artists: ["The Kid LAROI", "Justin Bieber"],
      durationSec: 141,
    };
    const c = song({
      title: "Stay",
      artists: [{ name: "The Kid LAROI" }],
      duration: 141,
    });
    expect(scoreSpotifyCandidate(q, c)!).toBeGreaterThanOrEqual(MATCH_FLOOR);
  });

  it("penalizes a live/remix qualifier the query didn't ask for", () => {
    const q: SpotifyTrackQuery = {
      title: "Someone Like You",
      artists: ["Adele"],
      durationSec: 285,
    };
    const bare = song({
      title: "Someone Like You",
      artists: [{ name: "Adele" }],
      duration: 285,
    });
    const live = song({
      title: "Someone Like You (Live)",
      artists: [{ name: "Adele" }],
      duration: 285,
    });
    const bareScore = scoreSpotifyCandidate(q, bare)!;
    const liveScore = scoreSpotifyCandidate(q, live) ?? 0;
    expect(bareScore).toBeGreaterThan(liveScore);
  });

  it("ignores non-song/video rows entirely", () => {
    const q: SpotifyTrackQuery = { title: "Anything", artists: ["Someone"] };
    const c = song({ kind: "album", title: "Anything", artists: [{ name: "Someone" }] });
    expect(scoreSpotifyCandidate(q, c)).toBeNull();
  });
});
