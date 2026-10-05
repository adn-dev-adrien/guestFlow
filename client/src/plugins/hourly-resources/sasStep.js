// The « Planifier » step of the arrival SAS, as the plugin hands it to the dialog
// (specs/plugins-phase-3c-hourly-resources.md rules 6, 12). Its data is the server's
// `pluginData['hourly-resources']`; its value is what the operator placed on the picker and what the
// server says the evening owes for it.
import { seedResourceBlocks } from './scheduling';

const resourcesOf = (data) => (Array.isArray(data && data.resources) ? data.resources : []);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** The blocks already placed, and the supplement the server computed for them. */
export function initialValue(data) {
  return {
    blocks: seedResourceBlocks(data),
    supplements: Object.fromEntries(resourcesOf(data).map((r) => [r.resourceId, Number(r.supplement || 0)])),
  };
}

/** What the commit sends under `pluginSteps.resourceScheduling` (server rule 6). */
export function payloadOf(value, data) {
  return {
    blocks: (value?.blocks || []).map((b) => ({ resourceId: b.resourceId, date: b.date, start: b.start, end: b.end })),
    resourceIds: resourcesOf(data).map((r) => r.resourceId),
  };
}

/** The evening supplements, as the server prices them, for the recap and its total. */
export function recapLines(value, data) {
  return resourcesOf(data)
    .map((r) => ({ label: r.supplementLabel, amount: round2(value?.supplements?.[r.resourceId]) }))
    .filter((line) => line.amount > 0);
}

/** The hours sold but on no slot: the step can be skipped, so the recap is what keeps them in view. */
export function recapNotes(value, data) {
  return resourcesOf(data).map((r) => {
    const placedMinutes = (value?.blocks || [])
      .filter((b) => Number(b.resourceId) === Number(r.resourceId))
      .reduce((sum, b) => sum + Number(b.durationMinutes || 0), 0);
    const hours = Math.max(0, round2(r.hoursSold - placedMinutes / 60));
    return hours > 0 ? `${r.name} : ${String(hours).replace('.', ',')} h non planifiée${hours > 1 ? 's' : ''}.` : null;
  }).filter(Boolean);
}
