// specs/wp-booking-widget-redesign.md rules 32-33 (UI/UX review 2026-10-18, decision 4) — the
// server's total and one button in a bar that follows the step, the summary card's own button on a
// wide block, the two times on a row of their own. CSS decides where each shows; here, what each
// says and does.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bookingContainer, catalogueRoutes, loadBlock, nextMonthDays } from './wordpressBookingFixtures';

const days = nextMonthDays(10, 13);

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

async function boot() {
  bookingContainer();
  const ctx = loadBlock('blocks/booking/view.js', { routes: catalogueRoutes() });
  await screen.findByRole('button', { name: days.a.label });
  return ctx;
}
const bar = () => document.querySelector('.gf-bar');
const barCta = () => bar().querySelector('button');

test('rule 32: before any date the bar asks for the dates, and says what the next click does', async () => {
  await boot();
  expect(barCta().textContent).toBe('Choisir les dates');
  expect(barCta().disabled).toBe(false);
  await waitFor(() => expect(bar().querySelector('small').textContent).toBe('Sélectionnez votre date d’arrivée'));
  await userEvent.click(screen.getByRole('button', { name: days.a.label }));
  await waitFor(() => expect(bar().querySelector('small').textContent).toBe('Sélectionnez votre date de départ'));
});

test('rule 32: a quoted stay puts the server total in the bar, and the button moves on to the form', async () => {
  await boot();
  await userEvent.click(screen.getByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  await waitFor(() => expect(bar().querySelector('b').textContent).toMatch(/^310,00\s€$/));
  expect(bar().querySelector('small').textContent).toBe('3 nuits · taxe de séjour incluse');
  expect(barCta().textContent).toBe('Continuer');
  // Never the drawer's « engine submit »: the Solio drawer takes the first `.gf-btn` it finds.
  expect(barCta().classList.contains('gf-btn')).toBe(false);
  expect(barCta().classList.contains('gfb-cta')).toBe(true);
  expect(document.querySelector('.gf-btn').parentElement.className).toBe('gf-booking');
});

test('rule 32: the bar is the last child of the block, after the flow it summarises', async () => {
  await boot();
  const form = document.querySelector('.gf-booking');
  expect(form.lastElementChild).toBe(bar());
  // wordpress-plugin rule 29: each child is an engine element, wherever a host moves it.
  expect([...form.children].every((c) => c.classList.contains('gf-engine'))).toBe(true);
  // Rule 33's span: every child but the summary sits in the left column.
  expect(form.style.getPropertyValue('--gf-rows')).toBe(String(form.children.length - 1));
});

test('rule 33: the summary card carries the stay dates and its own button, which submits', async () => {
  const { calls } = await boot();
  await userEvent.click(screen.getByRole('button', { name: days.a.label }));
  await userEvent.click(screen.getByRole('button', { name: days.b.label }));
  const cta = await waitFor(() => {
    const el = document.querySelector('.gf-summary .gf-summary-cta');
    expect(el).toBeTruthy();
    return el;
  });
  expect(document.querySelector('.gf-summary-head').textContent).toBe('Votre séjour');
  expect(document.querySelector('.gf-summary-dates').textContent).toMatch(/^\d\d\/\d\d\/\d{4} → \d\d\/\d\d\/\d{4}$/);
  expect(cta.textContent).toBe('Envoyer la demande');
  await userEvent.click(cta);
  // Same refusal as the main button: nothing sent with an empty form.
  expect(screen.getByLabelText('Prénom *').getAttribute('aria-invalid')).toBe('true');
  expect(calls.some((c) => c.path === '/booking-requests')).toBe(false);
});

test('rule 32: the two times sit on a row of their own', async () => {
  await boot();
  const times = document.querySelector('.gf-row-times');
  expect(times.querySelectorAll('.gf-field-time')).toHaveLength(2);
  expect(screen.getByLabelText('Départ').closest('.gf-row').contains(screen.getByLabelText('Heure de départ'))).toBe(false);
});

test('rule 32: under a theme wrapper with overflow hidden, the bar floats over the viewport until its place arrives', async () => {
  const observers = [];
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(el) { this.el = el; }
    disconnect() {}
  };
  document.body.innerHTML = '<div style="overflow-x: hidden"><div data-gf-booking data-property-id="1" data-show-options="1" data-pay-online="0"></div></div>';
  loadBlock('blocks/booking/view.js', { routes: catalogueRoutes() });
  await screen.findByRole('button', { name: days.a.label });
  const fire = (el, entry) => observers.filter((o) => o.el === el).forEach((o) => o.cb([{ target: el, ...entry }]));
  const form = document.querySelector('.gf-booking');
  const anchor = document.querySelector('.gf-bar-anchor');

  fire(form, { isIntersecting: true });
  fire(anchor, { isIntersecting: false, intersectionRatio: 0, boundingClientRect: { top: 900 } });
  expect(bar().classList.contains('is-floating')).toBe(true);

  fire(anchor, { isIntersecting: true, intersectionRatio: 1, boundingClientRect: { top: 600 } });
  expect(bar().classList.contains('is-floating')).toBe(false);
  delete window.IntersectionObserver;
});

test('rule 32: without such a wrapper, sticky does the job and the bar never floats', async () => {
  const observers = [];
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(el) { this.el = el; }
    disconnect() {}
  };
  await boot();
  const form = document.querySelector('.gf-booking');
  const anchor = document.querySelector('.gf-bar-anchor');
  observers.filter((o) => o.el === form).forEach((o) => o.cb([{ target: form, isIntersecting: true }]));
  observers.filter((o) => o.el === anchor).forEach((o) => o.cb([{ target: anchor, isIntersecting: false, intersectionRatio: 0, boundingClientRect: { top: 900 } }]));
  expect(bar().classList.contains('is-floating')).toBe(false);
  delete window.IntersectionObserver;
});
