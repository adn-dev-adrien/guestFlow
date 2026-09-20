/**
 * The sequence-specific part of an email context (specs/guest-email-sequence.md §3.5, rules 20 and
 * 26-28): whether the confirmation must carry the arrival essentials, the season send date and gift
 * deadline, and the unsubscribe link of the season emails.
 *
 * `preferences` is an emailPreferencesModel (injected for tests). `sendDate` defaults to the next
 * occurrence of the template's date after `today`, which is what a preview wants.
 */

const { MAIL, SEASON_STABLE_KEYS, giftDeadline, isLastMinute } = require('./guestEmailSequence');
const { unsubscribeUrl } = require('../models/emailPreferencesModel');

function nextSeasonDate(stableKey, today) {
  const year = Number(today.slice(0, 4));
  const monthDay = stableKey === MAIL.NOVEMBER ? '11-15' : '01-06';
  const thisYear = `${year}-${monthDay}`;
  return thisYear >= today ? thisYear : `${year + 1}-${monthDay}`;
}

function sequenceContextFor({ stableKey, reservation, client, settings, preferences, sendDate, today }) {
  const context = { lastMinute: reservation ? isLastMinute(reservation) : false };
  if (!SEASON_STABLE_KEYS.includes(stableKey)) return context;
  const day = String(today || new Date().toISOString().slice(0, 10));
  const date = sendDate || nextSeasonDate(stableKey, day);
  const token = client && preferences ? preferences.ensureToken(client.id) : '';
  return {
    ...context,
    sendDate: date,
    giftDeadline: giftDeadline(stableKey, date),
    unsubscribeUrl: unsubscribeUrl(settings && settings.publicUrl, token),
  };
}

module.exports = { sequenceContextFor, nextSeasonDate };
