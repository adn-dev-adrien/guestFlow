# Gift vouchers — the `gift-vouchers` plugin: free-amount and typed (bath) vouchers, sale, code, redemption, books

Start with: `gift-vouchers` (what a voucher is, code protection, redemption, VAT; campaigns amend it). See also: `plugins/`, `payments/`, `resources/`, `pricing/`, `site/`.

- `gift-vouchers` — an amount in euros sold online or by hand, issued only once paid (one-hour link), 16-character code, hold/redeem ledger, redemption as money received, VAT frozen at sale. Code: `server/src/plugins/gift-vouchers/issuance.js`, `server/src/plugins/gift-vouchers/redemption.js`, `client/src/plugins/gift-vouchers/`.
- `gift-voucher-campaigns` — campaigns (lodging amount or composed bath content), typed vouchers, offer switcher, priced extras fold, A6 PDF and mail, « Mon bain » use page, merchant cards, terms per activity. Code: `server/src/plugins/gift-vouchers/offerService.js`, `server/src/plugins/gift-vouchers/voucherPdf.js`, `server/src/plugins/gift-vouchers/extrasPricing.js`.
