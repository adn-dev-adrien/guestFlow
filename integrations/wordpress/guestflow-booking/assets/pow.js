/**
 * Proof of work for the booking request (GuestFlow specs/public-request-abuse-and-grouping.md rules
 * 1-2). Plain ES5, no library, no network: loaded by the page as a fallback and by pow-worker.js in a
 * Web Worker, where the guest never feels it.
 *
 * The challenge GuestFlow hands out names a `salt` and a `difficulty`; the answer is the first `nonce`
 * (base 36) such that SHA-256(salt + nonce) starts with `difficulty` zero bits. GuestFlow checks it
 * with one hash. The SHA-256 below is the standard one (FIPS 180-4) over an ASCII string — the salt is
 * hex and the nonce base 36, so one byte per character.
 */
(function (root) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var W = new Array(64);

  /** The eight 32-bit words of SHA-256(ascii), as signed ints. */
  function sha256Words(ascii) {
    var len = ascii.length;
    var blocks = ((len + 8) >> 6) + 1;
    var words = new Array(blocks * 16);
    var i;
    for (i = 0; i < words.length; i++) words[i] = 0;
    for (i = 0; i < len; i++) words[i >> 2] |= (ascii.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[words.length - 1] = len * 8;

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (var b = 0; b < words.length; b += 16) {
      for (i = 0; i < 16; i++) W[i] = words[b + i];
      for (i = 16; i < 64; i++) {
        var x = W[i - 15], y = W[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7];
  }

  function hex(ascii) {
    return sha256Words(ascii).map(function (w) { return ('00000000' + (w >>> 0).toString(16)).slice(-8); }).join('');
  }

  function leadingZeroBits(words) {
    var bits = 0;
    for (var i = 0; i < words.length; i++) {
      if (words[i] === 0) { bits += 32; continue; }
      return bits + Math.clz32(words[i]);
    }
    return bits;
  }

  /**
   * Tries `count` nonces from `start`. → the solving nonce (string), or null when none of them did.
   */
  function search(salt, difficulty, start, count) {
    for (var n = start; n < start + count; n++) {
      var nonce = n.toString(36);
      if (leadingZeroBits(sha256Words(salt + nonce)) >= difficulty) return nonce;
    }
    return null;
  }

  root.GFPow = { sha256Hex: hex, leadingZeroBits: leadingZeroBits, sha256Words: sha256Words, search: search };
})(typeof self !== 'undefined' ? self : this);
