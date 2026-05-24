# Specs

Source-of-truth for every feature, fix, or change worth a discussion.

## Workflow

1. Copy `TEMPLATE.md` to `<feature-name>.md` (short kebab-case).
2. Fill it out collaboratively in chat.
3. When all sections are settled and open questions resolved, flip **Status → Approved**.
4. Implementation starts on `feature/<feature-name>` branch.
5. Once merged, flip **Status → Implemented** and link the merged PR.

## Naming

- Short, kebab-case, focused: `cleaning-fee-per-property.md`, `guest-checkout-form.md`.
- One spec = one feature/PR. Split if it grows beyond a single coherent change.

## Why keep specs in the repo?

- Same review tooling as code (diff, history, PR).
- Always in sync with the branch they describe.
- Future-Claude (and future-you) can find the *why* months later without digging through commits.
