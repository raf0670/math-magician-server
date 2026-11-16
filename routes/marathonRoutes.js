const express = require('express');
const {
    getMarathonDashboard,
    getAdminMarathonLinks,
    updateAdminMarathonLink
} = require('../controllers/marathonController');
const { protect, authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, getMarathonDashboard);
router.get('/admin/links', protect, authorizeAdmin, getAdminMarathonLinks);
router.put('/admin/links/:section', protect, authorizeAdmin, updateAdminMarathonLink);

module.exports = router;
