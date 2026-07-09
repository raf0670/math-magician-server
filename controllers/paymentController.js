const Payment = require('../models/Payment');
const User = require('../models/User');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const { getPaymentPlan } = require('../config/paymentPlans');
const bkashService = require('../services/bkashService');

function getFrontendUrl(path) {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    return `${frontendUrl}${path}`;
}

function makeInvoiceNumber(userId) {
    const shortUser = userId.toString().slice(-6);
    return `MMS-${shortUser}-${Date.now()}`;
}

exports.createBkashPayment = async (req, res) => {
    try {
        const plan = getPaymentPlan(req.body.planId);
        if (!plan) {
            return res.status(400).json({ success: false, message: 'Invalid payment plan.' });
        }

        const merchantInvoiceNumber = makeInvoiceNumber(req.user._id);
        const payment = await Payment.create({
            user: req.user._id,
            planId: plan.id,
            planTitle: plan.title,
            amount: plan.amount,
            merchantInvoiceNumber
        });

        const createResponse = await bkashService.createPayment({
            amount: plan.amount,
            merchantInvoiceNumber,
            payerReference: req.user.email || req.user._id.toString()
        });

        payment.bkashPaymentId = createResponse.paymentID;
        payment.rawCreateResponse = createResponse;
        await payment.save();

        if (!createResponse.bkashURL) {
            return res.status(502).json({ success: false, message: 'bKash did not return a checkout URL.' });
        }

        res.status(201).json({
            success: true,
            data: {
                paymentId: payment._id,
                bkashURL: createResponse.bkashURL
            }
        });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.handleBkashCallback = async (req, res) => {
    const { paymentID, status } = req.query;

    try {
        if (!paymentID) {
            return res.redirect(getFrontendUrl('/payment/failed?reason=missing-payment-id'));
        }

        const payment = await Payment.findOne({ bkashPaymentId: paymentID });
        if (!payment) {
            return res.redirect(getFrontendUrl('/payment/failed?reason=payment-not-found'));
        }

        if (status === 'cancel' || status === 'failure') {
            payment.status = status === 'cancel' ? 'cancelled' : 'failed';
            payment.failureReason = status;
            await payment.save();
            return res.redirect(getFrontendUrl(`/payment/failed?status=${status}`));
        }

        const executeResponse = await bkashService.executePayment(paymentID);
        payment.rawExecuteResponse = executeResponse;

        const transactionStatus = executeResponse.transactionStatus || executeResponse.statusMessage;
        const isCompleted = transactionStatus === 'Completed' || executeResponse.statusCode === '0000';

        if (!isCompleted) {
            payment.status = 'failed';
            payment.failureReason = executeResponse.statusMessage || transactionStatus || 'Payment execution failed';
            await payment.save();
            return res.redirect(getFrontendUrl('/payment/failed?reason=execute-failed'));
        }

        payment.status = 'paid';
        payment.trxID = executeResponse.trxID;
        payment.paidAt = new Date();
        await payment.save();

        await User.findByIdAndUpdate(payment.user, { hasClassAccess: true });

        return res.redirect(getFrontendUrl(`/payment/success?paymentId=${payment._id}`));
    } catch (error) {
        return res.redirect(getFrontendUrl(`/payment/failed?reason=${encodeURIComponent(error.message)}`));
    }
};

exports.saveEnrollmentDetails = async (req, res) => {
    try {
        const { paymentId, formData } = req.body;

        if (!paymentId || !formData) {
            return res.status(400).json({ success: false, message: 'Payment ID and form details are required.' });
        }

        const payment = await Payment.findOne({
            _id: paymentId,
            user: req.user._id,
            status: 'paid'
        });

        if (!payment) {
            return res.status(403).json({ success: false, message: 'Enrollment details can only be saved after a verified payment.' });
        }

        const existing = await EnrollmentDetail.findOne({ payment: payment._id });
        if (existing) {
            return res.status(200).json({ success: true, data: existing, message: 'Enrollment details already saved.' });
        }

        const detail = await EnrollmentDetail.create({
            user: req.user._id,
            payment: payment._id,
            planId: payment.planId,
            planTitle: payment.planTitle,
            email: formData.email,
            yourName: formData.yourName,
            address: formData.address,
            phoneNumber: formData.phoneNumber,
            facebookProfile: formData.facebookProfile,
            emailAddress: formData.emailAddress,
            college: formData.college,
            group: formData.group,
            hscBatch: formData.hscBatch,
            backupChoice: formData.backupChoice,
            admissionSystemIdea: formData.admissionSystemIdea,
            previousIbaPreparation: formData.previousIbaPreparation || '',
            previousStudyDetails: formData.previousStudyDetails || '',
            strongestSection: formData.strongestSection || '',
            weakestSection: formData.weakestSection || '',
            preferredBatch: formData.preferredBatch || ''
        });

        res.status(201).json({ success: true, data: detail });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.getPaymentAccess = async (req, res) => {
    try {
        const hasPaidPayment = await Payment.exists({ user: req.user._id, status: 'paid' });
        const hasClassAccess = Boolean(req.user.hasClassAccess || hasPaidPayment);

        if (hasPaidPayment && !req.user.hasClassAccess) {
            await User.findByIdAndUpdate(req.user._id, { hasClassAccess: true });
        }

        res.status(200).json({
            success: true,
            data: {
                hasClassAccess
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
