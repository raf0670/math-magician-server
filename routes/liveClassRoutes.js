const express = require('express');
const router = express.Router();
const {
    createLiveClass,
    getAdminLiveClasses,
    getCurrentLiveClass,
    updateLiveClass
} = require('../controllers/liveClassController');
const { protect, authorizeAdmin, authorizeProgramAccess } = require('../middleware/auth');

router.get('/catalog', protect, authorizeProgramAccess, (req, res) => {
    const catalog = require('../config/contentCatalog');
    const kind = req.query.kind || 'recordings';
    if (!['recordings', 'resources'].includes(kind)) return res.status(400).json({ success: false, message: 'Invalid catalog.' });
    if (req.program === 'math' && kind !== 'recordings') return res.status(403).json({ success: false, message: 'Math resources are provided with your classes.' });
    res.set('Cache-Control', 'private, no-store').json({ success: true, data: req.program === 'math' ? catalog.mathRecordings : catalog[kind] });
});
router.get('/current', protect, authorizeProgramAccess, getCurrentLiveClass);
router.get('/admin', protect, authorizeAdmin, getAdminLiveClasses);
router.post('/admin', protect, authorizeAdmin, createLiveClass);
router.patch('/admin/:id', protect, authorizeAdmin, updateLiveClass);

module.exports = router;
