// Context builder: shapes reservation/client/property/options/settings into a flat
// { vars, flags } object the renderer consumes. See specs/email-automation.md §3 rule 3 + §4.4.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext, __test } = require('../utils/emailContextBuilder');

const SAMPLE_SETTINGS = { companyName: 'GuestFlow Demo', companyPhone: '+33102030405', companyEmail: 'demo@gf.test' };

function baseInput(over = {}) {
  return {
    reservation: {
      startDate: '2026-07-10', endDate: '2026-07-13',
      checkInTime: '15:00', checkOutTime: '10:00',
      adults: 2, teens: 0, children: 1, babies: 0,
      singleBeds: 1, doubleBeds: 1, babyBeds: 0,
      finalPrice: 380, depositAmount: 100, depositDueDate: '2026-05-15',
      balanceAmount: 280, balanceDueDate: '2026-07-01',
      cautionAmount: 500, depositPaid: 0,
      ...(over.reservation || {}),
    },
    client: {
      firstName: 'Jean', lastName: 'Dupont', email: 'jean@dupont.fr', phone: '0612',
      streetNumber: '12', street: 'rue des Fleurs', postalCode: '75001', city: 'Paris',
      ...(over.client || {}),
    },
    property: { name: 'Villa A', defaultCheckIn: '15:00', defaultCheckOut: '10:00', ...(over.property || {}) },
    options: over.options || [],
    resources: over.resources || [],
    customOptions: over.customOptions || [],
    bedLinenProvidedByDefault: over.bedLinenProvidedByDefault || false,
    settings: { ...SAMPLE_SETTINGS, ...(over.settings || {}) },
  };
}

test('vars expose the canonical client + reservation + property + financial tokens', () => {
  const { vars } = buildContext(baseInput());
  assert.equal(vars.clientFirstName, 'Jean');
  assert.equal(vars.clientLastName, 'Dupont');
  assert.equal(vars.clientFullName, 'Jean Dupont');
  assert.equal(vars.clientEmail, 'jean@dupont.fr');
  assert.equal(vars.clientPhone, '0612');
  assert.equal(vars.clientAddress, '12 rue des Fleurs, 75001 Paris');
  assert.equal(vars.startDate, '10 juillet 2026');
  assert.equal(vars.endDate, '13 juillet 2026');
  assert.equal(vars.checkInTime, '15:00');
  assert.equal(vars.checkOutTime, '10:00');
  assert.equal(vars.nights, '3');
  assert.equal(vars.adultsCount, '2');
  assert.equal(vars.childrenCount, '1');
  assert.equal(vars.totalGuests, '3');
  assert.equal(vars.propertyName, 'Villa A');
  assert.equal(vars.finalPrice, '380,00 €');
  assert.equal(vars.cautionAmount, '500,00 €');
  assert.equal(vars.companyName, 'GuestFlow Demo');
});

test('reservation checkInTime falls back to property.defaultCheckIn when blank', () => {
  const { vars } = buildContext(baseInput({ reservation: { checkInTime: '', checkOutTime: '' } }));
  assert.equal(vars.checkInTime, '15:00');
  assert.equal(vars.checkOutTime, '10:00');
});

test('formatBedConfig: pluralization + zero counts dropped', () => {
  const { formatBedConfig } = __test;
  assert.equal(formatBedConfig({ singleBeds: 1, doubleBeds: 1, babyBeds: 0 }), '1 lit double, 1 lit simple');
  assert.equal(formatBedConfig({ singleBeds: 2, doubleBeds: 0, babyBeds: 0 }), '2 lits simples');
  assert.equal(formatBedConfig({ singleBeds: 0, doubleBeds: 2, babyBeds: 1 }), '2 lits doubles, 1 lit bébé');
  assert.equal(formatBedConfig({ singleBeds: 0, doubleBeds: 0, babyBeds: 0 }), '');
});

test('bedConfig var follows the reservation columns', () => {
  const { vars } = buildContext(baseInput({ reservation: { singleBeds: 2, doubleBeds: 1, babyBeds: 1 } }));
  assert.equal(vars.bedConfig, '1 lit double, 2 lits simples, 1 lit bébé');
});

