/**
 * Web Worker of the booking drawer: solves the GuestFlow challenge off the page's thread while the
 * guest fills the form (specs/public-request-abuse-and-grouping.md rule 2). In: { salt, difficulty }.
 * Out: { nonce }.
 */
/* global importScripts, GFPow */
importScripts('pow.js');

self.onmessage = function (event) {
  var c = event.data || {};
  var nonce = null;
  for (var start = 0; nonce === null; start += 50000) nonce = GFPow.search(String(c.salt), Number(c.difficulty), start, 50000);
  self.postMessage({ nonce: nonce });
};
