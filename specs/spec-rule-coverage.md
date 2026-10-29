# A spec rule without a test is a rule not delivered

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/spec-rule-coverage` |
| **Created** | 2026-09-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

> **Translated 2026-10-27 (spec review).** This spec was written in French, against CLAUDE.md §2
> (specs are in English). It is translated here with its meaning, rule numbers and figures unchanged.
> Two things deliberately stay in French because the script matches or prints them verbatim: the
> exemption marker `> **Sans test** — <reason>` (rule 5 — `EXEMPT_LINE` in
> `scripts/check-spec-coverage.mjs` matches `**Sans test**`), and the terminal output quoted in §6,
> which is what the script prints. A citation may still say `règle N` as well as `rule N` (rule 1).

---

## 1. Context

On 2026-09-01, a rule-by-rule rereading of the four single-payment specs — 73 rules — found **three
rules written and never built**:

| Rule | Written in | What the code did |
|---|---|---|
| 13 — the receipts table folds a single payment | v2.9.0 | it listed one line per échéance, while the journal cards grouped them. **The two areas of the same page contradicted each other** |
| 10 — a check-in collected in one go writes ONE history line | v2.9.0 | it wrote three |
| 23 — the discount dies with the group | 2026-08-31 | true from the fiche, false from the SAS: the discount survived and **understated the accounting** in the name of a collection that no longer existed |

None had been caught by the suites — 3,817 server tests and 1,191 client tests, all green while
these rules existed only on paper. They were found by eye, by rereading. And the first one was found
only because an operator reported « je vois toujours 2 entrées » (« I still see 2 entries »).

**This is not a lack of rigour, it is a lack of tooling.** The link between a rule and the test that
proves it already exists — **584 « rule N » citations in 267 test files**, the convention is alive
and followed. But it is free text in a comment: nothing can answer « which rules have no test? », so
nobody asks.

### 1.1 Orders of magnitude

| | Measured (2026-09-01) |
|---|---|
| Specs (excluding the template) | 208, of which 193 `Implemented` |
| Numbered rules | 2,815 |
| Rule-number citations in the tests | 584, in 267 files |
| Specs touching money | 103 (1,557 rules) |
| Payment / accounting core | 44 specs, 830 rules |

Aiming for one test per rule across 2,815 rules would be misplaced effort: most carry no money, and
the audit alone would cost hundreds of hours. This spec builds **the measure and the gate**; catching
up on the existing rules will be done family by family, outside its scope (§8).

## 2. Goal

Be able to answer, at any time and without reading a line of code, « **which rules of this spec have
no test?** » — and prevent a **new** rule from being delivered without its test.

---

## 3. Functional rules

### 3.1 The measure

1. **The existing convention is the convention.** The rule → test link is read from the comments
   already written: `specs/<name>.md §3.2 rule 10`, `rules 4-5`, `règle 11bis`, `§3.E rules 28 + 30b`.
   No new tag is imposed: the 584 citations in place immediately become coverage, and code review
   keeps its habits.
2. **What counts as a rule**: the numbered entries of a spec's « Functional rules » section (`## 3.`),
   sub-sections included, up to the next `##`. Numbered lists in other sections (architecture, test
   plan, open questions) are not rules and are never counted.
3. **What counts as a test**: a server test file (`server/src/tests/**`) or client test file
   (`client/src/**/__tests__/**`) that cites the spec and then the number. A citation is attached to
   the **spec named closest above it** in the file — which is how a human reads a multi-line comment.
4. **Suffixes and groups are understood**: `2bis`, `20c`, `rules 4-5` (range), `rules 28 + 30b`
   (list). A range covers every integer it contains.
5. **A rule can be declared untestable**, and it then counts as covered — but **never silently**: the
   spec itself carries, under the rule, a line `> **Sans test** — <reason>` (the marker stays in French:
   it is what the script matches). Framing prose (« the breakdown does not change ») or a decision
   (« settled with Adrien ») has nothing to prove; demanding a test would produce decorative tests,
   which are worse than no test because they suggest a guarantee that does not exist.
6. **The report is readable without context**: per spec, the number of rules, the number covered, the
   missing numbers. Sorted by number of uncovered rules, worst first.
7. `node scripts/check-spec-coverage.mjs` prints the global report; `--spec <name>` details one spec,
   rule by rule, with the test file that pins each.
   > **Sans test** — CLI plumbing: the content comes from `buildCoverage`, already pinned (rules 5 and
   > 6); only terminal formatting would be left to prove.

### 3.2 The gate

8. **An ADDED rule must be cited by a test.** On a PR, the check compares the specs with the base
   `master`: any new rule that is cited nowhere in the tests **after** the change fails the check,
   with its number and its spec's name.
9. **A MODIFIED rule does not block**, it warns. Otherwise fixing a typo in a rule would require
   touching a test, and the gate would become a toll people learn to get around. That is precisely
   what must be avoided: a gate that gets disabled protects nothing.
