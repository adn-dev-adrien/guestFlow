# One test file per subject — never append to a shared suite

_Moved out of `CLAUDE.md` to keep the always-loaded context small; `CLAUDE.md` keeps the short rule and links here._

**A feature's tests go in a file of their own, named after the feature. Never at the end of an
existing suite.** This is a merge rule before it is a tidiness rule: when every feature appends its
cases to the same file, two branches conflict on the last line even though their tests are
unrelated, and the conflict has to be resolved by hand on code Git cannot reason about. It is the
same reasoning that gave `changelog.d/` its one-file-per-change layout (§10).

- **Server** — already the convention: `server/src/tests/<feature>.unit.test.js`, one per spec
  (`sas-option-sales`, `sas-stay-payment`, `sas-offer-complement-lines`…). Keep it that way.
- **Client** — `src/**/__tests__/<Component>.<subject>.test.jsx`. A component with more than one
  subject gets one file per subject (`ReservationSasDialog.catering.test.jsx`,
  `ReservationSasDialog.stay-payment.test.jsx`, …), each opening with a comment naming the spec it
  covers.
- **Shared fixtures** go in a sibling non-test module (`__tests__/<component>Fixtures.jsx`) so a new
  suite never has to import — and therefore re-run — another suite. A fixture used by one subject
  stays in that subject's file. `vi.mock(...)` stays in each test file: Vitest hoists it per file.
- **Touching an existing feature** still edits that feature's file — that is a real overlap, and a
  conflict there is worth resolving.
- Never resolve this class of conflict with a `.gitattributes` union merge: it concatenates both
  sides silently, which on JavaScript means duplicate test names, broken syntax, or a suite that
  passes by accident.
