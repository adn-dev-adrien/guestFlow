---
name: gift-voucher-campaign
description: Draft a GuestFlow gift voucher campaign as a recipe (campaign.json + images in a .zip) from an operator's request — a nordic bath in the day or the evening, its included time, drinks, the add-ons a giver may choose, validity, visuals. Use when the operator asks to create, duplicate or adjust a gift voucher campaign, or to prepare the vouchers to sell on the site and through merchant cards.
---

# Drafting a gift voucher campaign

A campaign is **data**. You write a recipe; GuestFlow judges it on import. Read
`docs/gift-voucher-campaign-recipe.md` for the format. For any doubt about behaviour, read
`specs/gift-voucher-campaigns.md` (rules 2–10 for campaigns, 43–45 for prices).

## Steps

1. **Read the catalogue. Never guess it.** List the hourly resources and options and their exact
   names: `GET /api/gift-vouchers/catalogue` with the operator's session. Without access, ask the
   operator for the names. Use only elements the catalogue marks `sellable: true`. For each one
   marked `false`, give the operator the reason the server gives.
2. **Choose the band from the resource's own hours.** The `day` and `evening` hours come from the
   catalogue's tariff modes. Never write an hour, a rate or a price into the recipe.
3. **Choose the minutes:** at least the minimum, a multiple of the slot, inside the band. The
   catalogue gives all three.
4. **Write `campaign.json`.**
   - Use names exactly as in the catalogue.
   - Give a short operator `name` and a warm public `title`, in French, never salesy
     (`guest-email-tone`).
   - Use a lowercase `slug`.
   - Take the validity from the operator. If none is given, propose 12 months and say it is a
     proposal.
5. **Visuals (optional):** A6 portrait, at least 1240 × 1748 px, JPEG or PNG. When you produce
   one, check its size before zipping. Without a visual the campaign stays a draft: it cannot go on
   sale.
6. **Zip and hand over.** Zip `campaign.json` and `images/…`, then tell the operator to import it
   from Bons cadeaux → Campagnes → « Importer une recette ». The import lands as a draft. Before
   going on sale, the operator checks the price the server shows in the editor.

## Never

- Write a price, a total, a VAT rate or an hour in the recipe.
- Put a campaign on sale yourself, or publish the bath's terms: both are the operator's decisions.
- Invent an option that is not in the catalogue. Ask instead.
