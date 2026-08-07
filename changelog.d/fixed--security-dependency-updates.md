- Sécurité : montée des dépendances vulnérables — **8 failles « high » éliminées**. Serveur (`npm audit`
  passe de 6 à **0** vulnérabilité) : `sharp` 0.34 → 0.35 (CVE libvips 2026-33327/33328),
  `nodemailer` 8 → 9 (l'option `raw` contournait `disableFileAccess`/`disableUrlAccess`), `multer`
  2.1 → 2.2 (déni de service par champs profondément imbriqués), plus les transitives
  `brace-expansion` (DoS) et `ip-address`. Client : `react-router-dom` → 7.18.2, qui corrige la
  redirection ouverte via antislash dans `<Link>`/`useNavigate`, ainsi que `postcss` (traversée de
  chemin) et `form-data` (injection CRLF).
  **Restent connues et assumées, faute de correctif sans montée majeure :** l'avis CSRF de
  react-router ne concerne que le **mode RSC**, que GuestFlow n'utilise pas (SPA cliente pure), et il
  exigerait react-router 8 ; l'avis `esbuild` est en gravité *low*, limité au **serveur de dev sous
  Windows**, et son correctif viendra avec Vite 8.
