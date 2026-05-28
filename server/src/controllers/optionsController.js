// Options controller — thin handlers over optionsModel.

const model = require('../models/optionsModel');

function list(req, res) {
  res.json(model.list());
}

function getOne(req, res) {
  const option = model.get(req.params.id);
  if (!option) return res.status(404).json({ error: 'Option non trouvée' });
  return res.json(option);
}

function create(req, res) {
  res.json(model.create(req.body));
}

function update(req, res) {
  res.json(model.update(req.params.id, req.body));
}

function remove(req, res) {
  res.json(model.remove(req.params.id));
}

module.exports = { list, getOne, create, update, remove };
