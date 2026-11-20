/**
 * The visitor of a public request, as an HMAC of its address keyed by the plugin's pepper (specs/gift-vouchers.md rules 15, 19,
 * 33): kept to count orders and failed checks, never the address itself.
 */

const crypto = require('crypto');

const visitorHashOf = (pepper, ipKey) => crypto.createHmac('sha256', pepper).update(`visitor:${ipKey}`).digest('hex');

module.exports = { visitorHashOf };
