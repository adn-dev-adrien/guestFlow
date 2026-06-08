# Changelog fragments

To avoid `CHANGELOG.md` merge conflicts between parallel branches, **unreleased changelog entries
are not written directly into `CHANGELOG.md`**. Each change adds its own **fragment file** here, so
two PRs never touch the same lines.

## Add an entry (every PR that needs a changelog line)

Create one file per change:

```
changelog.d/<category>--<short-slug>.md
```

- `<category>` ∈ `added` | `changed` | `fixed` | `removed` | `migration` (matches the Keep a
  Changelog sections, plus `migration` for data-affecting DB changes).
- `<short-slug>` is a kebab-case hint, ideally unique to the branch (e.g. the feature name). Using a
  branch-unique slug guarantees no filename collision between PRs.

The **file content is the markdown bullet(s)** exactly as they should appear under that section — no
heading, just the `- …` lines. Example — `changelog.d/added--j7-email-baby-beds.md`:

```markdown
- **J-7 email — baby-bed notice** (spec `j7-email-baby-beds.md`, 2026-06-08). … +7 server tests.
```

That's it. Because each PR adds a **new file**, `git` never reports a conflict.

## Preview the pending changelog

```
node scripts/build-changelog.mjs
```

Prints the assembled `### Added / ### Changed / …` block from every fragment — a preview of what the
next release's `## [Unreleased]` will contain.

## At release time

```
node scripts/build-changelog.mjs --release X.Y.Z [YYYY-MM-DD]
```

Folds every fragment (grouped by category) **and** any bullets already sitting under
`## [Unreleased]` in `CHANGELOG.md` into a new dated `## [X.Y.Z]` section, resets `## [Unreleased]`
to empty, and deletes the consumed fragment files. Review the diff, then commit.

> Transition note (2026-06-08): the `## [Unreleased]` block in `CHANGELOG.md` still holds the
> pre-fragment entries (#144–#146). They are folded in automatically at the next release alongside
> the fragments — nothing to migrate by hand.
