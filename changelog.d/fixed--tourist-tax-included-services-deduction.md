- **Taxe de séjour — l'assiette est la nuit sèche, nette des prestations comprises** (spec
  `tourist-tax-included-services-deduction.md`, 2026-08-22). Au Lodge, le ménage et le linge sont
  facturés *dans* la nuit : leur valeur de référence est de nouveau retirée du prix de l'hébergement
  avant la division par le nombre de nuits (18,00 € → 15,00 € sur un séjour de 3 nuits à 359,79 €).
  La déduction supprimée par la 2.2.0 revient sans ses deux défauts : c'est un **forfait par séjour**
  calculé sur les voyageurs inclus dans le tarif (2 au Lodge), donc il ne rétrécit plus quand le
  groupe grandit, et les lignes « Comprise » ne peuvent plus être décochées ni perdues à
  l'enregistrement — côté fiche comme côté serveur, pour les réservations et les devis. Le brut
  plateforme reste hors du calcul, les extras payants restent inertes, et les séjours passés restent
  gelés. Le récapitulatif réaffiche « Base : 359,79 € − 60,00 € de prestations comprises ».
  +14 tests serveur, +3 tests client.
