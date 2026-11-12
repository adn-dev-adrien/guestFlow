/**
 * EventPublisher — the port the sale services publish their domain events through (specs/pricing-components.md §3 rules 48, 55).
 *
 *   publish(name, payload)   hands the event to the plugin event bus (`plugins/sdk/eventBus.js`); returns at once, handlers run on a
 *                            later turn, each isolated. An unknown name is a programming error and throws, a failing handler never reaches the caller.
 */
const publish = (name, payload) => require('../../plugins/sdk/eventBus').emit(name, payload);

module.exports = { publish };
