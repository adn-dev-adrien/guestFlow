/**
 * The userscript the operator installs in their own browser (specs/booking-extranet-intake.md rules 2–6).
 * A dumb carrier: it reads the page the operator opened on the Booking extranet and posts its text to
 * this GuestFlow, which parses it. It parses nothing, so a change of wording at Booking is fixed by a
 * GuestFlow release and never by re-installing the script.
 */

const MATCH = 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html*';

function buildUserscript({ publicUrl, secret }) {
  const base = String(publicUrl).replace(/\/+$/, '');
  const host = new URL(base).hostname;
  return `// ==UserScript==
// @name         GuestFlow – réservation Booking
// @namespace    ${base}
// @version      3
// @description  Envoie la réservation Booking ouverte à GuestFlow, qui remplit la fiche.
// @match        ${MATCH}
// @grant        GM_xmlhttpRequest
// @connect      ${host}
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  var ENDPOINT = ${JSON.stringify(`${base}/public/booking-intake/page`)};
  var KEY = ${JSON.stringify(secret)};
  var params = new URLSearchParams(location.search);
  var hotelId = params.get('hotel_id');
  var resId = params.get('res_id');
  if (!hotelId || !resId) return;

  function toast(message, isError) {
    var el = document.createElement('div');
    el.textContent = message;
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:12px 16px;'
      + 'border-radius:10px;font:14px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;'
      + 'background:' + (isError ? '#b3261e' : '#2e5339');
    el.onclick = function () { el.remove(); };
    document.body.appendChild(el);
    if (!isError) setTimeout(function () { el.remove(); }, 8000);
  }

  function wait(test, timeoutMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      (function poll() {
        var value = test();
        if (value || Date.now() - started > timeoutMs) return resolve(value);
        setTimeout(poll, 250);
      })();
    });
  }

  // Booking renders the price table after the reservation number: send only once the page stops changing.
  function settled(quietMs, timeoutMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      var last = document.body.innerText;
      var since = Date.now();
      (function poll() {
        var now = document.body.innerText;
        if (now !== last) { last = now; since = Date.now(); }
        if (Date.now() - since >= quietMs || Date.now() - started > timeoutMs) return resolve();
        setTimeout(poll, 250);
      })();
    });
  }

  function hash(text) {
    var h = 0;
    for (var i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
    return String(h);
  }

  function send(text, guard, fingerprint) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: ENDPOINT,
      headers: { 'Content-Type': 'application/json', 'X-Booking-Intake-Key': KEY },
      data: JSON.stringify({ v: 1, hotelId: hotelId, resId: resId, text: text }),
      timeout: 20000,
      onload: function (res) {
        var body = {};
        try { body = JSON.parse(res.responseText); } catch (e) { /* not JSON */ }
        if (res.status === 401) return toast('GuestFlow : script obsolète, le réinstaller depuis GuestFlow', true);
        if (res.status === 404) return toast('GuestFlow : module inactif', true);
        if (res.status === 429) return toast('GuestFlow : trop de demandes, réessayer dans une minute', true);
        var failed = body.status === 'refused' || res.status >= 400;
        // Only an answered page is remembered: a refusal (fiche not imported yet) must be retried on reload.
        if (!failed) { try { sessionStorage.setItem(guard, fingerprint); } catch (e) { /* storage blocked */ } }
        toast(body.message || 'GuestFlow : réponse inattendue (' + res.status + ')', failed);
      },
      onerror: function () { toast('GuestFlow injoignable', true); },
      ontimeout: function () { toast('GuestFlow injoignable', true); },
    });
  }

  wait(function () { return /Numéro de réservation/.test(document.body.innerText); }, 30000).then(function (ready) {
    if (!ready) return null;
    var reveal = Array.prototype.find.call(document.querySelectorAll('button,a'), function (e) {
      return /Afficher le numéro de téléphone/i.test(e.innerText);
    });
    if (!reveal) return null;
    reveal.click();
    return wait(function () { return !/Afficher le numéro de téléphone/i.test(document.body.innerText); }, 2000);
  }).then(function () {
    // Each room's details, its price table included, sit in a collapsed accordion: open them all.
    var rows = document.querySelectorAll('button.bui-accordion__row-inner[aria-expanded="false"]');
    Array.prototype.forEach.call(rows, function (row) { row.click(); });
    return settled(1500, 15000);
  }).then(function () {
    var text = document.body.innerText;
    if (!/Numéro de réservation/.test(text)) return;
    var guard = 'guestflow:' + resId;
    var fingerprint = hash(text);
    try {
      if (sessionStorage.getItem(guard) === fingerprint) return;
    } catch (e) { /* storage blocked: send anyway */ }
    send(text, guard, fingerprint);
  });
})();
`;
}

module.exports = { buildUserscript, MATCH };
