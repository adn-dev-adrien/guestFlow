# Detecting whether a branch is already on `master`

_Moved out of `CLAUDE.md` to keep the always-loaded context small; `CLAUDE.md` keeps the short rule and links here._

**The user always merges PRs with "Squash and merge" in the GitHub UI.** A squash collapses all of a branch's commits into **one brand-new commit on `master` with a different SHA**, then GitHub auto-deletes the head branch. Consequence: the branch's original commits are **never ancestors of `master`**, so the usual ancestry checks **lie**:

- ❌ `git branch --merged master` — will NOT list a squash-merged branch.
- ❌ `git merge-base --is-ancestor <branch> master` — returns "not an ancestor" even when the work *is* in master.
- ❌ "the branch was deleted on GitHub, so it's merged" — **false**: a deleted branch can mean *merged* **or** *closed/abandoned*. Deletion alone proves nothing.

**The only reliable check is by CONTENT, not by commit graph:**

1. **Is the branch still open?** `git ls-remote --heads origin <branch>` — empty output means the remote branch is gone (merged *or* closed); a SHA means the PR is still open and unmerged.
2. **Is the work actually in master?** Verify the branch's changes are present in `origin/master`:
   - file existence: `git ls-tree -r origin/master --name-only <path>`
   - or a distinctive string from the diff: `git grep "<unique snippet>" origin/master -- <pathspec>`
3. **Find the squash commit** by feature name / PR number in the linear history: `git log origin/master --oneline | grep -i "<feature-or-#NN>"`.

**Rule:** before claiming a branch is merged — or before deleting/recreating one — `git fetch origin` first, then confirm by **content (steps 2–3)**, never by ancestry. If the branch is gone from the remote **but** its content is absent from `master`, treat it as **lost work (closed-without-merge or accidental deletion)** and surface it to the user — do not silently assume it shipped.

---
