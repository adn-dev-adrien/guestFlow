- Public API: every endpoint under `/public/v1` accepts an optional `lang` (`fr` by default, `en`),
  in the query string and — for `POST /quote` and `POST /booking-requests` — in the body. Option
  titles, resource names, price-unit labels, portion wordings, offered-hour sentences and every
  error message come back in that language. An absent, unknown or malformed value reads as French
  and is never a validation error: a visitor must not lose a booking funnel over a language token.
- Public API: `resources.nameEn` is exposed, closing an asymmetry with `options.titleEn`.
