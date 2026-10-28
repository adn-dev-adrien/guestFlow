/**
 * The browser « Retour » of a dirty page form (specs/options-resources-ux.md rule 29).
 *
 * The router listens to `popstate` too, and it listens first: by the time a component's own listener
 * would run, the router has already changed the page and unmounted the form. So ONE interceptor is
 * installed before the router mounts (client/src/index.jsx). While a form is dirty, `useDirtyFormGuard`
 * holds the `window.__guestflowBeforeBack` slot; on a pop the interceptor asks that handler. A handler
 * that answers `{ state, url }` blocks the navigation: the event is stopped before the router sees it,
 * the page's own history entry is put back (its state and URL, so « Retour » still knows an app page
 * is behind) and the handler has opened its « Modifications non enregistrées » dialog. An answer of
 * `null` lets the pop through.
 */

let installed = false;

export default function installBackGuard() {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', (event) => {
    const guard = window.__guestflowBeforeBack;
    if (typeof guard !== 'function') return;
    const keep = guard();
    if (!keep) return;
    event.stopImmediatePropagation();
    window.history.pushState(keep.state, '', keep.url);
  });
}