10. **No inherited debt is demanded.** The check only looks at the diff: the 2,815 existing rules block
    no PR. Catching up is a separate project (§8).
    > **Sans test** — structural rather than testable: `gateVerdict` receives ONLY the rules of the
    > diff, it has no way to see any others. A test would prove nothing beyond the signature.
11. **The citation may come from a test already written.** A new rule covered by an existing test that
    names it passes: what matters is that the rule is proven, not that a file changed.
12. **The check is a separate CI job**, on PRs only, next to the suites. It blocks neither the release
    nor a push to `master` — an uncited rule is a delivery defect, not a production emergency.
    > **Sans test** — this is workflow configuration (`if: github.event_name ==
    > 'pull_request'`), proven by the job's own execution: it runs on this PR, and nowhere else.
13. **A superseded spec carries no rules any more.** When a spec's **Status** line says
    « superseded », its rules no longer describe the product: they leave the report and never block
    the gate. Added on 2026-10-01: the sync of `master` into `inte/plugins` (#649) brought
    `finance-exercise-overview-charts.md`, superseded on `master` together with its tests, and the
    gate read it as 14 new rules without tests.
14. **A spec not yet delivered defers its rules; its delivery demands them all.** « Not yet delivered »
    = a **Status** line starting with « Draft » or « Approved » (the CLAUDE.md §3 flow: the spec is
    written, then approved, then implemented). Added on 2026-10-19: the « spec first, then
    implementation » rule (UI/UX review of 18/10, decision 8) produces spec-only PRs, which rule 8 made
    impossible to turn green without decorative tests or untruthful « Sans test » lines. Four locks
    prevent the exemption from becoming a loophole:
    - **Exempted** only if the spec is Draft/Approved **after** the PR **and**, at the merge-base,
      absent or Draft. A spec already « Approved » at the merge-base stays checked as before; a
      delivered spec moved back to Draft is never exempted.
    - **Delivered** (Draft/Approved at the merge-base, another status after): **all** its rules must
      be cited by a test or declared « Sans test », whether or not the PR touches their lines.
    - **Rename**: the spec is read at the merge-base under its old path
      (`git diff --name-status -M`), so a `git mv` does not hide the transition.
    - **Code does not ship against an exempted spec**: a line added by the PR outside `specs/` and
      `docs/` that cites `specs/<x>.md` of an exempted spec fails the check.

    The reference is the PR's **merge-base**, never the tip of the base branch.
    On 2026-10-19, 15 specs of `inte/plugins` (13 of them with rules) are « Approved » although their
    code is delivered (status never updated). They stay checked as before while they remain Approved;
    the PR that moves them to « Implemented » will have to cover or declare all their rules.

15. **A citation may name its spec without the `specs/` prefix** (added 2026-10-29, audit R2). « reservation-refunds.md
    rule 38 », « public-online-payment rule 12 » or « defer-arrival-complement-to-checkout §3.3 règle 16 »
    is credited to the spec it names — when that name is an existing spec — instead of the one the file
    announces on top (about twenty citations in 18 test files were credited to the wrong spec, which
    produced phantom coverage and two orphan citations).

16. **`--changed` fails on a new orphan citation** (added 2026-10-29, audit R4). A citation that lands on
    no rule (unknown spec, rule that does not exist), in a test file this PR changes and that the file
    did not already carry at the base, fails the gate with the file, the spec and the rule. An orphan
    already present at the base stays a line of the report (see the edge cases): the gate only refuses
    what the PR brings. The case it closes: a header reordered in `booking-intake.spec.js` made the
    smoke-suite spec the file's primary, credited its ten bare « Rule N » to the wrong spec and left one
    orphan nobody saw.

**Edge cases:**

- A spec without a `## 3.` section → no rules, absent from the report (the case of framing specs and
  indexes).
- A renamed spec → its citations point to the old name and become orphans: the report lists them in
  a « citations without a spec » section, which makes the rename visible instead of letting it
  silently degrade the coverage.
- A citation of a rule that does not exist (a stale number after a renumbering) → same « orphan
  citations » section. It is a signal, not a blocking error.
- A deleted test → coverage drops in the next report; the gate does not react, it only looks at added
  rules.

---

## 4. Architecture

> **Nothing on the application side.** This is repository tooling: a pure script, its tests, a CI
> job. Not a byte enters the archive delivered to the operator.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `tests/` | `spec-rule-coverage.unit.test.js` | C | Pins the script's pure functions: rule extraction, citation reading, ranges and suffixes, exemptions, attachment to the closest spec, and the gate's verdict. |
| `tests/` | `spec-rule-coverage-draft.unit.test.js` | C | Rule 14: undelivered statuses, transitions (exempted / delivered / demoted), rename, merge-base, code citing an exempted spec — pure functions and the CLI on a throwaway repository. |

Nothing else: the application server is not concerned.

### 4.2 Tooling (`scripts/`)

| File | T/C | Responsibility |
|---|---|---|
| `scripts/check-spec-coverage.mjs` | C | Exported pure functions (`parseSpecRules`, `parseCitations`, `buildCoverage`, `gateVerdict`) + a CLI that reads the files. Same shape as `build-changelog.mjs`: the logic is exported to be tested, the CLI only does input/output. |

### 4.3 CI (`.github/workflows/`)

| File | T/C | Responsibility |
|---|---|---|
| `unit-tests.yml` | T | A `spec rules` job on PRs: `node scripts/check-spec-coverage.mjs --changed --base origin/${{ github.base_ref }}`. Fails if an added rule is cited by no test. |

### 4.4 API contract

None. Nothing is exposed to the application.

---

## 5. Data model

**No change.** No column, no migration, no data.

## 6. UI / UX

**No interface.** The output is a terminal report and a CI job. The report's format (the script
prints French; quoted as printed):

