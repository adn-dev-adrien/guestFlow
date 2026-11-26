// specs/site/site-outside-resource-booking.md §3.I rule 38 — Safari AutoFill puts the cursor in « Code bon cadeau » by itself right after load: a focus no guest gesture preceded in the
// first 3 s is undone; a focus after a gesture, or after those 3 s, stays; the page's own focus() after « Appliquer » on an empty code is unaffected.
import { fireEvent } from '@testing-library/react';
import { setup, resetPage } from './wordpressSessionFixtures';

const codeField = () => document.querySelector('.gf-sb-code input');
// The block is drawn once the activities are fetched; the guard is armed when the field is built, so the fake clock starts there.
async function built() {
  setup();
  for (let i = 0; i < 50 && !codeField(); i += 1) await Promise.resolve(); // eslint-disable-line no-await-in-loop
  expect(codeField()).not.toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  resetPage();
});

describe('session block — code field focus guard (rule 38)', () => {
  it('gives back a focus no gesture preceded', async () => {
    await built();
    codeField().focus();
    expect(document.activeElement).not.toBe(codeField());
  });

  it('keeps a focus that follows a pointerdown on the field', async () => {
    await built();
    fireEvent.pointerDown(codeField());
    codeField().focus();
    expect(document.activeElement).toBe(codeField());
  });

  it('keeps a focus that follows a keydown (Tab from the previous element)', async () => {
    await built();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    codeField().focus();
    expect(document.activeElement).toBe(codeField());
  });

  it('gives back a focus that follows a touch elsewhere on the page (a scroll)', async () => {
    await built();
    fireEvent.touchStart(document.body);
    fireEvent.pointerDown(document.body);
    codeField().focus();
    expect(document.activeElement).not.toBe(codeField());
  });

  it('leaves the field alone once the 3 s have passed', async () => {
    await built();
    vi.advanceTimersByTime(3001);
    codeField().focus();
    expect(document.activeElement).toBe(codeField());
  });

  it('still focuses the field when « Appliquer » is clicked on an empty code', async () => {
    await built();
    fireEvent.pointerDown(document.querySelector('.gf-sb-code button'));
    fireEvent.click(document.querySelector('.gf-sb-code button'));
    expect(document.activeElement).toBe(codeField());
  });
});
