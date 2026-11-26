# Gift voucher campaign recipe

A recipe is a gift voucher campaign written as data. You can carry it from one GuestFlow to another,
read it and edit it by hand, or have an assistant write it. You export and import it from Bons
cadeaux → Campagnes. The source of truth is `specs/gift-vouchers/gift-voucher-campaigns.md`, rule 10.

## The archive

A recipe is a `.zip` file containing:

```
campaign.json
images/voucher.jpg     the voucher's front (optional)
images/merchant.jpg    the merchant card's front, when it differs (optional)
```

## `campaign.json`

```json
{
  "format": "gift-voucher-campaign",
  "version": 1,
  "campaign": {
    "name": "Bain nordique — soirée",
    "title": "Un bain nordique sous les étoiles",
    "kind": "resource",
    "slug": "bain-soiree",
    "validityMonths": 12,
    "composition": {
      "resource": "Bain nordique",
      "band": "evening",
      "minutes": 120,
      "options": [{ "option": "Champagne - demi-bouteille 37,5cl", "qty": 1 }]
    },
    "addOns": ["Blonde du Pilat 75cl - 4,5°", "Jus de pomme 25cl", "Champagne - bouteille 75cl"],
    "extraTimeMaxMinutes": 0,
    "images": {
      "voucher": { "name": "Bain sous les étoiles", "use": "both", "file": "images/voucher.jpg" }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `name` | Name of the campaign for the operator. |
| `title` | Public title, printed on the back of the voucher and shown on the site. |
| `kind` | Always `resource`. A lodging campaign (a free amount) has no recipe. |
| `slug` | The permanent link `/<base>/offrir/<slug>`: lowercase letters, digits and hyphens. |
| `validityMonths` | Months of validity, counted from the payment. |
| `composition.resource` | **The name** of an hourly resource in the catalogue. It must be shown on the planning card and sold outside a stay. |
| `composition.band` | `day` or `evening`. The hours come from the resource: from `openTime` to `hourlyEveningStart` for `day`, from `hourlyEveningStart` to `closeTime` for `evening`. |
| `composition.minutes` | The minutes the voucher includes. They must be at least the resource's minimum, a multiple of its slot, and fit inside the band. |
| `composition.options` | Options included in the voucher, by **name**, each with a quantity. |
| `addOns` | Options the giver and the recipient can add, by **name**. |
| `extraTimeMaxMinutes` | The bath time a buyer can add: `0` when none is offered, otherwise a multiple of the slot. |
| `images` | The `voucher` and/or `merchant` front. `use` is `voucher`, `merchant` or `both`. |

## Rules

- **No price, ever.** Prices, the hour-by-hour discount and the VAT are read from GuestFlow when a
  voucher is bought. A recipe that contains a price has nothing to write it to.
- **Names, not ids.** Each name must match exactly one catalogue entry, ignoring case. If none
  matches, the import is refused with « Article introuvable : … ». If several match, it is refused
  with « Article ambigu : … ».
- **All or nothing.** The import is judged by the same rules as the campaign form. Each refusal names
  its field, and nothing is written unless every field passes. An imported campaign arrives as a
  **draft**, and its images join the visual library.
- **Images:** JPEG or PNG, A6 portrait, at least 1240 × 1748 px (300 dpi). A smaller image, or one
  with the wrong proportions, is refused with its measured size.
