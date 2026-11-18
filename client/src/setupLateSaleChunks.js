// specs/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-18, loop t22 A22-1) — in every test file, the code of the four SDK sale blocks
// (`components/LazySaleComponents.jsx`) arrives SALE_CHUNK_DELAY ms late (default 25), as a chunk fetched over the network does. The
// dialogs that render them wait for that code (`useSaleComponentsReady`) and keep their actions disabled meanwhile, so a test that acts
// before its dialog is ready fails here every time instead of once in a while on a busy runner (`ResourceArrivalDialog.invoiceable`
// clicked a still-disabled « Créer la facture »). The delay uses the real timer captured at load, so a test on fake timers is not blocked.
import { vi } from 'vitest';

const realSetTimeout = globalThis.setTimeout;
const late = () => new Promise((resolve) => { realSetTimeout(resolve, Number(process.env.SALE_CHUNK_DELAY ?? 25)); });

vi.mock('./components/StaySalesSection', async (importOriginal) => { await late(); return importOriginal(); });
vi.mock('./components/SuggestedArticlesStep', async (importOriginal) => { await late(); return importOriginal(); });
vi.mock('./components/SalePaymentLink', async (importOriginal) => { await late(); return importOriginal(); });
vi.mock('./components/StandaloneSaleDialog', async (importOriginal) => { await late(); return importOriginal(); });
