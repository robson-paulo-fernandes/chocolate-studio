# Chocolate Studio – Mac app

An Electron window around the built web editor. No backend and no network service: the page is served from
`app://studio` (a secure scheme, so Web MIDI, IndexedDB and localStorage work as on the web), links open in the
browser, and the only permission granted is MIDI with SysEx for that page.

Build on an Apple Silicon Mac with Node.js and the Xcode command line tools:

```
./build.sh
```

It installs and builds `apps/web` with the repository's pinned pnpm (through `npx`), copies the build to `web/`,
packages `Chocolate Studio.app` in `dist/` and signs it ad hoc. The app is not notarized: open it the first time
with right-click → Open.

`CHOCOLATE_SELFTEST=<file.png> npx electron .` loads the page, logs whether Web MIDI with SysEx is granted,
saves a screenshot and quits.
