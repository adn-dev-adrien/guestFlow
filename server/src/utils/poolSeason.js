/**
 * Pool season of a property (specs/settings-input-guards.md rules 22-26): off, all year, or a season.
 * « All year » is stored as 01-01 → 12-31 in the two existing columns.
 */

const ALL_YEAR = { poolSeasonStart: '01-01', poolSeasonEnd: '12-31' };
const MODES = ['none', 'allYear', 'season'];

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const clean = (value) => String(value == null ? '' : value).trim();

function poolSeasonModeOf(start, end) {
  const from = clean(start);
  const to = clean(end);
  if (!from && !to) return 'none';
  return from === ALL_YEAR.poolSeasonStart && to === ALL_YEAR.poolSeasonEnd ? 'allYear' : 'season';
}

/**
 * The bounds a payload asks to store, or `{}` when it says nothing about the pool.
 * A payload with only the two dates (older client, CSV, plugin) keeps today's meaning (rule 24).
 */
function resolvePoolSeason(body = {}) {
  if (has(body, 'poolSeasonMode') && MODES.includes(body.poolSeasonMode)) {
    if (body.poolSeasonMode === 'none') return { poolSeasonStart: '', poolSeasonEnd: '' };
    if (body.poolSeasonMode === 'allYear') return { ...ALL_YEAR };
  }
  const bounds = {};
  if (has(body, 'poolSeasonStart')) bounds.poolSeasonStart = clean(body.poolSeasonStart);
  if (has(body, 'poolSeasonEnd')) bounds.poolSeasonEnd = clean(body.poolSeasonEnd);
  return bounds;
}

module.exports = { ALL_YEAR, MODES, poolSeasonModeOf, resolvePoolSeason };
