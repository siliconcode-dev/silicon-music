# UI refresh — backlog

Porting the design handoff from Claude Design ("Screen UI improvement")
into the app. Going in parts; this is what's been deliberately deferred.

Date: 2026-08-24. Updated 2026-09-15: the accent color no longer comes from
the handoff's YouTube-red value (see the rebrand commit) and the Premium
chip mentioned below was removed along with the Premium gate.

## Done

- [x] Tokens. The handoff's palette (`t1..t10`, `w020..w350`, `k180..k900`,
      `surf1..7`, `glass1..6`, `acc1..5`, `desk1..3`, `fs-*`) was added
      alongside the shadcn semantics in `src/index.css`: light values in
      `:root`, dark in `.dark`, all exposed via `@theme inline`. The
      semantic tokens are deliberately **not** redirected onto it —
      components move over one at a time. The `--brand` accent was
      originally nudged from `#fa1f3e` to `#fa1f4b` (YouTube red); it now
      uses a different hue entirely after the rebrand.
- [x] Buttons (`src/components/ui/button.tsx`).
- [x] Sidebar (`app-sidebar.tsx`, `ui/sidebar.tsx`), icons moved to
      `@tabler/icons-react`.

## Sidebar — revisit later

- [x] Collapse/expand animation: the curve now matches the prototype,
      `width .22s cubic-bezier(.32,.72,0,1)` instead of `150ms linear`,
      with the group heading riding the same curve.
- [ ] Re-check drag-resize: the transition is already suppressed during a
      drag via the `body.layout-resizing` class (see `index.css`), so this
      item may be stale.
- [ ] Try a hairline between Browse and Playlists in the collapsed state —
      right now there's just 16px of spacing (`mt-4`), because the section
      heading is taken out of flow.
- [ ] Update the profile row design (the Premium chip it used to mention
      no longer exists — the Premium gate was removed).

## Toasts — revisit later

- [ ] Rework the message copy itself. Right now many places dump the raw
      `String(e)` straight into the toast, so the title ends up being a
      stack trace or a technical string. Needs a human title + a short
      explanation in the description, like the prototype ("Couldn't set
      cover" / "Image is larger than 3 MB"). This especially affects
      errors in: `app-sidebar`, `storage-tab`, `integrations-tab`,
      `player-bar`, `like-buttons`, `album-menu`.

## Custom filled icons

18 icons that have no filled counterpart in Tabler 3.46 were drawn by hand
in `src/components/shared/filled-icons.tsx` on the same 24x24 grid. Some
were assembled from Tabler's own filled glyphs (`IconHeartFilled`,
`IconEyeFilled`, `IconPinFilled`, `IconSettingsFilled`), others from
scratch. A few cut holes via `<mask>`, so the mask id comes from `useId()`:
the same icon can appear twice on a page, and with a fixed id the second
copy would pick up the first one's mask.

Sign out / sign in were left as outlines: the door is defined by its walls
rather than its mass, so they just use `stroke={2.3}`.

Arrows with no interior area (`IconLoader2`, `IconRefresh`, `IconSortAZ`,
`IconSortDescending`, `IconArrowsShuffle2`, `IconChevronUp`) were left
untouched.

## Known differences from the mockup

- Sidebar width: 200px in the mockup, 256px by default in the app and
  drag-resizable with persistence. The user's own value was not
  overridden.
- The Library icon and the Settings gear in the prototype were drawn from
  **Lucide**, not Tabler (the designer mixed icon sets). We used Tabler:
  `IconBookmarks` / `IconBookmarksFilled` for Library — unlike `IconBooks`,
  it has a filled counterpart for the active state.
- `IconBrandSafariFilled` (active Explore) doesn't exist in Tabler 3.46; we
  use `IconCompassFilled`, which has added tick marks around the edge.
- The Liked Songs cover picker from the prototype (4 presets + a custom
  URL) wasn't ported as-is — we kept its default preset (originally
  labelled "YTubic", now "Silicon Music") as the static `.liked-cover`.

## Playback tab: wired up to the audio

Every row in the tab is read by the engine (`src/lib/audio-engine.ts`):

- Equalizer, mono and normalization: a WebAudio graph in
  `src/lib/audio-graph.ts` (`createMediaElementSource` -> nine
  `BiquadFilter`s -> mono gain -> compressor). Built lazily the first time
  any of them is turned on and kept for the session; while all of them are
  off, a bare `<audio>` plays. The elements load the stream with
  `crossOrigin="anonymous"`; CORS on the axum router was already in place
  (`CorsLayer::permissive()`).
- Crossfade: a second `<audio>`; the next track preloads 8s before the
  overlap starts, then an equal-power ramp runs over both elements'
  `volume`. The store advances to the next track the moment the fade
  starts.
- Output device: `setSinkId` on the elements, and on the `AudioContext`
  once the graph is built. Chromium only names devices after microphone
  access, so opening the list once requests `getUserMedia` and immediately
  releases the stream. On Windows, Rust grants that request for our own
  pages (`src-tauri/src/webview_permissions.rs`, the `PermissionRequested`
  handler), so there's no WebView2 dialog.
- Back button: `prev()` in `store/playback.ts` reads `backButton` and
  `smartBackSeconds`.
- Resume: the position lives in `partialize`, is persisted on rehydrate
  when the flag is on, and the engine fast-forwards `currentTime` on
  `loadedmetadata`.
- The main window and the floating player both got
  `--autoplay-policy=no-user-gesture-required`, otherwise an `AudioContext`
  created before the first click (equalizer left on from a previous
  session, starting from a media key) stays suspended and silent.
- "Duck on short notifications" was removed from the tab: there's no web
  API for it, and doing it from Rust would mean finding the WebView2 child
  process's audio session (`IAudioSessionControl2` by PID). A separate task
  if it's ever needed.

## Further along the handoff

- [ ] Switch / radio / segmented control and preset chips.
- [ ] Menus and popovers (`glass3..6` glass + `backdrop-filter`).
- [x] Settings screen, What's New, About, toasts (sonner on `unstyled` +
      classNames; the stack position wasn't changed).
