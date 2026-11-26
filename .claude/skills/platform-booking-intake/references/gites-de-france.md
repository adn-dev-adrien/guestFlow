# Gîtes de France (ITEA « Bureau Propriétaire »)

## Where things are (`prop.itea.fr`)

- Login: email + password (the « numéro propriétaire » login is disabled). The operator logs in.
- Owner 3118, centrale **Gîtes de France Ardèche**; La Granja = **gîte n°309700** (« Domaine
  Solio »). The GuestFlow iCal feed of this gîte comes from `reservation.itea.fr/iCal_…`.
- Home page « Prochains évènements » lists the next stays with name and headcount; each links to
  `/v5/liste_resas.php?goto=<year>_<dossier>_centrale_309700`.
- Reservation list: `/v5/liste_resas.php`, tabs « A venir », « Passées & soldées », « Annulées »…
  Each row carries a `title="<dossier>"` cell; clicking a row opens, inline, the client block,
  « Séjour » and « Informations contrat n°<dossier> ».
- Read the panel with `innerText` from the « Informations contrat n°<dossier> » heading up to the
  ancestor that contains « Prix total client ».

## What the panel gives

- Client: « Prénom NOM », street, postcode + town, country, phone, email. No preferred language —
  French address → `fr`.
- « Séjour »: « 8 adultes, 2 enfants, 2 bébés » — **no ages**. Children default to Enfants (2–12)
  unless the operator says otherwise (2026-10-15). Babies → Bébés. The list's « N pers. » excludes
  babies.
- Arrival/departure day + time (16:00 / 10:00), nights.
- Contract: « Prix location », « Options » (each with its price — « Forfait ménage (80 €) », « N X
  Location linge de toilette »), « Taxe de séjour », « Caution », « Montant net propriétaire »,
  « Déjà perçu (le <date>) », « Prix total client », « Frais de dossiers », sometimes « Assurance
  annulation ».
- Booking number in GuestFlow = the ITEA **dossier number** (e.g. 11773), not the centrale's year
  prefix.

## Money rule (measured 2026-10-15 on 8 soldés dossiers)

**Montant net propriétaire = Prix location + Options − round(10 % × Prix location).** The commission
is 10 % of the rent only (options are not commissioned), rounded to the euro. The tourist tax is
collected **and remitted** by the centrale: it is never in the payout. « Frais de dossiers » and
« Assurance annulation » are the guest's fees to the centrale — never ours, never in the brut.

| Dossier | Location | Options | Net | Location − net + options |
|---|---|---|---|---|
| 13164 | 840 | 120 | 876 | 84 |
| 3247 | 454 | 160 | 569 | 45 |
| 5442 | 653 | 80 | 668 | 65 |
| 1812 | 914 | 80 | 903 | 91 |
| 4318 | 1 791 | 80 | 1 692 | 179 |
| 3084 | 3 582 | 80 | 3 304 | 358 |

## Entry order in « Paiement plateforme » (specs/platforms/platform-host-statement-and-commission-vat.md rules 1, 2, 19, 22)

The block takes the host side of the « Relevé des réservations »: never the tourist tax, never the guest's
fees. The centrale collects **and remits** the tax: the box is informational (mode « plateforme »), it enters
nothing.

1. **Location (relevé)** = « Montant location » = Prix location.
2. **Options (relevé)** = « Options » = Total des options. The fiche's option lines follow it by themselves:
   a ménage left « offert » that the centrale billed becomes paid (the block says « Ménage passé en payant »).
3. **Taxe de séjour** = the contract's « Taxe de séjour » (informational).
4. **Virement reçu (contrôle)** = « Montant net propriétaire ».
5. **Calculer la commission** = Location + Options − virement.

Options: tick each ITEA option on the fiche (Ménage 80 €, Linge de toilette…) and **untick « Forcer
en complément »** — a platform fiche opens it ticked, which moves the option to « perçu sur place »
and inflates the total séjour. Expected summary: Prix hébergement = Prix location, Total du séjour =
Location + Options, Commission ≈ 10 % of the rent, Versement = net.

Worked example, dossier 13 « Dausque »: location 784 + options 80 = 864 / tax 36 (informational) / virement 786
→ commission 78,00 (65 € HT + 13 € de TVA, compte 62260500). Dossier 11773 (GuestFlow 22308): 504 + 80 = 584 /
19,20 / 534 → commission 50,00, ✓. Prix total client 632,40 included 29,20 of frais de dossier.

Baby beds: entering « Lits bébé » adds the paid « Lit bébé » option in complément (10 €, collected on
site) — kept on 22308 by the operator's choice.

## Known drift in past fiches (left as is, operator 2026-10-15)

Xray (9), Borealis (10), Quebec (1) hold « Prix total client » as brut, so their commission
includes frais de dossier (and Vallée's cancellation insurance). Do not repair them without asking.
