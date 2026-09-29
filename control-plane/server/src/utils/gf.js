/**
 * The GuestFlow modules the console shares with the instance, required from the same repository
 * (specs/control-plane-plans-and-access.md §4, Q6). Only pure Node modules are shared: the licence
 * format (so the console signs exactly what the instance verifies), the password hash and the
 * plugin catalogue.
 */

const path = require('path');

const GF_SERVER = path.resolve(__dirname, '..', '..', '..', '..', 'server');

module.exports = {
  GF_SERVER,
  licence: require(path.join(GF_SERVER, 'src', 'utils', 'licence')),
  passwordHash: require(path.join(GF_SERVER, 'src', 'utils', 'passwordHash')),
  plugins: require(path.join(GF_SERVER, 'src', 'constants', 'plugins')),
};
