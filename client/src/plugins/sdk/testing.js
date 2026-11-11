/**
 * Test helper (specs/plugin-removal-resilience.md rules 4, 5): which plugins this tree ships, read from
 * the folders themselves, so a suite never assumes a plugin exists and never lists them by hand.
 *
 *   shippedPlugins()    → the sorted ids of the folders under `plugins/` holding a module
 *   lacksPlugins(ids)   → true when one of `ids` is not shipped; feeds `test.skipIf(...)` /
 *                         `describe.skipIf(...)` so a test about a collaboration says what it needs
 */

const FOLDERS = Object.keys(import.meta.glob('../*/index.{js,jsx}'))
  .map((file) => file.split('/'))
  .filter((parts) => parts.length === 3 && parts[1] !== 'sdk')
  .map((parts) => parts[1]);

export const shippedPlugins = () => [...FOLDERS].sort();

export const lacksPlugins = (ids) => ids.some((id) => !FOLDERS.includes(id));
