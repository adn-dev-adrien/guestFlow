/**
 * The SDK's own version (specs/plugins-phase-4-registry.md rule 3). A plugin manifest names the SDK
 * range it was built against (`sdk`), and the core refuses to load a package whose range this does
 * not satisfy (rule 12).
 *
 * Semver: removing or changing an entry point of `ctx`, of `guestflow/sdk` or of the client SDK is a
 * MAJOR bump; adding one is a MINOR bump; a fix that changes no entry point is a PATCH.
 */

const SDK_VERSION = '1.0.0';

module.exports = { SDK_VERSION };
