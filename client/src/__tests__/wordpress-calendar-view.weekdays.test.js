// specs/wordpress-plugin.md rule 19 — the availability calendar block names the weekdays in the
// page's language (it printed « LUN MAR MER » under « October 2026 »), its arrows are named through
// the catalogue, and each day reads in full with its state (rule 15).
import { screen } from '@testing-library/react';
import { catalogueRoutes, loadBlock, nextMonthDays } from './wordpressBookingFixtures';

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; });

function boot(locale) {
  document.body.innerHTML = '<div data-gf-calendar data-property-id="1" data-months="2"></div>';
  return loadBlock('blocks/calendar/view.js', { locale, routes: catalogueRoutes(() => null, { blocked: [nextMonthDays(20).a.iso] }) });
}

test('rule 19: English page → Mon … Sun', async () => {
  boot('en-GB');
  await screen.findAllByText('Mon');
  const first = [...document.querySelector('.gf-cal-grid').querySelectorAll('.gf-cal-dow')].map((d) => d.textContent);
  expect(first).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

test('rule 19: French page → Lun … Dim; the arrows say « Mois précédent / suivant »', async () => {
  boot('fr-FR');
  await screen.findAllByText('Lun');
  expect(screen.getByRole('button', { name: 'Mois précédent' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mois suivant' })).toBeTruthy();
});

test('rule 15: a taken day reads in full, with « indisponible »', async () => {
  boot('fr-FR');
  const taken = nextMonthDays(20).a;
  expect(await screen.findByRole('img', { name: `${taken.label}, indisponible` })).toBeTruthy();
});
