/**
 * The console's clock. `CP_NOW` moves it, outside production only, so the lifecycle can be walked
 * through by hand (spec §7, manual verification).
 */

function now(env = process.env) {
  if (env.CP_NOW && env.NODE_ENV !== 'production') return new Date(env.CP_NOW);
  return new Date();
}

module.exports = { now };
