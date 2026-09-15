# Playback tab: status

The tab's settings are wired up to the audio (see the "Playback tab"
section in `ui-refresh-backlog.md`, which also lists where everything
lives). This file is kept as a reminder of what to check by hand: audio
can't be listened to from inside an agent.

## What to listen for

1. Bare playback with all settings off: the elements now load the stream
   with `crossOrigin="anonymous"`. If this is silent or fails to load,
   it's the CORS header on axum, not the graph.
2. Equalizer: turn it on, toggle Bass boost / Treble, move a band. The
   graph is built on first activation and stays around after that.
3. Mono and normalization: audible on a stereo track and on a quiet track
   respectively.
4. 6-8s crossfade: let a track play out to the end. Expect a smooth
   overlap, the cover/title changing right as the fade starts, and SMTC
   and Last.fm seeing an ordinary track change. Pausing during the fade
   cuts the outgoing track.
5. Output device: open the list, confirm there's no microphone dialog
   (Rust answers the request itself), devices are named, and switching
   works.
6. The back button in all three modes, and Resume after a restart.

## What's not done

- "Duck on short notifications" was removed from the tab: it needs Rust
  and a WebView2 audio session. The store field was removed too.
