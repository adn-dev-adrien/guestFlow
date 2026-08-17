- **Devis PDF — taxe de séjour et TOTAL faux alors que la page devis était juste** (spec
  `devis-pdf-total-parity.md`, 2026-08-17). Le PDF dessinait ses lignes depuis le devis enregistré
  mais recalculait sa taxe de séjour et son TOTAL avec un devis moteur reconstruit à la volée, qui
  ne rejouait pas l'état vendu : options offertes refacturées (et déduction « comprise dans le
  tarif » perdue sur l'assiette de la taxe de séjour), verrou de prix ignoré, auto-options et
  routage Complément absents. Résultat sur le devis signalé : sous-totaux corrects (476,29 HT /
  523,92 TTC) mais taxe à 11,08 € au lieu de 9,60 € et un « TOTAL TTC 595,00 € » qui ne
  correspondait à aucune ligne du document. Le recalcul passe désormais par `devisModel.recomputeQuote`,
  la relecture unique de l'état vendu (mêmes entrées que la fiche), et le TOTAL imprimé est par
  construction la somme des lignes imprimées + la taxe imprimée. Correction rétroactive : le
  prochain export d'un devis déjà émis sort les bons montants, sans ré-enregistrement.
