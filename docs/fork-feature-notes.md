# Ideas and improvements from forks

Snapshot of the `NUber-dev/YTubic` fork network from July 15, 2026. This is a
list of ideas for later triage, not a ready merge plan: the larger branches
conflict with `main`, so changes should be ported as small, themed commits
with tests.

Updated 2026-09-15: the project (now Silicon Music) is focused exclusively
on Windows, and the Premium gate has been removed entirely. The "Platforms"
section and the macOS item below are no longer relevant and are kept as
historical context; the Premium rule under "Do not port" no longer applies
— see the commit that removed the gate.

## Player

- Persist the last track and playhead, restore them after a restart
  (`ameenalasady`, `5510d22`).
- Restore the last page and scroll position (`ameenalasady`, `f41d57f`).
- Fix double duration on some streams on macOS and incorrect seek before
  metadata loads.
- Add a fallback between yt-dlp clients (`android_vr`, `ios`) on DRM/403,
  and a fallback from video to audio.
- Make Song/Video a real audio/video stream switch, including a separate
  video cache.
- Carefully skip long empty outros in extended uploads.
- Add a fullscreen player with large cover art, lyrics, ambient background
  and accent color.

## Lyrics

- Add provider timeouts so the panel doesn't hang on Loading.
- Reject lyrics from a different song more strictly: account for artist,
  duration, and remix/live qualifiers.
- Scale timestamps for sped-up/slowed versions and support a manual
  per-track offset.
- Allow disabling lyrics globally and skip the network requests entirely
  (`ameenalasady`, `022ab82`).
- Show the queue instead of an empty state when lyrics are unavailable.

## Library and navigation

- For Library → Songs, use `FEmusic_liked_videos` rather than the generic
  `LM`, which can pick up Shorts and regular YouTube videos.
- Don't include Suggested tracks as actual playlist content.
- In search, open the album/artist/playlist pages instead of launching a
  random video from the play overlay.
- Improve artist shuffle: full catalog, a new sequence on every run, and
  station continuation.
- Make artists and albums clickable from cards and the player.
- Use the channel handle to dedupe accounts when YouTube doesn't return an
  email.

## UI and settings

- Add a Home refresh and optional section reordering. Design the reorder
  without requiring an eager load of the whole feed.
- Add search over the music cache and show real titles/artists.
- Add a lightbox for the full-size cover; port together with the follow-up
  fixes to image selection.
- Resizable sidebar/player, IndexedDB for actively-changing caches, a cover
  cache limit, and removing auto-dock are already implemented locally.

## Integrations and auth

- Consider importing cookies from browsers as a separate fallback for a
  broken WebView login, only after a security review.
- Brand channel switching already exists in the main app; the old
  implementation doesn't need porting.
- Check whether Last.fm offline retry, `Topic` stripping, and the avatar
  account card have been fully ported.

## Do not port

- A user-facing or default-enabled Premium gate bypass.
- A change that recognizes the Premium upsell as having Premium.
- Updater public keys from other forks.
- Whole conflicting macOS/auth branches without splitting them up and
  without platform regression tests.

## Sources

- PR #1: <https://github.com/NUber-dev/YTubic/pull/1>
- PR #3: <https://github.com/NUber-dev/YTubic/pull/3>
- PR #27: <https://github.com/NUber-dev/YTubic/pull/27>
- PR #33: <https://github.com/NUber-dev/YTubic/pull/33>
- Ameen fork: <https://github.com/ameenalasady/YTubic>
- YTMac fork: <https://github.com/metabreakr/YTMac>