test('optionsList: empty when no options, sorted alphabetically when several', () => {
  const empty = buildContext(baseInput({ options: [] }));
  assert.equal(empty.vars.optionsList, '');

  const several = buildContext(baseInput({
    options: [
      { title: 'Ménage', autoOptionType: null },
      { title: 'Linge de lit', autoOptionType: 'bed_linen' },
      { title: 'Petit-déjeuner', autoOptionType: 'breakfast' },
    ],
  }));
  assert.equal(several.vars.optionsList, 'Linge de lit, Ménage, Petit-déjeuner');
  // sortedAlphabetically: `localeCompare('fr')` handles diacritics — Ménage between L and P.
});

test('flag hasBedLinenOption is true iff an option carries autoOptionType=bed_linen', () => {
  const yes = buildContext(baseInput({
    options: [{ title: 'Linge de lit', autoOptionType: 'bed_linen' }],
  }));
  assert.equal(yes.flags.hasBedLinenOption, true);

  const no = buildContext(baseInput({
    options: [{ title: 'Petit-déjeuner', autoOptionType: 'breakfast' }],
  }));
  assert.equal(no.flags.hasBedLinenOption, false);
});

test('flag cautionNotBanked: depends on cautionAmount > 0 AND depositPaid != 1', () => {
  const notPaid = buildContext(baseInput({ reservation: { cautionAmount: 500, depositPaid: 0 } }));
  assert.equal(notPaid.flags.cautionNotBanked, true);

  const paid = buildContext(baseInput({ reservation: { cautionAmount: 500, depositPaid: 1 } }));
  assert.equal(paid.flags.cautionNotBanked, false);

  const noCaution = buildContext(baseInput({ reservation: { cautionAmount: 0, depositPaid: 0 } }));
  assert.equal(noCaution.flags.cautionNotBanked, false);
});

test('flag hasOptions reflects the options array', () => {
  assert.equal(buildContext(baseInput({ options: [] })).flags.hasOptions, false);
  assert.equal(buildContext(baseInput({ options: [{ title: 'X' }] })).flags.hasOptions, true);
});

test('missing client → vars stay empty strings (no crash, no undefined leaks)', () => {
  const { vars } = buildContext({ reservation: baseInput().reservation, client: null, property: null });
  assert.equal(vars.clientFirstName, '');
  assert.equal(vars.clientFullName, '');
  assert.equal(vars.clientAddress, '');
  assert.equal(vars.propertyName, '');
});

test('nights computation matches diffDays', () => {
  const { vars } = buildContext(baseInput({ reservation: { startDate: '2026-07-10', endDate: '2026-07-14' } }));
  assert.equal(vars.nights, '4');
});

// ---- propertyWithArticle (specs/email-automation.md §3 rule 13) ----

test('propertyWithArticle joins the stored article with the name', () => {
  const au   = buildContext(baseInput({ property: { name: 'Gite',  nameArticle: 'au' } })).vars;
  const ala  = buildContext(baseInput({ property: { name: 'Tente', nameArticle: 'à la' } })).vars;
  const aux  = buildContext(baseInput({ property: { name: 'Gîtes', nameArticle: 'aux' } })).vars;
  assert.equal(au.propertyWithArticle,  'au Gite');
  assert.equal(ala.propertyWithArticle, 'à la Tente');
  assert.equal(aux.propertyWithArticle, 'aux Gîtes');
});

test('propertyWithArticle elides (no space) for the apostrophe form', () => {
  const { vars } = buildContext(baseInput({ property: { name: 'Aventura Lodge', nameArticle: "à l'" } }));
  assert.equal(vars.propertyWithArticle, "à l'Aventura Lodge");
});

test('propertyWithArticle falls back to "au" when no article is stored', () => {
  const { vars } = buildContext(baseInput({ property: { name: 'Gite', nameArticle: undefined } }));
  assert.equal(vars.propertyWithArticle, 'au Gite');
});

test('propertyWithArticle is empty when the property has no name', () => {
  const { vars } = buildContext(baseInput({ property: { name: '', nameArticle: 'au' } }));
  assert.equal(vars.propertyWithArticle, '');
  assert.equal(__test.formatPropertyWithArticle('', 'au'), '');
});

