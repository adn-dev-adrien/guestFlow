/**
 * In-app links that leave a page through its unsaved-changes guard (`window.__guestflowBeforeNavigate`, installed by
 * a page with a draft such as the reservation fiche), the way the sidebar links do.
 *
 *   isPlainClick(event)               true for a left click without modifier: a cmd/ctrl/shift click keeps the
 *                                     browser's own handling (new tab, new window)
 *   navigateThroughGuard(navigate, to) asks the guard first; a guard that answers true keeps the page (it shows
 *                                     its prompt and navigates itself once the operator chooses to leave)
 *   logoutThroughGuard(logout)        « Se déconnecter » asks the same guard for `LOGIN_PATH`; refused, the page's
 *                                     prompt navigates there once the operator chooses to leave, and the signed-in
 *                                     `/login` route signs out instead of redirecting (`logoutAsked`, `takeAskedLogout`)
 */
export function isPlainClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function navigateThroughGuard(navigate, to) {
  const beforeNavigate = window.__guestflowBeforeNavigate;
  if (typeof beforeNavigate === 'function' && beforeNavigate(to)) return;
  navigate(to);
}

export const LOGIN_PATH = '/login';

let asked = false;

export function logoutThroughGuard(logout) {
  const beforeNavigate = window.__guestflowBeforeNavigate;
  asked = typeof beforeNavigate === 'function' && Boolean(beforeNavigate(LOGIN_PATH));
  if (!asked) logout();
}

export function logoutAsked() {
  return asked;
}

export function takeAskedLogout() {
  const was = asked;
  asked = false;
  return was;
}
