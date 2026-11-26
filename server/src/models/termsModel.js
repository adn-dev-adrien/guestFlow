/**
 * CGV persistence (specs/reservations/terms-acceptance-record.md §5, per activity since specs/gift-vouchers/gift-voucher-campaigns.md rule 37): the
 * drafts, the published versions and the acceptances. Versions and acceptances are insert-only — there is no update or delete statement
 * for them here, on purpose: they are what a guest accepted.
 */

const db = require('../database');

const LODGING = 'lodging';

function createTermsModel(database) {
  // Statements are prepared on first use, not at load: modules requiring this one (the controllers)
  // must stay loadable against the minimal schemas the unit tests build.
  const lazy = (make) => { let st = null; return () => { st = st || make(); return st; }; };
  const getDraftStmt = lazy(() => database.prepare('SELECT markdownFr, markdownEn, updatedAt FROM terms_draft WHERE activity = ?'));
  const saveDraftStmt = lazy(() => database.prepare(`
    INSERT INTO terms_draft (activity, markdownFr, markdownEn, updatedAt) VALUES (@activity, @fr, @en, @now)
    ON CONFLICT(activity) DO UPDATE SET markdownFr = @fr, markdownEn = @en, updatedAt = @now
  `));
  const currentStmt = lazy(() => database.prepare('SELECT * FROM terms_versions WHERE activity = ? ORDER BY version DESC LIMIT 1'));
  const byVersionStmt = lazy(() => database.prepare('SELECT * FROM terms_versions WHERE activity = ? AND version = ?'));
  const byIdStmt = lazy(() => database.prepare('SELECT * FROM terms_versions WHERE id = ?'));
  const maxVersionStmt = lazy(() => database.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM terms_versions WHERE activity = ?'));
  const insertVersionStmt = lazy(() => database.prepare(`
    INSERT INTO terms_versions
      (activity, version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt, publishedBy)
    VALUES
      (@activity, @version, @markdownFr, @markdownEn, @htmlFr, @htmlEn, @variablesJson, @contentHash, @publishedAt, @publishedBy)
  `));
  const listStmt = lazy(() => database.prepare(`
    SELECT v.id, v.version, v.publishedAt, v.contentHash,
           (SELECT COUNT(*) FROM terms_acceptances a WHERE a.termsVersionId = v.id) AS acceptanceCount
      FROM terms_versions v
     WHERE v.activity = ?
     ORDER BY v.version DESC
  `));
  const insertAcceptanceStmt = lazy(() => database.prepare(`
    INSERT INTO terms_acceptances
      (reservationId, termsVersionId, acceptedAt, ip, userAgent, pluginVersion, activity, subjectType, subjectRef, channel)
    VALUES
      (@reservationId, @termsVersionId, @acceptedAt, @ip, @userAgent, @pluginVersion, @activity, @subjectType, @subjectRef, @channel)
  `));
  const insertHistoryStmt = lazy(() => database.prepare(
    "INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'terms_accepted', ?)",
  ));
  const acceptanceByReservationStmt = lazy(() => database.prepare(`
    SELECT a.*, v.version, v.publishedAt, v.contentHash
      FROM terms_acceptances a
      JOIN terms_versions v ON v.id = a.termsVersionId
     WHERE a.activity = @activity
       AND (a.reservationId = @id
            OR a.reservationId IN (SELECT id FROM reservations WHERE convertedReservationId = @id))
     ORDER BY a.id DESC
     LIMIT 1
  `));
  const acceptanceBySubjectStmt = lazy(() => database.prepare(`
    SELECT a.*, v.version, v.publishedAt, v.contentHash
      FROM terms_acceptances a
      JOIN terms_versions v ON v.id = a.termsVersionId
     WHERE a.activity = @activity AND a.subjectType = @subjectType AND a.subjectRef = @subjectRef
     ORDER BY a.id DESC
     LIMIT 1
  `));
  const otherAcceptancesStmt = lazy(() => database.prepare(`
    SELECT a.*, v.version, v.publishedAt, v.contentHash
      FROM terms_acceptances a
      JOIN terms_versions v ON v.id = a.termsVersionId
     WHERE a.activity != 'lodging' AND a.reservationId = ?
       AND a.id = (SELECT MAX(b.id) FROM terms_acceptances b WHERE b.activity = a.activity AND b.reservationId = a.reservationId)
     ORDER BY a.activity
  `));

  const publishTx = lazy(() => database.transaction(({ activity = LODGING, markdownFr, markdownEn, htmlFr, htmlEn, variables, contentHash, publishedAt, publishedBy }) => {
    const version = maxVersionStmt().get(activity).v + 1;
    insertVersionStmt().run({
      activity,
      version,
      markdownFr,
      markdownEn,
      htmlFr,
      htmlEn,
      variablesJson: JSON.stringify(variables || {}),
      contentHash,
      publishedAt,
      publishedBy: publishedBy || null,
    });
    return byVersionStmt().get(activity, version);
  }));

  return {
    LODGING,
    getDraft(activity = LODGING) {
      return getDraftStmt().get(activity) || { markdownFr: '', markdownEn: '', updatedAt: null };
    },
    /** Whether the activity's draft was ever written (a seed, or the operator's save): an emptied draft is not seeded again. */
    hasDraft(activity = LODGING) {
      return Boolean(getDraftStmt().get(activity));
    },
    saveDraft({ fr, en, activity = LODGING }, now = new Date().toISOString()) {
      saveDraftStmt().run({ activity, fr: String(fr || ''), en: String(en || ''), now });
      return this.getDraft(activity);
    },
    getCurrent(activity = LODGING) {
      return currentStmt().get(activity) || null;
    },
    getByVersion(version, activity = LODGING) {
      return byVersionStmt().get(activity, Number(version)) || null;
    },
    getById(id) {
      return byIdStmt().get(Number(id)) || null;
    },
    /** Next number allocated inside the transaction, per activity, so two publications can never share one. */
    publishVersion(input) {
      return publishTx()(input);
    },
    listVersionsWithCounts(activity = LODGING) {
      return listStmt().all(activity);
    },
    /**
     * Records the acceptance AND, for a reservation, its « Historique » entry (rule 20). Runs inside the
     * booking transaction of publicBookingRequestController, so both land with the devis or not at all.
     * A subject that is not a reservation hands its own history to the owning plugin: `onAccepted(row)`
     * is called once the row is stored (specs/gift-vouchers/gift-voucher-campaigns.md rule 37).
     */
    insertAcceptance(row) {
      const activity = row.activity || LODGING;
      const subjectType = row.subjectType || 'reservation';
      const reservationId = row.reservationId == null ? null : Number(row.reservationId);
      if (subjectType === 'reservation' && reservationId == null) throw new Error('TERMS_ACCEPTANCE_NEEDS_RESERVATION');
      const subjectRef = row.subjectRef != null ? String(row.subjectRef) : (subjectType === 'reservation' ? String(reservationId) : null);
      if (reservationId != null) {
        insertHistoryStmt().run(reservationId, JSON.stringify([{
          field: 'termsVersion',
          label: row.historyLabel || 'Conditions générales',
          from: null,
          to: `Version ${row.version} acceptée`,
        }]));
      }
      const info = insertAcceptanceStmt().run({
        reservationId,
        termsVersionId: row.termsVersionId,
        acceptedAt: row.acceptedAt,
        ip: row.ip || null,
        userAgent: row.userAgent || null,
        pluginVersion: row.pluginVersion || null,
        activity,
        subjectType,
        subjectRef,
        channel: row.channel || 'site',
      });
      const stored = {
        id: Number(info.lastInsertRowid), activity, subjectType, subjectRef, reservationId, termsVersionId: row.termsVersionId, version: row.version, acceptedAt: row.acceptedAt, channel: row.channel || 'site',
      };
      if (typeof row.onAccepted === 'function') row.onAccepted(stored);
      return stored;
    },
    // A website request is a devis; converting it inserts a new reservation row, and the acceptance
    // stays on the devis (append-only, rule 19). The stay therefore reads its devis's acceptance
    // (rule 29).
    findAcceptanceByReservation(reservationId, activity = LODGING) {
      return acceptanceByReservationStmt().get({ id: Number(reservationId), activity }) || null;
    },
    findAcceptanceBySubject({ activity, subjectType, subjectRef }) {
      return acceptanceBySubjectStmt().get({ activity, subjectType, subjectRef: String(subjectRef) }) || null;
    },
    /** The latest acceptance of each non-lodging activity recorded on a reservation, for the fiche. */
    listOtherAcceptancesByReservation(reservationId) {
      return otherAcceptancesStmt().all(Number(reservationId));
    },
  };
}

const defaultModel = createTermsModel(db);
defaultModel.create = createTermsModel;

module.exports = defaultModel;
