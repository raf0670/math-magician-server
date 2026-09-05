const express = require('express');
const router = express.Router();
const {
    getPaymentQuote,
    getMathEnrollmentContext,
    submitManualEnrollment,
    submitSeatBooking,
    getMyBooking,
    submitBookedCheckout,
    handlePaystationCallback,
    getPaymentAccess,
    getAdminPreBookings,
    getAdminEnrollmentReviews,
    updateEnrollmentReviewStatus,
    markEnrollmentFullyPaid
} = require('../controllers/paymentController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.post('/quote', protect, getPaymentQuote);
router.get('/math-context', protect, getMathEnrollmentContext);
router.get('/my-access', protect, getPaymentAccess);
router.get('/my-booking', protect, getMyBooking);
router.post('/manual-enrollment', protect, submitManualEnrollment);
router.post('/book-seat', protect, submitSeatBooking);
router.post('/booked-checkout', protect, submitBookedCheckout);
router.get('/paystation/callback', handlePaystationCallback);
router.post('/paystation/callback', handlePaystationCallback);
router.get('/admin/pre-bookings', protect, authorizeAdmin, getAdminPreBookings);
router.get('/admin/enrollments', protect, authorizeAdmin, getAdminEnrollmentReviews);
router.patch('/admin/enrollments/:paymentId/status', protect, authorizeAdmin, updateEnrollmentReviewStatus);
router.patch('/admin/enrollments/:paymentId/final-payment', protect, authorizeAdmin, markEnrollmentFullyPaid);

module.exports = router;
