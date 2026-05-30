const router = require('express').Router();

const settingsController = require('../controllers/settingsController');
const logoUpload = require('../middleware/multerLogoUpload');

router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);

router.post('/logo', (req, res) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload logo.' });
    return settingsController.uploadLogo(req, res);
  });
});

router.delete('/logo', settingsController.deleteLogo);

router.post('/smtp-test', settingsController.sendSmtpTest);

module.exports = router;
