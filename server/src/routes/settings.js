const router = require('express').Router();

const settingsController = require('../controllers/settingsController');
const logoUpload = require('../middleware/multerLogoUpload');

router.get('/', settingsController.getSettings);

// specs/settings-rationalization.md rule 25 — the one-line state of each page, for the summary.
const summary = require('../controllers/settingsSummaryController').createSettingsSummaryController({
  db: require('../database'),
  settings: () => require('../models/settingsModel').read(),
  platformAvailable: () => require('../utils/platformMail').available(),
  plugins: () => require('../controllers/pluginsController').views(),
  appVersion: () => require('../utils/appVersion').getAppVersion(),
  twoFactorEnabled: (userId) => require('../models/twoFactorModel').default.isEnabled(userId),
  today: () => require('../utils/localDate').localIsoDate(),
  pluginsManageable: () => !require('../utils/pluginGovernance').isOperatorManaged(),
});
router.get('/summary', summary.get);
// Async since the sending server can be looked up (specs/settings-rationalization.md rule 28).
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.put('/', handle(settingsController.updateSettings));

router.post('/logo', (req, res) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload logo.' });
    return settingsController.uploadLogo(req, res);
  });
});

router.delete('/logo', settingsController.deleteLogo);

router.post('/smtp-test', settingsController.sendSmtpTest);
router.post('/smtp-detect', handle(settingsController.detectSmtp));

module.exports = router;