// ---- senderName (specs/email-automation.md §3 rule 14) ----

test('senderName uses the SMTP "Nom expéditeur" (smtpFromName)', () => {
  const { vars } = buildContext(baseInput({ settings: { smtpFromName: 'Les Gîtes du Sud', companyName: 'SARL Soleil' } }));
  assert.equal(vars.senderName, 'Les Gîtes du Sud');
});

test('senderName falls back to companyName when smtpFromName is blank', () => {
  const { vars } = buildContext(baseInput({ settings: { smtpFromName: '   ', companyName: 'SARL Soleil' } }));
  assert.equal(vars.senderName, 'SARL Soleil');
});

// Baby-bed notice (specs/j7-email-baby-beds.md) — only for bookings with babies.
test('babyBedNotice: no babies → empty notice + flag false', () => {
  const { vars, flags } = buildContext(baseInput({ reservation: { babies: 0, babyBeds: 0 } }));
  assert.equal(vars.babyBedNotice, '');
  assert.equal(flags.hasBabyBedNotice, false);
});

test('babyBedNotice: babies + a baby bed provided → tells how many beds, flag true', () => {
  const { vars, flags } = buildContext(baseInput({ reservation: { babies: 1, babyBeds: 1 } }));
  assert.equal(flags.hasBabyBedNotice, true);
  assert.match(vars.babyBedNotice, /un lit bébé vous est fourni/);
});

test('babyBedNotice: babies + several baby beds → plural count', () => {
  const { vars } = buildContext(baseInput({ reservation: { babies: 2, babyBeds: 2 } }));
  assert.match(vars.babyBedNotice, /des bébés/);
  assert.match(vars.babyBedNotice, /2 lits bébé vous sont fournis/);
});

test('babyBedNotice: babies but NO baby bed → asks the guest to bring one, flag true', () => {
  const { vars, flags } = buildContext(baseInput({ reservation: { babies: 1, babyBeds: 0 } }));
  assert.equal(flags.hasBabyBedNotice, true);
  assert.match(vars.babyBedNotice, /ne disposons plus de lit bébé/);
  assert.match(vars.babyBedNotice, /apporter un/);
});

// ── J-1 reminder additions (specs/j1-arrival-reminder-email.md) ──────────────────

test('resourcesList joins booked resource names, sorted (fr); hasResources reflects presence', () => {
  const { vars, flags } = buildContext(baseInput({
    resources: [{ name: 'Bain nordique' }, { name: 'Lit bébé' }],
  }));
  assert.equal(vars.resourcesList, 'Bain nordique, Lit bébé');
  assert.equal(flags.hasResources, true);
});

test('no resources → empty resourcesList + hasResources false', () => {
  const { vars, flags } = buildContext(baseInput({ resources: [] }));
  assert.equal(vars.resourcesList, '');
  assert.equal(flags.hasResources, false);
});

test('cautionNotReceived is true only when caution due AND not received', () => {
  const due = buildContext(baseInput({ reservation: { cautionAmount: 500, cautionReceived: 0 } }));
  assert.equal(due.flags.cautionNotReceived, true);
  const received = buildContext(baseInput({ reservation: { cautionAmount: 500, cautionReceived: 1 } }));
  assert.equal(received.flags.cautionNotReceived, false);
  const noCaution = buildContext(baseInput({ reservation: { cautionAmount: 0, cautionReceived: 0 } }));
  assert.equal(noCaution.flags.cautionNotReceived, false);
});

test('cautionNotReceived is independent from depositPaid (the J-7 cautionNotBanked proxy)', () => {
  // Acompte paid but caution not received → still owed.
  const { flags } = buildContext(baseInput({ reservation: { cautionAmount: 500, cautionReceived: 0, depositPaid: 1 } }));
  assert.equal(flags.cautionNotReceived, true);
  assert.equal(flags.cautionNotBanked, false);
});

