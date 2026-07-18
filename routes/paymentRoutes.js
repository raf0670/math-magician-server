const express = require('express');
const router = express.Router();
const {
    submitManualEnrollment,
    getPaymentAccess,
    getAdminEnrollmentReviews,
    updateEnrollmentReviewStatus
} = require('../controllers/paymentController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/my-access', protect, getPaymentAccess);
router.post('/manual-enrollment', protect, submitManualEnrollment);
router.get('/admin/enrollments', protect, authorizeAdmin, getAdminEnrollmentReviews);
router.patch('/admin/enrollments/:paymentId/status', protect, authorizeAdmin, updateEnrollmentReviewStatus);

module.exports = router;
