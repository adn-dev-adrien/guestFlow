const router = require('express').Router();

const settingsController = require('../controllers/settingsController');
const logoUpload = require('../middleware/multerLogoUpload');

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);

// Priced linen items (Blanchisserie) — specs/arrival-departure-sas.md §3.4.
router.get('/linen-items', settingsController.getLinenItems);
router.put('/linen-items', settingsController.updateLinenItems);

// Repair amounts (« Tarifs facturables ») — specs/extinguisher-seal-and-repair-amounts.md.
router.get('/repair-amounts', settingsController.getRepairAmounts);
router.put('/repair-amounts', settingsController.updateRepairAmounts);

router.post('/logo', (req, res) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload logo.' });
    return settingsController.uploadLogo(req, res);
  });
});

router.delete('/logo', settingsController.deleteLogo);

router.post('/smtp-test', settingsController.sendSmtpTest);

module.exports = router;
