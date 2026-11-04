- **Master v3.21.0 merged into `inte/plugins`** (2026-11-04): the tourist tax of guests added on a reversing
  platform (spec `platform-added-guests-tourist-tax.md`, migration in the v3.21.0 section). The accounting side
  lives in the `accounting-export` plugin (1.0.24), and a paid solde keeps the tax it collected.
- plugin:accounting-export The tourist tax of guests added on a reversing platform is booked with the complement; the solde keeps what the platform reversed.
