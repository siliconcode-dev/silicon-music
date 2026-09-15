# Tech debt

Small things noticed while doing other work and deliberately deferred.
Not features, so they live separately from `feature-roadmap.md`.

## ESLint warnings

Three of them, all pre-existing. The build doesn't fail because of them.

- [ ] `no-useless-assignment` in `src/components/ui/animated-tabs.tsx:54`.
      `let newIndex = currentIndex` in the keyboard handler: the initial
      value is never read, since every branch either overwrites the
      variable or returns. The behavior is correct, it's just a dead
      initializer. The component is used in the queue panel and on the
      Library page.

- [ ] `preserve-caught-error` ×2 in `src/lib/innertube/player.ts:77` and
      `:84`, both in `resolveStream`. The caught error is wrapped into a
      new `Error` via `String(e)`, so the text survives but the stack and
      the original object are lost. Should be `new Error(msg, { cause: e })`.
      These are yt-dlp's failure paths and invalid JSON from it, i.e.
      exactly the cases where a lost cause makes playback issues harder to
      debug.

## Possibly dead code

- [ ] `resolveStream` from `src/lib/innertube/player.ts` isn't imported
      from anywhere (checked via grep on 2026-08-25). The engine reaches
      the stream a different way, through `resolveStreamId` in
      `audio-engine.ts`. Looks like a leftover from an earlier scheme.
      Check whether the module is actually live before fixing the `cause`
      issue above in it — it may just need to be deleted.
