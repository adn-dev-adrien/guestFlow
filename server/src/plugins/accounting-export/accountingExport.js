/**
 * The journal writers of the accounting export (specs/pricing-components.md §3 rule 63). The CSV journal, the sales JSON and
 * the synthesis are exporters of the core's `AccountingOutput` (`utils/accounting/exporters/`); this file binds them to the
 * plugin's account plan and keeps the names the plugin and its tests have always read.
 */

const sdk = require('../sdk');
const accountPlan = require('./accountPlan');

const { bookedBucketSplit } = sdk.coreModule('legacyBucketSplit');
const csvJournal = sdk.coreModule('csvJournal').create({ accountPlan });
const salesJson = sdk.coreModule('salesJson').create({ accountPlan, csvJournal });

module.exports = {
  csvJournal,
  salesJson,
  CSV_HEADERS: csvJournal.CSV_HEADERS,
  entryToRows: csvJournal.entryToRows,
  entryVentilation: csvJournal.entryVentilation,
  buildRows: csvJournal.buildRows,
  entryToStructured: salesJson.entryToStructured,
  buildStructuredEntries: salesJson.buildStructuredEntries,
  bookedBucketSplit,
  __test: { ...csvJournal.__test, ...salesJson.__test },
};
