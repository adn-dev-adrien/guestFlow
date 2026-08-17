- Sécurité : les réglages qui finissent tels quels dans un en-tête d'email — *Nom expéditeur*,
  *Adresse expéditeur* et le destinataire des notifications — refusent désormais les caractères de
  contrôle. Un retour à la ligne glissé dans le nom expéditeur fermait la ligne `From:` et laissait
  interpréter la suite comme un nouvel en-tête (`Bcc:`, `Content-Type:`…). L'enregistrement renvoie
  maintenant une erreur sous le champ concerné (*« Caractère interdit (retour à la ligne ou
  caractère de contrôle). »*) au lieu de stocker la valeur. Les espaces et retours à la ligne en
  bordure restent tolérés et sont nettoyés à l'écriture, pour qu'une adresse copiée-collée depuis
  une messagerie passe sans friction ; les accents et tirets cadratins ne sont pas concernés
  (`Gîte Solio — été` reste un nom valide).
