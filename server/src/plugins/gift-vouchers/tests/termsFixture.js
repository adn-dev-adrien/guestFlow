// The terms of a suite — the SDK's `ctx.terms` as a stub (specs/gift-voucher-campaigns.md rule 37). Not a test file.

/**
 * `published` maps an activity to its current version id. `accepted` collects what was recorded; the refusals are the core's: nothing owed when nothing is published,
 * `TERMS_NOT_ACCEPTED` with no version sent, `TERMS_OUTDATED` with another one.
 */
function termsStub(published = { lodging: 4 }) {
  const accepted = [];
  return {
    accepted,
    current: (activity) => (published[activity] ? { id: published[activity], version: 1 } : null),
    requireAccepted: ({ activity, versionId }) => {
      if (!published[activity]) return null;
      if (versionId === undefined || versionId === null || versionId === '') return 'TERMS_NOT_ACCEPTED';
      return Number(versionId) === published[activity] ? null : 'TERMS_OUTDATED';
    },
    accept: (input) => { accepted.push(input); },
  };
}

module.exports = { termsStub };
