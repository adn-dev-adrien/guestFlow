// The iCal tests stub `global.fetch`; the model takes its fetch by injection (specs/ical-import-hardening.md
// rule 17), so they hand it this shim, which reads the stub at call time.
module.exports = { globalFetch: (...args) => global.fetch(...args) };
