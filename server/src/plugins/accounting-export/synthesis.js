/**
 * The accounting synthesis engine (specs/accounting-synthesis.md) lives in the core as an exporter of `AccountingOutput`
 * (`utils/accounting/exporters/synthesis.js`); this file binds it to the plugin's account plan.
 */

const sdk = require('../sdk');
const accountPlan = require('./accountPlan');
const { csvJournal, salesJson } = require('./accountingExport');

module.exports = sdk.coreModule('synthesisExporter').create({ accountPlan, csvJournal, salesJson });
