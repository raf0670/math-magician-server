const express = require('express');
const router = express.Router();
const {
    createLiveClass,
    getAdminLiveClasses,
    getCurrentLiveClass,
    updateLiveClass
} = require('../controllers/liveClassController');
const { protect, authorizeAdmin, authorizeAnyPaidCourseAccess, authorizeProgramAccess } = require('../middleware/auth');

function authorizeCatalogAccess(req, res, next) {
    const kind = req.query.kind || 'recordings';
    return kind === 'resources'
        ? authorizeAnyPaidCourseAccess(req, res, next)
        : authorizeProgramAccess(req, res, next);
}

router.get('/catalog', protect, authorizeCatalogAccess, (req, res) => {
    const catalog = require('../config/contentCatalog');
    const kind = req.query.kind || 'recordings';
    if (!['recordings', 'resources'].includes(kind)) return res.status(400).json({ success: false, message: 'Invalid catalog.' });
    const data = kind === 'resources'
        ? catalog.resources
        : req.program === 'math'
            ? catalog.mathRecordings
            : catalog.recordings;
    res.set('Cache-Control', 'private, no-store').json({ success: true, data });
});
router.get('/current', protect, authorizeProgramAccess, getCurrentLiveClass);
router.get('/admin', protect, authorizeAdmin, getAdminLiveClasses);
router.post('/admin', protect, authorizeAdmin, createLiveClass);
router.patch('/admin/:id', protect, authorizeAdmin, updateLiveClass);

module.exports = router;
