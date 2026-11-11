// The real `src/index.js` with a throw-away database, for authenticated-input-shape.unit.test.js: three accounts,
// one client, one property, one stay and one devis. Nothing leaves the machine (see the parent's environment).
require('./setup/exitWithParent');
const routeCensus = require('./routeCensus');

routeCensus.install();
require('../index.js');

const users = require('../models/usersModel');
const db = require('../database');

const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PASSWORD = 'input-shape-password';
for (const [email, role] of [['admin@shape.test', 'admin'], ['reception@shape.test', 'reception'], ['accountant@shape.test', 'accountant']]) {
  users.createUser({ email, password: PASSWORD, firstName: 'Marie', lastName: 'Martin', roles: [role] });
}
db.prepare('UPDATE users SET mustChangePassword = 0').run();
const client = db.prepare("INSERT INTO clients (lastName, firstName, email, phone) VALUES ('Martin', 'Marie', 'marie@shape.test', '0600000000')").run().lastInsertRowid;
const property = db.prepare("INSERT INTO properties (name, maxGuests, singleBeds, doubleBeds) VALUES ('Ombre', 4, 2, 1)").run().lastInsertRowid;
const reservation = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, checkInTime, checkOutTime, platform, kind, reservationNumber)
  VALUES (?, ?, ?, ?, 2, '15:00', '10:00', 'direct', 'reservation', '999001')`).run(property, client, dayAt(30), dayAt(33)).lastInsertRowid;
const legacy = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, checkInTime, checkOutTime, platform, kind, reservationNumber)
  VALUES (?, ?, ?, ?, 2, '25:99', '10:00', 'direct', 'reservation', '999002')`).run(property, client, dayAt(40), dayAt(43)).lastInsertRowid;
const devis = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, checkInTime, checkOutTime, platform, kind, devisStatus, devisNumber)
  VALUES (?, ?, ?, ?, 2, '15:00', '10:00', 'direct', 'devis', 'draft', 'D-1')`).run(property, client, dayAt(50), dayAt(53)).lastInsertRowid;

process.send({
  ready: true, routes: routeCensus.writeRoutes(), pluginRoutes: routeCensus.pluginWriteRoutes(), password: PASSWORD, ids: { client: Number(client), property: Number(property), reservation: Number(reservation), legacy: Number(legacy), devis: Number(devis) },
  dates: { start: dayAt(30), end: dayAt(33), freeStart: dayAt(70), freeEnd: dayAt(73) },
});
