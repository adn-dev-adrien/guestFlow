// The day counter's share of the « Commande client » cards (specs/planning-day-task-count.md, specs/guest-app.md
// rule 43). Kept apart from `planningOrders.js` so the plugin's entry module imports nothing that reaches the API:
// the core reads every plugin's entry at boot (routes, roles), the cards' loader only when the planning asks.

/** Each card is a task, done once delivered. */
export function countOrderTasks(entries) {
  const list = entries || [];
  return { total: list.length, done: list.filter((e) => Boolean(e.item.delivered)).length };
}
