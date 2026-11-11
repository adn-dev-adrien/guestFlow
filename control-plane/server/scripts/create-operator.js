#!/usr/bin/env node
/**
 * Creates an operator of the console (specs/control-plane-plans-and-access.md rule 31) — there is
 * no sign-up page.
 *
 *   CP_OPERATOR_PASSWORD='…' npm run create-operator -- --email adrien@adn-dev.fr --name "Adrien"
 *
 * Without CP_OPERATOR_PASSWORD a password is generated and printed once. The second factor starts
 * as a code by email; the operator can switch to an authenticator app from their profile.
 */

const crypto = require('crypto');
const path = require('path');
const { openDatabase } = require('../src/database');
const { buildOperatorsModel } = require('../src/models/operatorsModel');
const { passwordHash } = require('../src/utils/gf');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email');
if (!email) {
  console.error('usage: npm run create-operator -- --email <email> [--name <name>]');
  process.exit(2);
}
const password = process.env.CP_OPERATOR_PASSWORD || crypto.randomBytes(12).toString('base64url');
if (password.length < 12) {
  console.error('CP_OPERATOR_PASSWORD must be at least 12 characters');
  process.exit(2);
}
const dataDir = path.resolve(process.env.CP_DATA_DIR || path.join(__dirname, '..', 'data'));
const operators = buildOperatorsModel(openDatabase(path.join(dataDir, 'control-plane.db')));
if (operators.byEmail(email)) {
  console.error(`operator ${email} already exists`);
  process.exit(1);
}
operators.create({ email, name: arg('name') || '', passwordHash: passwordHash.hashPassword(password) });
console.log(`Operator ${email} created.`);
if (!process.env.CP_OPERATOR_PASSWORD) console.log(`Password: ${password}`);