test('hasCleaningOption is true via autoOptionType=cleaning OR an option NAMED « ménage »', () => {
  // Tagged option.
  const tagged = buildContext(baseInput({ options: [{ title: 'Ménage', autoOptionType: 'cleaning' }] }));
  assert.equal(tagged.flags.hasCleaningOption, true);
  // Operator-created option that only carries a name (no autoOptionType) — matched by name,
  // accent- and case-insensitive. This is the bug Adrien reported: the "cleaning at your charge"
  // notice used to show even when cleaning WAS booked.
  const byName = buildContext(baseInput({ options: [{ title: 'Ménage de fin de séjour' }] }));
  assert.equal(byName.flags.hasCleaningOption, true);
  const byNameNoAccent = buildContext(baseInput({ options: [{ title: 'MENAGE complet' }] }));
  assert.equal(byNameNoAccent.flags.hasCleaningOption, true);
  // Unrelated option.
  const without = buildContext(baseInput({ options: [{ title: 'Petit déjeuner', autoOptionType: 'breakfast' }] }));
  assert.equal(without.flags.hasCleaningOption, false);
});

// ── J-2 nordic-bath reminder (specs/j1-arrival-reminder-email.md) ────────────────

test('hasNordicBath matches the resource by NAME (« nordique », accent/case-insensitive)', () => {
  const yes = buildContext(baseInput({ resources: [{ name: 'Bain Nordique' }] }));
  assert.equal(yes.flags.hasNordicBath, true);
  const noAccent = buildContext(baseInput({ resources: [{ name: 'bain nordique premium' }] }));
  assert.equal(noAccent.flags.hasNordicBath, true);
  const no = buildContext(baseInput({ resources: [{ name: 'Lit bébé' }] }));
  assert.equal(no.flags.hasNordicBath, false);
});

test('nordicBathReminder: gear sentence only when no slot scheduled', () => {
  const { vars } = buildContext(baseInput({ resources: [{ name: 'Bain nordique' }] }));
  assert.ok(vars.nordicBathReminder.includes('maillot de bain'), 'gear sentence present');
  assert.ok(vars.nordicBathReminder.includes('tongs'), 'tongs mentioned');
  assert.ok(!vars.nordicBathReminder.includes('Votre créneau'), 'no slot line when unscheduled');
  assert.equal(vars.nordicBathSchedule, '');
});

test('nordicBathReminder recalls the scheduled slot(s) when sessions are set', () => {
  const { vars } = buildContext(baseInput({
    resources: [{
      name: 'Bain nordique',
      sessions: JSON.stringify([
        { date: '2026-07-12', start: '18:00', end: '19:30' },
        { date: '2026-07-13', start: '17:00', end: '18:00' },
      ]),
    }],
  }));
  assert.ok(vars.nordicBathSchedule.includes('de 18'), 'first slot start present');
  assert.ok(vars.nordicBathSchedule.includes(' et '), 'two slots joined');
  assert.ok(vars.nordicBathReminder.includes('Votre créneau est réservé'), 'slot line present');
  assert.ok(vars.nordicBathReminder.includes('maillot de bain'), 'gear sentence still present');
});

test('no nordic-bath resource → empty reminder + flag false', () => {
  const { vars, flags } = buildContext(baseInput({ resources: [{ name: 'Lit bébé' }] }));
  assert.equal(flags.hasNordicBath, false);
  assert.equal(vars.nordicBathReminder, '');
  assert.equal(vars.nordicBathSchedule, '');
});

// ── J-1 linen-by-default (specs/j1-linen-default-message.md) ─────────────────────

test('bedLinenProvidedByDefault: drops the linen option from reservedOptionsList + sets the flag', () => {
  const { vars, flags } = buildContext(baseInput({
    bedLinenProvidedByDefault: true,
    options: [
      { title: 'Linge de lit', autoOptionType: 'bed_linen' },
      { title: 'Petit déjeuner', autoOptionType: 'breakfast' },
    ],
  }));
  assert.equal(flags.bedLinenProvidedByDefault, true);
  assert.equal(vars.reservedOptionsList, 'Petit déjeuner'); // linen removed
  assert.equal(vars.optionsList, 'Linge de lit, Petit déjeuner'); // untouched for other templates
  assert.equal(flags.bedLinenBringYourOwn, false);
});

test('reservedOptionsList empty → hasReservedOptions false (line hidden)', () => {
  const { flags, vars } = buildContext(baseInput({
    bedLinenProvidedByDefault: true,
    options: [{ title: 'Linge de lit', autoOptionType: 'bed_linen' }],
  }));
  assert.equal(vars.reservedOptionsList, '');
  assert.equal(flags.hasReservedOptions, false);
});

