#!/usr/bin/env node
/**
 * Creates the first administrator of a hosted instance — run by the control plane at onboarding
 * (specs/control-plane-plans-and-access.md rule 7), with `DB_PATH` pointing at that instance's
 * database:
 *
 *   DB_PATH=/srv/guestflow/<slug>/data/guestflow.db node scripts/create-first-admin.js --email a@b.fr --name "Claire Martin"
 *
 * Prints one JSON line on stdout, `{ "created": true, "temporaryPassword": "…" }`, which the control
 * plane emails to the customer. The password is never logged anywhere else.
 */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email');
if (!email || !process.env.DB_PATH) {
  console.error('usage: DB_PATH=… node scripts/create-first-admin.js --email <email> [--name <name>]');
  process.exit(2);
}

try {
  require('../src/database');
  const usersModel = require('../src/models/usersModel');
  const { generateTemporaryPassword } = require('../src/utils/passwordGenerator');
  const { createFirstAdmin } = require('../src/utils/firstAdmin');
  const result = createFirstAdmin({ usersModel, generatePassword: () => generateTemporaryPassword(), email, name: arg('name') });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
