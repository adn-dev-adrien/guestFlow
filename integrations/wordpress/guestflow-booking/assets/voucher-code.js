/**
 * The gift voucher code on the client (GuestFlow specs/gift-vouchers.md rules 30 and 34), build-free
 * plain ES. A line-for-line port of `server/src/plugins/gift-vouchers/code.js`: same alphabet, same
 * normalisation, same Damm check over GF(2^5). It only answers « does this look like a code someone
 * mistyped? » before a request is spent — GuestFlow re-verifies every code and decides.
 *
 * Exposed as `GFBooking.voucherCode` (and `module.exports` under Node, for the equivalence test):
 *   normalise(input)       upper case, I/L → 1, O → 0, every separator dropped
 *   format(normalised)     groups of four, « 7K2Q-HD9M-4TXB-3NPC » (a partial code stays partial)
 *   isWellFormed(norm)     16 characters of the alphabet, whatever their check
 *   hasValidCheck(norm)    well formed AND the check character agrees
 *   CODE_LENGTH, ALPHABET
 */
(function () {
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var CODE_LENGTH = 16;
  var GROUP = 4;
  var REDUCER = 37; // 0b100101

  function fold(state, index) {
    var shifted = (state ^ index) << 1;
    return shifted & 32 ? shifted ^ REDUCER : shifted;
  }

  function stateOf(chars) {
    var state = 0;
    for (var i = 0; i < chars.length; i++) state = fold(state, ALPHABET.indexOf(chars.charAt(i)));
    return state;
  }

  function normalise(input) {
    return String(input == null ? '' : input).toUpperCase().replace(/[\s\-_.·]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  }

  function isWellFormed(normalised) {
    if (normalised.length !== CODE_LENGTH) return false;
    for (var i = 0; i < normalised.length; i++) if (ALPHABET.indexOf(normalised.charAt(i)) === -1) return false;
    return true;
  }

  function hasValidCheck(normalised) {
    return isWellFormed(normalised) && stateOf(normalised) === 0;
  }

  function format(normalised) {
    var groups = String(normalised).match(new RegExp('.{1,' + GROUP + '}', 'g'));
    return groups ? groups.join('-') : '';
  }

  var api = {
    ALPHABET: ALPHABET, CODE_LENGTH: CODE_LENGTH,
    normalise: normalise, format: format, isWellFormed: isWellFormed, hasValidCheck: hasValidCheck,
  };

  if (typeof window !== 'undefined') (window.GFBooking || (window.GFBooking = {})).voucherCode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
