/**
 * The built-in plugin modules (specs/plugins-phase-1-sdk.md rule 2). The only core file allowed to
 * import a plugin folder; everything else asks `sdk/registry`.
 */

module.exports = [
  require('./weather-alerts'),
  require('./school-holidays'),
  require('./google-calendar'),
  require('./tariff-recipes'),
  require('./gate-access'),
  require('./sas'),
];
