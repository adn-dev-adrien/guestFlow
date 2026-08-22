- **Taxe de séjour — un bébé est un occupant dans l'aperçu de la fiche aussi** (spec
  `tourist-tax-included-services-deduction.md` §3 règle 16, 2026-08-22). La taxe divise la nuit par
  les occupants, bébés compris. L'enregistrement l'a toujours fait, l'aperçu en direct de la fiche
  non : ni le formulaire ni `calculatePrice` ne transmettaient `babies`, si bien qu'un séjour avec un
  lit bébé affichait une taxe divisée par une tête de moins que celle qu'il enregistrait (16,38 € à
  l'écran, 13,05 € déclarés sur une résa du Lodge). Aperçu, enregistrement et déclaration disent
  maintenant le même montant.
