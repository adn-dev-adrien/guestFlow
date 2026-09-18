// specs/guest-email-sequence.md §6.1 — the six shipped templates, rendered FR and EN through the real
// context builder: no token left behind, the unsubscribe link only where it belongs, and the content
// rules of §3.5 (no option push in the confirmation, one review solicitation, gifts with a deadline).

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
const { SEQUENCE_STABLE_KEYS, SEASON_STABLE_KEYS, MAIL } = require('../utils/guestEmailSequence');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');

const FACTS = {
  optionMeta: {
    8: { id: 8, title: 'Linge de lit', autoOptionType: 'bed_linen' },
    9: { id: 9, title: 'Linge de toilette', autoOptionType: 'bathroom_linen' },
    21: { id: 21, title: 'Jus de pomme 1L', seedKey: 'drink_jus_pomme_1l', category: 'Boissons' },
  },
  defaults: [{ optionId: 8, offered: 1 }],
  available: [{ id: 9, title: 'Linge de toilette', autoOptionType: 'bathroom_linen', price: 8 }, { id: 21, title: 'Jus de pomme 1L', seedKey: 'drink_jus_pomme_1l', price: 5 }],
  bathFreeMinutes: 90,
  properties: [{ id: 1, name: 'La Granja', nameArticle: 'à', minNightlyPrice: 319 }],
};

function render(stableKey, lang) {
  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === stableKey);
  const season = SEASON_STABLE_KEYS.includes(stableKey);
  const context = buildContext({
    reservation: {
      id: 1, reservationNumber: 'GF-2027-0142', startDate: '2027-07-10', endDate: '2027-07-17', createdAt: '2027-03-02',
      checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 2, doubleBeds: 1, singleBeds: 2,
      finalPrice: 1240, platform: 'direct',
    },
    client: { id: 1, firstName: 'Camille', email: 'camille@example.fr' },
    property: { id: 1, name: 'La Granja', nameArticle: 'à', defaultCautionAmount: 500, emailHook: 'Chaque matin, le soleil s\'y lève sur la vallée.' },
    options: [],
    stayFacts: FACTS,
    settings: { companyPhone: '06 00 00 00 00', smtpFromName: 'Adrien et Sophie', googleReviewUrl: 'https://g.page/r/solio/review', instagramUrl: 'https://www.instagram.com/domainesolio' },
    lang,
    sequence: season
      ? { sendDate: stableKey === MAIL.NOVEMBER ? '2027-11-15' : '2028-01-06', giftDeadline: stableKey === MAIL.NOVEMBER ? '2027-12-15' : '2028-02-29', unsubscribeUrl: 'https://guestflow.example/preferences/emails?t=abc' }
      : {},
  });
  const side = lang === 'en' ? { subject: def.subjectEn, body: def.bodyEn } : { subject: def.subject, body: def.body };
  return renderTemplate(side, context);
}

test('the six templates render in French and English with no token left behind', () => {
  for (const key of SEQUENCE_STABLE_KEYS) {
    for (const lang of ['fr', 'en']) {
      const out = render(key, lang);
      assert.deepEqual(out.missingVariables, [], `${key}/${lang}`);
      assert.doesNotMatch(`${out.subject}\n${out.body}`, /\{\{|\}\}/, `${key}/${lang}`);
      assert.doesNotMatch(out.body, /\n{3,}/, `${key}/${lang}: no stray blank lines`);
    }
  }
});

test('unsubscribe link on the two season emails only', () => {
  for (const key of SEQUENCE_STABLE_KEYS) {
    const has = /preferences\/emails\?t=abc/.test(render(key, 'fr').body);
    assert.equal(has, SEASON_STABLE_KEYS.includes(key), key);
  }
});

test('confirmation: stay amount, included bath, no caution, no cleaning, no option push', () => {
  const { subject, body } = render(MAIL.CONFIRMATION, 'fr');
  assert.equal(subject, 'Votre séjour à La Granja est confirmé');
  assert.match(body, /Montant du séjour : 1240,00 €/);
  assert.match(body, /- 1 h 30 de bain nordique privatif\n/);
  assert.match(body, /La piscine, partagée avec l'autre hébergement du domaine/);
  assert.doesNotMatch(body, /caution|ménage|alléger|€ par personne/i);
});

test('J-7: property hook, bed configuration, towels as lightening, map link written in full', () => {
  const { body } = render(MAIL.J7, 'fr');
  assert.match(body, /vous serez à La Granja\. Chaque matin, le soleil s'y lève sur la vallée\./);
  assert.match(body, /1 lit double et 2 lits simples/);
  assert.match(body, /Si vous préférez voyager plus léger/);
  assert.match(body, /Des chaussures fermées/);
  assert.match(body, /https:\/\/map\.domainesolio\.com/);
  assert.match(body, /Vous fêtez un événement/);
});

test('J+1: one review solicitation, no counterpart, Instagram, the seasons', () => {
  const { body } = render(MAIL.J1, 'fr');
  assert.equal((body.match(/quelques mots sur/g) || []).length, 1, 'one review solicitation');
  assert.equal((body.match(/g\.page/g) || []).length, 1, 'a single review link');
  assert.doesNotMatch(body, /offert|réduction|remise|en échange/i);
  assert.match(body, /Si vous êtes nostalgiques de votre séjour/);
  assert.match(body, /Le domaine change de visage à chaque saison/);
});

test('season emails: prices « à partir de », the gift and its deadline', () => {
  const november = render(MAIL.NOVEMBER, 'fr').body;
  assert.match(november, /à La Granja, à partir de 319 € la nuit/);
  assert.match(november, /commandé avant le mercredi 15 décembre 2027, nous offrirons à la personne qui le reçoit une planche du terroir/);
  const january = render(MAIL.JANUARY, 'fr');
  assert.equal(january.subject, 'Belle année 2028, depuis le Domaine Solio');
  assert.match(january.body, /Vous étiez venus à La Granja en juillet 2027/);
  assert.match(january.body, /si vous réservez avant le mardi 29 février 2028, le petit-déjeuner du premier matin vous sera offert/);
  assert.doesNotMatch(january.body, /été que vous avez connu/);
});
