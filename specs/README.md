# Specs

Source of truth for every feature, fix or change worth a discussion: the spec answers *why*, the code
answers *what*. To find one, start at [INDEX.md](INDEX.md).

## Folders

Specs are grouped by domain: `specs/<domain>/<name>.md`. Each domain folder has an `INDEX.md` with one
line per spec. Only Markdown lives here: mock-ups and HTML summaries go to `docs/specs/`, studies and
one-off reports to `docs/rapports/`.

- **A spec's name is its identity**, unique across all folders. Tests cite `specs/<domain>/<name>.md rule N`;
  the coverage script (`scripts/check-spec-coverage.mjs`, CI job `spec rules`) resolves a citation by the
  name, and refuses two files with the same name (specs/tech/spec-rule-coverage.md rule 20).
- **A path must point to a file.** The same job fails a PR that touches a file citing a `specs/….md`
  path that does not exist (rule 21). After moving a spec, or after merging master into a branch that
  still cites old paths, run `node scripts/rewrite-spec-paths.mjs <files>` on the files the job names: it
  rewrites every stale path whose spec still exists. Name the files: rewriting a plugin's source, even a
  comment, makes that plugin changed, and it must then carry a new version. A path to a deleted spec is listed for you to fix by hand.
- **Rule numbers are identities.** Never renumber or insert a rule in the middle of §3; append at the
  end, or use a suffix (`12bis`, `20c`). A retired rule keeps its number, with its text replaced by
  `*(Retired <date> — <why>)*` and a `> **Sans test** — retired rule` line under it.

## Workflow

1. Pick the domain folder (create one only when no existing domain fits; then add it to `INDEX.md`).
2. Copy `TEMPLATE.md` to `specs/<domain>/<feature-name>.md` (short kebab-case, unique across `specs/`).
3. **Add its line to the folder's `INDEX.md`** in the same commit: `` - `<name>` — <what it governs, ≤ 30 words>. Code: `<key paths>`. `` with ` **[Draft]**` until it is Implemented.
4. Fill it out collaboratively in chat. When all sections are settled and open questions resolved,
   flip **Status → Approved**.
5. Implementation starts on a `feature/<feature-name>` branch.
6. Once merged, flip **Status → Implemented**, drop the `[Draft]` mark from the index line, link the PR.

When a later spec replaces an earlier one, delete the earlier one (git keeps it) and redirect its
citations to the rules that replace them; when it only amends it, update the earlier spec in place and
keep its index line accurate.

## Naming

- Short, kebab-case, focused: `cleaning-fee-per-property.md`, `guest-checkout-form.md`.
- One spec = one feature/PR. Split if it grows beyond a single coherent change.

## Why keep specs in the repo?

- Same review tooling as code (diff, history, PR).
- Always in sync with the branch they describe.
- Future-Claude (and future-you) can find the *why* months later without digging through commits.
