/**
 * The built-in plugin modules (specs/plugin-engine-backport.md rule 1). The only core file allowed to
 * import a plugin folder; everything else asks `sdk/registry`.
 */

module.exports = [
  require('./gites-de-france-intake'),
  require('./booking-intake'),
  require('./airbnb-intake'),
];
