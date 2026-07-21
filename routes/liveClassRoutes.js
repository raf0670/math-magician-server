const express = require('express');
const router = express.Router();
const {
    createLiveClass,
    getAdminLiveClasses,
    getCurrentLiveClass,
    updateLiveClass
} = require('../controllers/liveClassController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/current', protect, getCurrentLiveClass);
router.get('/admin', protect, authorizeAdmin, getAdminLiveClasses);
router.post('/admin', protect, authorizeAdmin, createLiveClass);
router.patch('/admin/:id', protect, authorizeAdmin, updateLiveClass);

module.exports = router;
