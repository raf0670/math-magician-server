const express = require('express');
const router = express.Router();
const {
    submitManualEnrollment,
    getPaymentAccess,
    getAdminEnrollmentReviews,
    updateEnrollmentReviewStatus,
    markEnrollmentFullyPaid
} = require('../controllers/paymentController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/my-access', protect, getPaymentAccess);
router.post('/manual-enrollment', protect, submitManualEnrollment);
router.get('/admin/enrollments', protect, authorizeAdmin, getAdminEnrollmentReviews);
router.patch('/admin/enrollments/:paymentId/status', protect, authorizeAdmin, updateEnrollmentReviewStatus);
router.patch('/admin/enrollments/:paymentId/final-payment', protect, authorizeAdmin, markEnrollmentFullyPaid);

module.exports = router;
