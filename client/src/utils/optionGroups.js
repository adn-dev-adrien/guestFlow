/**
 * Joins the option groups of `GET /properties/:id?view=stay` back to the property's options: the server
 * names each option of a group by id (specs/inte-performance.md rule 21), the components read whole
 * options. An id without a matching option is kept as it came.
 */
export function expandOptionGroups(optionGroups, options) {
  if (!optionGroups) return optionGroups;
  const byId = new Map((options || []).map((option) => [Number(option.id), option]));
  const join = (list) => (list || []).map((entry) => byId.get(Number(entry.id)) || entry);
  return {
    ...optionGroups,
    ungrouped: join(optionGroups.ungrouped),
    groups: (optionGroups.groups || []).map((group) => ({ ...group, options: join(group.options) })),
  };
}

export default expandOptionGroups;
