// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 15 — a supplement is named by what costs more, in the direction it goes: « soirée » only when the slot is evening, the voucher day and
// the evening dearer at the slot's period; « week-end » only when the slot is weekend, the voucher week and the weekend dearer in the slot's band; both for « soirée week-end »; anything
// else (an odd grid) « Supplément créneau ». Every voucher (band × period) on every slot class (band × period), on the production grid and on odd grids the validator accepts. `evening` is true
// only when the slot is evening and the voucher day.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');

const s = f.setup();
s.db.prepare('UPDATE resources SET slotDuration = 60 WHERE id = ?').run(s.ids.bath);
s.campaign('jour', 'day');
s.campaign('soir', 'evening');
const eveningStart = s.db.prepare('SELECT hourlyEveningStart FROM resources WHERE id = ?').get(s.ids.bath).hourlyEveningStart;
const set = (g) => s.db.prepare(`UPDATE resources SET hourlyExternalDayRate = @wd, hourlyExternalEveningRate = @we, hourlyExternalWeekendDayRate = @ed, hourlyExternalWeekendEveningRate = @ee,
  hourlyExternalNextDayRate = @wd, hourlyExternalNextEveningRate = @we, hourlyExternalWeekendNextDayRate = @ed, hourlyExternalWeekendNextEveningRate = @ee WHERE id = @id`).run({ ...g, id: s.ids.bath });
const rate = (g, band, period) => g[(period === 'weekend' ? 'e' : 'w') + (band === 'evening' ? 'e' : 'd')];
const GRIDS = {
  production: { wd: 50, we: 70, ed: 70, ee: 90 },
  'weekend cheaper': { wd: 50, we: 70, ed: 40, ee: 60 },
  'day dearer than evening': { wd: 80, we: 70, ed: 90, ee: 85 },
  'weekend evening cheaper than its day': { wd: 50, we: 70, ed: 60, ee: 55 },
  'evening cheaper than day, weekend dearer': { wd: 60, we: 40, ed: 90, ee: 70 },
  flat: { wd: 50, we: 50, ed: 50, ee: 50 },
};
const SLOTS = [['week day', f.TUESDAY, '10:00', 'day', 'week'], ['week evening', f.TUESDAY, eveningStart, 'evening', 'week'], ['weekend day', f.SATURDAY, '10:00', 'day', 'weekend'], ['weekend evening', f.SATURDAY, eveningStart, 'evening', 'weekend']];
const VOUCHERS = [['jour', 'day', 'week'], ['jour', 'day', 'weekend'], ['soir', 'evening', 'week'], ['soir', 'evening', 'weekend']];
const LABELS = { both: 'Supplément soirée week-end', evening: 'Supplément soirée', weekend: 'Supplément week-end', neither: 'Supplément créneau' };

for (const [gridName, grid] of Object.entries(GRIDS)) {
  test(`grid « ${gridName} »: every supplement is named by what costs more, in its direction, and « evening » follows the band only`, () => {
    set(grid);
    let supplements = 0;
    for (const [slug, voucherBand, voucherPeriod] of VOUCHERS) {
      for (const [slotName, date, start, slotBand, slotPeriod] of SLOTS) {
        const voucher = s.sell(slug, voucherPeriod);
        const slot = s.slotsOf(voucher, date)[start];
        assert.ok(slot, `${slug}-${voucherPeriod} on ${slotName}`);
        if (slot.supplementCents <= 0) continue;
        supplements += 1;
        const eveningOverDay = slotBand === 'evening' && voucherBand === 'day' && rate(grid, 'evening', slotPeriod) > rate(grid, 'day', slotPeriod);
        const weekendOverWeek = slotPeriod === 'weekend' && voucherPeriod === 'week' && rate(grid, slotBand, 'weekend') > rate(grid, slotBand, 'week');
        const expected = LABELS[eveningOverDay && weekendOverWeek ? 'both' : (eveningOverDay ? 'evening' : (weekendOverWeek ? 'weekend' : 'neither'))];
        assert.equal(slot.supplementLabel, expected, `${slug}-${voucherPeriod} on ${slotName}`);
        assert.equal(slot.evening, slotBand === 'evening' && voucherBand === 'day', `evening flag, ${slug}-${voucherPeriod} on ${slotName}`);
        const recap = s.quoteOf(voucher, date, start);
        assert.equal(recap.data.supplement.label, expected, 'the recap names it the same way');
      }
    }
    assert.ok(grid === GRIDS.flat ? supplements === 0 : supplements > 0);
  });
}
