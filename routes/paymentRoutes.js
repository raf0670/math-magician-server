const express = require('express');
const router = express.Router();
const { createBkashPayment, handleBkashCallback, getPaymentAccess, saveEnrollmentDetails } = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

router.post('/bkash/create', protect, createBkashPayment);
router.get('/bkash/callback', handleBkashCallback);
router.get('/my-access', protect, getPaymentAccess);
router.post('/enrollment-details', protect, saveEnrollmentDetails);

module.exports = router;
