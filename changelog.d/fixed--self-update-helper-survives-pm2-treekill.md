- **A finished update now says so.** Installing 2.1.0 worked — new version swapped in, healthy, data
  intact — but the progress overlay never closed, and reloading the page brought it straight back.
  The process that performs the swap was being killed by the very restart it triggers: PM2 stops an
  application together with all of its descendants, and that process was one of them. It is now
  started outside the application's process tree, so it survives the restart and reports the outcome
  as it was always meant to. As a second line of defence, GuestFlow also concludes an update by
  itself at startup — if the version that came up is the one that was being installed, the update is
  recorded as finished rather than left spinning. The same defect meant the automatic return to the
  previous version could not run at all: had 2.1.0 failed to start, nothing would have put 2.0.0
  back. That safety net works again. (specs/self-update-and-releases.md rules 28 and 30b, +8 server
  tests.)
