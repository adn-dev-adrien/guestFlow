/**
 * The SAS plugin's settings (specs/plugins-phase-p-productisation.md rule 16): « Contrôle de
 * l'extincteur », off by default. On, the departure SAS asks for the extinguisher and bills its two
 * repair rows, which the plugin inserts the moment the check is turned on. Off, the SAS shows no
 * extinguisher step and accepts no seal field, so the audit records none.
 */

const sdk = require('../sdk');

const EXTINGUISHER_CHECK = 'extinguisherCheck';
const ON = new Set(['1', 'true']);

let context = null;

const isOn = (value) => ON.has(String(value == null ? '' : value).trim().toLowerCase());

function validateSwitch(value) {
  return value === true || value === false || ['0', '1', 'true', 'false'].includes(String(value)) ? null : 'Valeur attendue : 0 ou 1.';
}

const DECLARED = [{
  key: EXTINGUISHER_CHECK,
  default: '0',
  validate: validateSwitch,
  afterSave: (value) => { if (isOn(value)) sdk.coreModule('repairAmountsModel').ensureProtected(); },
}];

/** Bound once by `register`, so the controllers read the live setting. */
function bind(ctx) {
  context = ctx;
  ctx.settings.declare(DECLARED);
}

function extinguisherCheckOn() {
  return Boolean(context) && isOn(context.settings.get(EXTINGUISHER_CHECK));
}

module.exports = { bind, extinguisherCheckOn, EXTINGUISHER_CHECK, DECLARED };
