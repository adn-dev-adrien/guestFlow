/**
 * The Google connection, stored in plugin_settings (specs/plugins-phase-1-sdk.md rule 7). Same API as
 * the accessors that used to live on the core settings model, so the sync engine, the OAuth client and
 * the controller did not change. The refresh token and the calendar id are secrets: encrypted at rest,
 * never returned over HTTP.
 */

const DECLARED = [
  { key: 'refreshToken', secret: true },
  { key: 'calendarId', secret: true },
  { key: 'connectedEmail' },
  { key: 'connectedAt' },
  { key: 'calendarSummary' },
  { key: 'lastSyncAt' },
  { key: 'lastSyncOk' },
  { key: 'lastSyncDetail' },
];

// store: ctx.settings ({ get, set, raw }); publicUrl: () => string.
function createGoogleSettings({ store, publicUrl }) {
  const str = (key) => String(store.get(key) || '').trim();

  return {
    publicUrl,

    storeGoogleTokens({ refreshToken, email }) {
      store.set('refreshToken', refreshToken == null ? '' : String(refreshToken));
      store.set('connectedEmail', email == null ? '' : String(email));
      store.set('connectedAt', new Date().toISOString());
    },

    // Decrypted refresh token for internal use. '' when absent or undecryptable (the caller then
    // treats the connection as missing).
    googleTokens() {
      return { refreshToken: store.get('refreshToken') };
    },

    googleConnected() {
      return Boolean(store.raw('refreshToken'));
    },

    // The encrypted blob — cache key for the sync engine's calendar client; never decrypted here.
    googleTokenBlob() {
      return store.raw('refreshToken');
    },

    storeGoogleCalendarSelection({ calendarId, summary }) {
      store.set('calendarId', calendarId == null ? '' : String(calendarId));
      store.set('calendarSummary', summary == null ? '' : String(summary));
    },

    googleCalendarSelection() {
      return { calendarId: str('calendarId'), summary: str('calendarSummary') };
    },

    // `lastSyncOk` is tri-state: '1', '0', or absent (never ran).
    recordGoogleSyncResult({ ok, detail }) {
      store.set('lastSyncAt', new Date().toISOString());
      store.set('lastSyncOk', ok ? '1' : '0');
      store.set('lastSyncDetail', String(detail || ''));
    },

    clearGoogleConnection() {
      DECLARED.forEach(({ key }) => store.set(key, ''));
    },

    googleStatus() {
      const ok = str('lastSyncOk');
      return {
        connected: this.googleConnected(),
        connectedEmail: str('connectedEmail'),
        connectedAt: str('connectedAt') || null,
        calendarId: str('calendarId'),
        calendarSummary: str('calendarSummary'),
        lastSyncAt: str('lastSyncAt') || null,
        lastSyncOk: ok === '' ? null : ok === '1',
        lastSyncDetail: str('lastSyncDetail'),
      };
    },
  };
}

module.exports = { createGoogleSettings, DECLARED };
