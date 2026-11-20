// specs/plugins-phase-1-sdk.md rule 58 (loop t26 verifier) — the commit gate judges each preview by the draft its answer was for: an
// answer of another draft never stands for the draft on screen, whatever `fresh` says.
import { isCurrentAnswer } from '../useMoneyCommit';
import useMoneyCommit from '../useMoneyCommit';

const settled = { pending: false, failed: false, fresh: true };

test('an answer is current only for the draft it answered', () => {
  expect(isCurrentAnswer({ ...settled, answerKey: 'a', draftKey: 'a' })).toBe(true);
  expect(isCurrentAnswer({ ...settled, answerKey: 'a', draftKey: 'b' })).toBe(false);
  expect(isCurrentAnswer({ ...settled, answerKey: null, draftKey: 'a' })).toBe(false);
});

test('pending or failed, the answer of the very draft is not current either', () => {
  expect(isCurrentAnswer({ ...settled, pending: true, answerKey: 'a', draftKey: 'a' })).toBe(false);
  expect(isCurrentAnswer({ ...settled, failed: true, answerKey: 'a', draftKey: 'a' })).toBe(false);
});

test('the gate stays shut on an answer of another draft, even one marked fresh', () => {
  expect(useMoneyCommit({ previews: [{ ...settled, answerKey: 'a', draftKey: 'b' }] }).ready).toBe(false);
  expect(useMoneyCommit({ previews: [{ ...settled, answerKey: 'b', draftKey: 'b' }] }).ready).toBe(true);
});
