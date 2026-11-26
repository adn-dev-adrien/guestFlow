/**
 * Grouping of the « Pratique » markers by screen distance (specs/guest-app/guest-app-local-amenities.md rule 3). Pure: points in
 * pixels come in, groups come out; Leaflet only supplies the projection.
 */

export const GROUP_PX = 28;

/**
 * `points`: `[{ id, x, y }]` in screen pixels, in the order to keep. A point joins the first group whose first member is
 * closer than `radius`; otherwise it opens its own. → `[{ ids, x, y }]`, the centre being the members' mean.
 */
export function clusterPoints(points, radius = GROUP_PX) {
  const groups = [];
  points.forEach((point) => {
    const near = groups.find((g) => Math.hypot(g.anchor.x - point.x, g.anchor.y - point.y) < radius);
    if (near) near.members.push(point);
    else groups.push({ anchor: point, members: [point] });
  });
  return groups.map(({ members }) => ({
    ids: members.map((m) => m.id),
    x: members.reduce((sum, m) => sum + m.x, 0) / members.length,
    y: members.reduce((sum, m) => sum + m.y, 0) / members.length,
  }));
}

/**
 * At the maximum zoom, grouped markers do not merge: they fan out on a circle around the group's centre (rule 3).
 * → one `{ id, x, y }` per member; a lone point stays where it is.
 */
export function fanOut(group, step = 38) {
  if (group.ids.length === 1) return [{ id: group.ids[0], x: group.x, y: group.y }];
  const radius = Math.max(step * 0.75, (step * group.ids.length) / (2 * Math.PI));
  return group.ids.map((id, index) => {
    const angle = (2 * Math.PI * index) / group.ids.length - Math.PI / 2;
    return { id, x: group.x + radius * Math.cos(angle), y: group.y + radius * Math.sin(angle) };
  });
}
