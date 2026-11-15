// The public API key guard is the SDK's (SDK 2.31.0): every plugin that owns a /public/v1 tree shares it.
module.exports = require('../sdk').middleware.requirePublicApiKey;
