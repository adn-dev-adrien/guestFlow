/**
 * « Itinéraire » — one behaviour for every directions button of the app (specs/guest-app/guest-app-local-amenities.md rule 7).
 * Everywhere but Apple devices the Google Maps URL is a plain link: it opens the installed navigation app. On an iPhone or iPad
 * the Google Maps app is tried first, then Plans, then the Google Maps web page. A URL scheme gives no answer, so « did it open? »
 * is read from the page being hidden within `WAIT_MS` — never from a lost focus, which Safari's « adresse non valide » alert and its
 * « Ouvrir dans … ? » question also cause.
 */
export const WAIT_MS = 1500;

/** Plans exists on Apple devices only (iPadOS answers as a Mac, hence the touch check). */
export function isAppleDevice() {
  if (typeof navigator === 'undefined') return false;
  const platform = String(navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || '');
  const agent = String(navigator.userAgent || '');
  return /iPhone|iPad|iPod/.test(agent) || /^(iPhone|iPad|iPod)/.test(platform) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1);
}

const goTo = (url) => { window.location.href = url; };

/** Opens a URL scheme; → true when the page was left (an app took over), false after `WAIT_MS` without. */
function tryApp(url, navigate) {
  return new Promise((resolve) => {
    const finish = (opened) => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
      resolve(opened);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(true); };
    const onLeave = () => finish(true);
    const timer = setTimeout(() => finish(document.visibilityState === 'hidden'), WAIT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onLeave);
    navigate(url);
  });
}

/** The Apple chain: Google Maps app → Plans → Google Maps web. `links` is the server's `{ google, googleApp, appleApp }`. */
export async function openDirectionsOnApple(links, { navigate = goTo } = {}) {
  // A payload cached before the app schemes existed (the service worker keeps data across releases) has the web link only.
  if (!links.googleApp || !links.appleApp) { navigate(links.google); return; }
  if (await tryApp(links.googleApp, navigate)) return;
  if (await tryApp(links.appleApp, navigate)) return;
  navigate(links.google);
}