test('no linen anywhere → bedLinenBringYourOwn true, not provided by default', () => {
  const { flags } = buildContext(baseInput({ bedLinenProvidedByDefault: false, options: [] }));
  assert.equal(flags.bedLinenBringYourOwn, true);
  assert.equal(flags.bedLinenProvidedByDefault, false);
});

test('linen as a paid add-on (not provided by default) → listed, no bring-your-own, no beds-made', () => {
  const { vars, flags } = buildContext(baseInput({
    bedLinenProvidedByDefault: false,
    options: [{ title: 'Linge de lit', autoOptionType: 'bed_linen' }],
  }));
  assert.equal(vars.reservedOptionsList, 'Linge de lit'); // kept
  assert.equal(flags.bedLinenProvidedByDefault, false);
  assert.equal(flags.bedLinenBringYourOwn, false); // hasBedLinenOption is true
});

// ── J-1 complement to collect (specs/j1-complement-to-collect.md) ────────────────

test('complementToCollect true only when complementAmount > 0 and unpaid', () => {
  assert.equal(buildContext(baseInput({ reservation: { complementAmount: 55, complementPaid: 0 } })).flags.complementToCollect, true);
  assert.equal(buildContext(baseInput({ reservation: { complementAmount: 55, complementPaid: 1 } })).flags.complementToCollect, false);
  assert.equal(buildContext(baseInput({ reservation: { complementAmount: 0, complementPaid: 0 } })).flags.complementToCollect, false);
});

test('complementNotice lists in-complement options/resources/custom-options + tourist tax with amounts', () => {
  const { vars } = buildContext(baseInput({
    reservation: { complementAmount: 78, complementPaid: 0, touristTaxInComplement: 1, touristTaxTotal: 8 },
    options: [
      { title: 'Petit déjeuner', autoOptionType: 'breakfast', inComplement: 1, offered: 0, totalPrice: 15 },
      { title: 'Linge de lit', autoOptionType: 'bed_linen', inComplement: 0, offered: 0, totalPrice: 10 }, // not in complement → excluded
    ],
    resources: [{ name: 'Bain nordique', inComplement: 1, offered: 0, totalPrice: 40 }],
    customOptions: [{ description: 'Panier garni', amount: 15, inComplement: 1, offered: 0 }],
  }));
  assert.match(vars.complementNotice, /Un complément de 78,00 €/);
  assert.match(vars.complementNotice, /Il comprend notamment/);
  assert.match(vars.complementNotice, /Petit déjeuner \(15,00 €\)/);
  assert.match(vars.complementNotice, /Bain nordique \(40,00 €\)/);
  assert.match(vars.complementNotice, /Panier garni \(15,00 €\)/);
  assert.match(vars.complementNotice, /Taxe de séjour \(8,00 €\)/);
  assert.doesNotMatch(vars.complementNotice, /Linge de lit/);
});

test('complementNotice excludes offered (free) in-complement items', () => {
  const { vars } = buildContext(baseInput({
    reservation: { complementAmount: 0.0001 + 0, complementPaid: 0 },
    options: [{ title: 'Cadeau', inComplement: 1, offered: 1, totalPrice: 0 }],
  }));
  // complementAmount ~0 → no notice; but even with an offered item, no breakdown.
  assert.doesNotMatch(vars.complementNotice, /Cadeau/);
});

test('complementNotice: amount only (no "comprend") when there are no identifiable items', () => {
  const { vars } = buildContext(baseInput({
    reservation: { complementAmount: 30, complementPaid: 0 },
    options: [], resources: [], customOptions: [],
  }));
  assert.match(vars.complementNotice, /Un complément de 30,00 €/);
  assert.doesNotMatch(vars.complementNotice, /Il comprend/);
});

test('complementNotice empty when complement is paid', () => {
  const { vars, flags } = buildContext(baseInput({ reservation: { complementAmount: 55, complementPaid: 1 } }));
  assert.equal(flags.complementToCollect, false);
  assert.equal(vars.complementNotice, '');
});
