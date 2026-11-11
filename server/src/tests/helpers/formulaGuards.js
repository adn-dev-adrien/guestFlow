// specs/pricing-components.md §3 rule 66 — the static guards that name their patterns, their home and, for the
// exporters, their scope. Shared by `no-duplicate-formulas.unit.test.js` (which judges the hits against the allow-lists
// of `fixtures/no-duplicate-formulas/`) and by the script that regenerates those lists.
//
// money      no rounding helper defined outside `money.js` (rule 38: PR C merges the copies once the replay proves it)
// dates      no module compares dates to decide a stay phase or a collection moment outside `stayClock*` (rule 45)
// hourly     the hourly grid (`priceRange`, band arithmetic) exists once, in the hourly family
// families   the per-type multiplier (`getTypeMultiplier`, persons × nights) exists once, under `articles/`
// exporters  no accounting exporter imports `vat/`, `articles/` or the pipeline (rule 63): it reads neutral entries
// A path of the plugin folders is built, not written: these are repository paths to classify, not files the test reads
// (plugin-removal-matrix).
const plugin = (id, ...rest) => ['plugins/' + id, ...rest].join('/'); // eslint-disable-line prefer-template

const GUARDS = [
  {
    name: 'money',
    probe: "const round2 = (n) => Math.round(n * 100) / 100;",
    patterns: [
      /\bfunction\s+round2\s*\(/, // a private round2
      /\bconst\s+round2\s*=/,
      /\bconst\s+cents\s*=/, // a private euros → cents conversion
      /\b(function|const)\s+roundHalfAway\b/,
    ],
    isHome: (file) => file === 'utils/pricing/money.js',
  },
  {
    name: 'dates',
    probe: "const locked = Boolean(row && row.startDate && row.startDate <= today);",
    patterns: [
      /\bstartDate\b[^;\n]*\s(<=|<|>=|>)\s*[\w.]*([tT]oday\w*|getTodayIsoDate\(\))/, // startDate <= today
      /[\w.]*([tT]oday\w*|getTodayIsoDate\(\))\s*(<=|<|>=|>)\s*[\w.]*startDate\b/, // today >= startDate
      /\bhasGuestArrived\b/,
      /\bisArrivalNotMarked\b/,
      /\bfunction\s+isCheckoutDone\b/, // end-of-stay collection allowed
      /\bsasLockReason\(\s*\{\s*dateIso/, // whether the arrival SAS may open
    ],
    isHome: (file) => /(^|\/)stayClock[^/]*\.js$/.test(file),
  },
  {
    name: 'hourly',
    probe: "price: priceRange(slot.start, slot.end, rate),",
    patterns: [
      /\bpriceRange\s*\(/, // the hourly grid
      /\b(hourlyEveningRate|eveningRate|hourlyExternalEveningRate)\s*\*/, // a band times its rate
      /\*\s*[\w.]*(hourlyEveningRate|eveningRate)\b/,
    ],
    isHome: (file) => file === plugin('hourly-resources', 'hourlyPricing.js') || file === plugin('hourly-resources', 'hourlyFamily.js'),
  },
  {
    name: 'families',
    probe: "const multiplier = getTypeMultiplier(priceType, persons, nights);",
    patterns: [
      /\bgetTypeMultiplier\b/, // the per-type multiplier
      /\bpersons\s*\*\s*nights\b/, // per_person_per_night written by hand
    ],
    isHome: (file) => file.startsWith('utils/pricing/articles/'),
  },
  {
    name: 'exporters',
    probe: "const { vatOf } = require('../../utils/pricing/vat');",
    patterns: [
      /require\(\s*['"][^'"]*\/vat(\/[^'"]*)?['"]\s*\)/, // utils/pricing/vat
      /require\(\s*['"][^'"]*\/articles(\/[^'"]*)?['"]\s*\)/, // utils/pricing/articles
      /require\(\s*['"][^'"]*pricing\/(pipelines?|compose|steps\/[^'"]*)['"]\s*\)/, // the pipeline
    ],
    isHome: () => false,
    scope: (file) => file.startsWith(`${plugin('accounting-export')}/`) && !file.includes('/tests/'),
  },
];

// The PR that empties each list (rule 66: the lists must be empty at the end of PR C).
// Rule 45's table of today's call sites, by file: B moves the decisions of the fiche, the mid-stay window, the checkout and
// the SAS; C the lock, the lists, the guest app, the intakes and the module `arrivalMoment`. Date-window checks of an entered
// date and slot logic that the pattern also meets are listed with C, where each one is judged.
const DATES_IN_B = Object.freeze([
  'models/reservationsModel.js', 'utils/midStayExtrasWindow.js', 'utils/endOfStayCheckout.js', plugin('sas', 'controller.js'),
  'utils/sasEditWindow.js', 'utils/receptionView.js', // the SAS lock reason that row of the table calls
]);
const datesRemovedBy = (file, text) => {
  if (file === 'controllers/reservationsController.js') return /pastReservationLocked|const started\b/.test(text) ? 'PR C' : 'PR B';
  return DATES_IN_B.includes(file) ? 'PR B' : 'PR C';
};

const REMOVED_BY = Object.freeze({
  dates: datesRemovedBy,
  money: () => 'PR C', // rule 38: the private round2 copies merge once the replay proves each tie rule
  hourly: () => 'PR B', // rules 24-26: the evening supplement is identical from the shop, the SAS and the fiche
  families: () => 'PR B', // rules 47-49: every seller prices through the Articles head
  exporters: () => 'PR B', // rule 63: exporters read neutral entries
});

module.exports = { GUARDS, REMOVED_BY, plugin };
