// Calendar notes controller — thin handlers over calendarNotesModel.

const model = require('../models/calendarNotesModel');

function list(req, res) {
  res.json(model.listForProperty(req.params.propertyId, { from: req.query.from, to: req.query.to }));
}

function upsert(req, res) {
  res.json(model.upsert(req.params.propertyId, req.params.date, req.body.note));
}

function remove(req, res) {
  res.json(model.remove(req.params.propertyId, req.params.date));
}

module.exports = { list, upsert, remove };
