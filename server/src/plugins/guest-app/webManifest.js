/**
 * The guest app's install manifest (specs/guest-app.md rule 52), served by `GET /public/v1/guest/manifest.webmanifest`:
 * the app name is the studio's setting, the colours the §6.1 tokens (theme fir-green, paper ground). The icons are
 * the guest app's own files under `/icons/` on the guest host.
 */

const THEME = '#2E3B2A';
const BACKGROUND = '#F5F0E6';

function webManifest({ appName }) {
  const name = String(appName || '').trim() || 'Mon séjour';
  return {
    id: '/',
    name,
    short_name: name.length > 12 ? 'Mon séjour' : name,
    description: 'Le livret, le portail, Soliomap et la boutique de votre séjour.',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: THEME,
    background_color: BACKGROUND,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

module.exports = { BACKGROUND, THEME, webManifest };
