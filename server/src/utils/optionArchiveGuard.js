/**
 * Why an option cannot be archived, or '' when it can (specs/option-soft-delete.md rule 2,
 * specs/options-resources-ux.md rule 6). One function for `optionsModel.remove` and the catalogue
 * view, so the row's disabled « Archiver » and the server's refusal never disagree.
 */

const SYSTEM_OPTION_REASON = 'Option système';

function archiveBlockedReason(option) {
  if (!option) return '';
  if (option.autoOptionType || Number(option.isCancellationInsurance || 0) === 1) return SYSTEM_OPTION_REASON;
  return '';
}

module.exports = { archiveBlockedReason };
