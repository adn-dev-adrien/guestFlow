// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 16 — « Boisson offerte sur l'écart » accepts exactly the options the cheaper slot can give: for every kind of option of the catalogue,
// the setting is accepted if and only if a voucher used on a cheaper slot is given that drink.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');
const settings = require('../settings');

const s = f.setup();
s.campaign('jour', 'day');
const declared = settings.declared(() => s.api.catalogue).find((entry) => entry.key === 'leftoverDrinkArticleRef');

const OPTIONS = Object.entries({ drink: s.ids.drink, perPerson: s.ids.perPerson, perNight: s.ids.perNight, board: s.ids.board });
for (const [kind, id] of OPTIONS) {
  test(`the setting accepts an option of the « ${kind} » kind if and only if the cheaper slot gives it`, () => {
    const ref = `option:${id}`;
    s.settingsStore.set('leftoverDrinkArticleRef', ref);
    const voucher = s.sell('jour', 'weekend');
    const recap = s.quoteOf(voucher, f.TUESDAY, '10:00');
    assert.equal(recap.ok, true, JSON.stringify(recap));
    const given = recap.data.gifts.some((gift) => gift.label === 'Boisson offerte');
    assert.equal(declared.validate(ref) === null, given, `${kind}: validator ${JSON.stringify(declared.validate(ref))}, given ${given}`);
  });
}

test('a malformed reference, an option that does not exist and an empty value', () => {
  assert.match(declared.validate('resource:3'), /option du catalogue/);
  assert.match(declared.validate('option:999999'), /ne peut pas être offerte/);
  assert.equal(declared.validate(''), null);
  assert.equal(declared.validate(null), null);
});