```
specs/single-payment-at-check-in.md      15/17 règles   manquantes : 10, 13
specs/arrival-payment-detail-...md       27/28 règles   manquantes : 23
...
Total : 2 815 règles, 1 042 couvertes (37 %), 118 exemptées.

Citations orphelines (spec ou règle inexistante) : 4
  server/src/tests/xxx.unit.test.js → specs/ancien-nom.md rule 3
```

And for the gate, on a PR:

```
✗ specs/ma-spec.md règle 7 : ajoutée par cette PR, citée par aucun test.
  Ajoutez un test qui la nomme (« specs/ma-spec.md rule 7 »), ou déclarez-la
  non testable avec une ligne « > **Sans test** — <raison> » sous la règle.
```

## 7. Test plan

### Server unit tests
- [ ] `tests/spec-rule-coverage.unit.test.js` — the §3 rules and only them; sub-sections count; lists
      in other sections do not; `bis`/`ter`/letter suffixes; ranges `4-5`; lists `28 + 30b`;
      attachment to the closest spec above; the `> **Sans test**` exemption; orphan citations; and the
      gate: an added rule without a citation fails, with a citation passes, a modified rule warns
      without failing.
- [x] `tests/spec-rule-coverage.unit.test.js` — rule 15: `<spec> rule N` without `specs/` goes to the named spec when it exists, to the file's spec otherwise.
- [x] `tests/spec-rule-coverage-orphans.unit.test.js` (3) — rule 16: a new orphan citation in a changed file fails the gate; one already
      there, or in an untouched file, does not.
- [x] `tests/spec-rule-coverage-superseded.unit.test.js` (2) — rule 13: the Status line decides; a
      superseded spec has no rules, neither in the report nor at the gate.

### Real-world verification (2026-09-01)

- [x] **The report runs over the 208 specs**: 2,501 rules kept (the 314 numbered lines outside §3 are
      correctly left out), **474 covered — 19 %**. That is the measured starting point.
- [x] **It finds the known case**: `--spec single-payment-at-check-in` lists rules 10, 13 and 8bis as
      covered, pinned by the tests written the day before — and the other 15 as missing.
- [x] **Two parser defects found and fixed by confronting it with the real repository**, not in
      theory: a date (« règle 2026-08-31 ») was read as a range of rules, and a citation was attributed
      to a spec mentioned in passing 25 lines above. Both produced phantom coverage — a rule counted
      as proven without being so — which is worse than no measure. Each has its test.
- [x] **The gate bit its own author**: on its first run on this PR, it refused 8 of this spec's 12
      rules. They were satisfied like any other — 9 by a test that names them, 3 declared
      `> **Sans test**` with their reason. This shows the mechanism has no back door for whoever writes
      it.
- [x] **The final message does not overstate**: « 12 règles ajoutées : 9 citées par un test, 3
      déclarées sans test » (12 rules added: 9 cited by a test, 3 declared without a test) — an
      exempted rule is not a proven rule, and announcing it otherwise would make the check wrongly
      reassuring.

## 8. Out of scope

- **Catching up on the 2,815 existing rules.** The gate only looks at the diff. The
  payment-accounting core (44 specs, 830 rules) will be taken up family by family, one PR per family,
  and this spec's report is what will make that project steerable.
- **Checking that a rule is correctly implemented.** Coverage catches omission, not error. Against
  error there is only replaying the real journey in the browser.
- **Requiring one test per rule on untouched specs.** An old rule gets pinned when its spec is touched,
  not before.

## 9. Open questions

- **Q1 — should there be a coverage threshold that must never drop?** Tempting, but a global threshold
  over 2,815 rules moves with every spec added and ends up ignored. Proposal: no threshold at first;
  look at the report after three months and decide then whether it deserves a floor, and on what
  scope (the money core, most likely, rather than the total).
