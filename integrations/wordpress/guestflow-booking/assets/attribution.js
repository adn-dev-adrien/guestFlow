/**
 * Where the visit came from (specs/site-traffic-analytics.md rule 13). Loaded on every public page,
 * because the page a visitor lands on is rarely the one they book from.
 *
 * The first page of the tab's session writes one record into sessionStorage and nothing overwrites
 * it: the external referrer HOST only (never the full URL, never the site itself or the Qonto
 * return), the utm_* parameters, the landing path and the time. It dies with the tab. The booking
 * block sends it with the request (`GF.attribution()`); the server validates and classifies it.
 */
(function () {
  try {
    var KEY = 'gf_attr';
    if (window.sessionStorage.getItem(KEY)) return;
    var here = window.location.hostname.replace(/^www\./, '').toLowerCase();
    var rec = { landingPath: window.location.pathname, firstSeenAt: new Date().toISOString() };
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ''; } catch (e) { ref = ''; }
    if (ref && ref.replace(/^www\./, '') !== here && !/(^|\.)qonto\.com$/.test(ref)) rec.referrer = ref;
    var params = new URLSearchParams(window.location.search);
    [['utm_source', 'utmSource'], ['utm_medium', 'utmMedium'], ['utm_campaign', 'utmCampaign'],
      ['utm_content', 'utmContent'], ['utm_term', 'utmTerm']].forEach(function (p) {
      var v = params.get(p[0]);
      if (v) rec[p[1]] = v.slice(0, 200);
    });
    window.sessionStorage.setItem(KEY, JSON.stringify(rec));
  } catch (e) {
    // Storage blocked or disabled: the request goes without a source (« Origine inconnue »).
  }
})();
