const express = require('express');
const router = express.Router();
const {
    submitManualEnrollment,
    submitSeatBooking,
    getMyBooking,
    submitBookedCheckout,
    getPaymentAccess,
    getAdminEnrollmentReviews,
    updateEnrollmentReviewStatus,
    markEnrollmentFullyPaid
} = require('../controllers/paymentController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/my-access', protect, getPaymentAccess);
router.get('/my-booking', protect, getMyBooking);
router.post('/manual-enrollment', protect, submitManualEnrollment);
router.post('/book-seat', protect, submitSeatBooking);
router.post('/booked-checkout', protect, submitBookedCheckout);
router.get('/admin/enrollments', protect, authorizeAdmin, getAdminEnrollmentReviews);
router.patch('/admin/enrollments/:paymentId/status', protect, authorizeAdmin, updateEnrollmentReviewStatus);
router.patch('/admin/enrollments/:paymentId/final-payment', protect, authorizeAdmin, markEnrollmentFullyPaid);

module.exports = router;
