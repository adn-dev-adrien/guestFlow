// specs/plugins/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-18, loop t22 A22-1) and specs/tech/server-test-isolation.md rule 23 (reading of
// 2026-11-18, loop t23 UI23-1) — before EVERY test, the code of the four SDK sale blocks (`components/LazySaleComponents.jsx`) is
// forgotten and its next import arrives SALE_CHUNK_DELAY ms late (default 25), as a chunk fetched over the network does. The dialogs
// that render them wait for that code (`useSaleComponentsReady`) and keep their actions disabled meanwhile, so a test that acts before
// its dialog is ready fails every time, wherever it sits in its file. `LazySaleComponents` keeps a block's loaded code for the rest of the
// file, so a delay put on the modules alone reached only the first test of each file (`ResourceArrivalDialog.paid-before` A2 passed in
// file order and failed alone). The delay uses the real timer captured at load, so a test on fake timers is not blocked.
import { beforeEach } from 'vitest';

const realSetTimeout = globalThis.setTimeout;
const late = () => new Promise((resolve) => { realSetTimeout(resolve, Number(process.env.SALE_CHUNK_DELAY ?? 25)); });

beforeEach(async () => {
  const sale = await import('./components/LazySaleComponents');
  // A suite that replaces the module with a factory of its own has no seam: Vitest throws on reading a missing export of such a mock.
  let reset;
  try { reset = sale.resetSaleComponentsForTests; } catch { reset = undefined; }
  if (typeof reset === 'function') reset(late);
});
