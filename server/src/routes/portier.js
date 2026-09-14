// `/api/portier/*` — the owner's list of gate accesses (specs/gate-access-portier.md §3.4-§3.5).
// An allowlist of Portier's owner routes, one line each; anything else answers the API's 404.
// Admin-only: enforceRoleAccess denies every other role by default.

const router = require('express').Router();
const multer = require('multer');
const controller = require('../controllers/portierController');

// The custom logo is read in memory and forwarded to Portier, which stores it and makes the icons.
// 2 MB is the contract's limit; the type is checked by the controller.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.get('/accesses', controller.list);
router.post('/accesses', controller.create);
router.get('/accesses/:id', controller.getOne);
router.patch('/accesses/:id', controller.update);
router.delete('/accesses/:id', controller.remove);
router.get('/accesses/:id/events', controller.events);
router.post('/accesses/:id/:action', controller.action);
router.get('/branding', controller.getBranding);
router.put('/branding/source', (req, res, next) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return controller.logoUploadRefused(err, res);
    return Promise.resolve(controller.setBrandingSource(req, res)).catch(next);
  });
});

module.exports = router;
