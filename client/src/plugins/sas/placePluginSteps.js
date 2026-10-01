/**
 * Where the steps of other plugins go in the SAS (specs/plugins-phase-2-hosts.md rule 10).
 *
 * `baseKeys` are the SAS's own pages, in order, ending with 'recap'; `steps` are the contributed
 * steps to show (`{ key, after? }`), in contribution order. A step lands right after the page its
 * `after` names — a SAS page or another contributed step — and, without `after` or when that page is
 * not part of this run, just before the recap, as in phase 1.
 */
export default function placePluginSteps(baseKeys, steps) {
  const out = [];
  const placed = new Set();
  const place = (step) => {
    placed.add(step.key);
    emit(step.key);
  };
  function emit(key) {
    out.push(key);
    steps.filter((s) => s.after === key && !placed.has(s.key)).forEach(place);
  }
  baseKeys.forEach((key) => {
    if (key === 'recap') steps.filter((s) => !placed.has(s.key)).forEach(place);
    emit(key);
  });
  return out;
}
