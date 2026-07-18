const Payment = require('../models/Payment');
const User = require('../models/User');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const { getPaymentPlan } = require('../config/paymentPlans');

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const APPROVED_ACCESS_STATUSES = ['approved', 'paid'];
const REQUIRED_FORM_FIELDS = [
    'email',
    'yourName',
    'address',
    'phoneNumber',
    'facebookProfile',
    'emailAddress',
    'college',
    'group',
    'hscBatch',
    'backupChoice',
    'admissionSystemIdea',
    'bkashTrxID'
];

function clean(value) {
    return value?.toString().trim() || '';
}

function makeInvoiceNumber(userId) {
    const shortUser = userId.toString().slice(-6);
    return `MMS-${shortUser}-${Date.now()}`;
}

function getFormValue(formData, key) {
    if (key === 'bkashTrxID') {
        return clean(formData.bkashTrxID || formData.BkashTrxID || formData.trxID || formData.bkashTransactionId);
    }

    return clean(formData[key]);
}

function validateManualEnrollmentForm(formData) {
    const missingFields = REQUIRED_FORM_FIELDS.filter((field) => !getFormValue(formData, field));
    return missingFields;
}

function formatEnrollmentForAdmin(payment, detail) {
    return {
        paymentId: payment._id,
        user: payment.user,
        planId: payment.planId,
        planTitle: payment.planTitle,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        bkashTrxID: payment.trxID,
        merchantInvoiceNumber: payment.merchantInvoiceNumber,
        reviewedBy: payment.reviewedBy,
        reviewedAt: payment.reviewedAt,
        reviewNote: payment.reviewNote,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        enrollment: detail || null
    };
}

async function syncUserClassAccess(userId) {
    const hasApprovedPayment = await Payment.exists({
        user: userId,
        status: { $in: APPROVED_ACCESS_STATUSES }
    });

    await User.findByIdAndUpdate(userId, { hasClassAccess: Boolean(hasApprovedPayment) });
    return Boolean(hasApprovedPayment);
}

exports.submitManualEnrollment = async (req, res) => {
    try {
        const { planId, formData } = req.body;
        const plan = getPaymentPlan(planId);

        if (!plan) {
            return res.status(400).json({ success: false, message: 'Invalid payment plan.' });
        }

        if (!formData || typeof formData !== 'object') {
            return res.status(400).json({ success: false, message: 'Enrollment form details are required.' });
        }

        const missingFields = validateManualEnrollmentForm(formData);
        if (missingFields.length) {
            return res.status(400).json({
                success: false,
                message: 'Please complete all required enrollment fields.',
                missingFields
            });
        }

        const bkashTrxID = getFormValue(formData, 'bkashTrxID');
        const trxIDNormalized = bkashTrxID.toUpperCase();
        const existingPayment = await Payment.findOne({ trxIDNormalized });

        if (existingPayment) {
            return res.status(409).json({
                success: false,
                message: 'This bKash transaction ID has already been submitted.'
            });
        }

        const payment = await Payment.create({
            user: req.user._id,
            planId: plan.id,
            planTitle: plan.title,
            amount: plan.amount,
            merchantInvoiceNumber: makeInvoiceNumber(req.user._id),
            status: 'pending',
            trxID: bkashTrxID
        });

        const detail = await EnrollmentDetail.create({
            user: req.user._id,
            payment: payment._id,
            planId: payment.planId,
            planTitle: payment.planTitle,
            bkashTrxID,
            email: getFormValue(formData, 'email'),
            yourName: getFormValue(formData, 'yourName'),
            address: getFormValue(formData, 'address'),
            phoneNumber: getFormValue(formData, 'phoneNumber'),
            facebookProfile: getFormValue(formData, 'facebookProfile'),
            emailAddress: getFormValue(formData, 'emailAddress'),
            college: getFormValue(formData, 'college'),
            group: getFormValue(formData, 'group'),
            hscBatch: getFormValue(formData, 'hscBatch'),
            backupChoice: getFormValue(formData, 'backupChoice'),
            admissionSystemIdea: getFormValue(formData, 'admissionSystemIdea'),
            previousIbaPreparation: getFormValue(formData, 'previousIbaPreparation'),
            previousStudyDetails: getFormValue(formData, 'previousStudyDetails'),
            strongestSection: getFormValue(formData, 'strongestSection'),
            weakestSection: getFormValue(formData, 'weakestSection'),
            preferredBatch: getFormValue(formData, 'preferredBatch')
        });

        res.status(201).json({
            success: true,
            message: 'Enrollment submitted for admin review.',
            data: {
                paymentId: payment._id,
                status: payment.status,
                bkashTrxID: payment.trxID,
                enrollmentId: detail._id
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'This bKash transaction ID has already been submitted.' });
        }

        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.getPaymentAccess = async (req, res) => {
    try {
        const hasApprovedPayment = await Payment.exists({
            user: req.user._id,
            status: { $in: APPROVED_ACCESS_STATUSES }
        });
        const hasClassAccess = Boolean(req.user.hasClassAccess || hasApprovedPayment);

        if (hasApprovedPayment && !req.user.hasClassAccess) {
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

exports.getAdminEnrollmentReviews = async (req, res) => {
    try {
        const status = clean(req.query.status);
        const paymentFilter = REVIEW_STATUSES.includes(status)
            ? { status }
            : { status: { $in: REVIEW_STATUSES } };

        const payments = await Payment.find(paymentFilter)
            .populate('user', 'name email role hasClassAccess')
            .populate('reviewedBy', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        const paymentIds = payments.map((payment) => payment._id);
        const details = await EnrollmentDetail.find({ payment: { $in: paymentIds } }).lean();
        const detailByPaymentId = new Map(details.map((detail) => [detail.payment.toString(), detail]));

        res.status(200).json({
            success: true,
            count: payments.length,
            data: payments.map((payment) => formatEnrollmentForAdmin(
                payment,
                detailByPaymentId.get(payment._id.toString())
            ))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateEnrollmentReviewStatus = async (req, res) => {
    try {
        const status = clean(req.body.status);
        const reviewNote = clean(req.body.reviewNote);

        if (!REVIEW_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: 'Status must be pending, approved, or rejected.' });
        }

        const payment = await Payment.findById(req.params.paymentId);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Enrollment payment request was not found.' });
        }

        payment.status = status;
        payment.reviewedBy = req.user._id;
        payment.reviewedAt = new Date();
        payment.reviewNote = reviewNote;

        if (status === 'approved') {
            payment.paidAt = payment.paidAt || new Date();
            payment.failureReason = '';
        }

        if (status === 'rejected') {
            payment.failureReason = reviewNote || 'Rejected by admin';
        }

        await payment.save();
        const hasClassAccess = await syncUserClassAccess(payment.user);

        const updatedPayment = await Payment.findById(payment._id)
            .populate('user', 'name email role hasClassAccess')
            .populate('reviewedBy', 'name email')
            .lean();
        const detail = await EnrollmentDetail.findOne({ payment: payment._id }).lean();

        res.status(200).json({
            success: true,
            message: `Enrollment marked as ${status}.`,
            data: {
                ...formatEnrollmentForAdmin(updatedPayment, detail),
                hasClassAccess
            }
        });
    } catch (error) {
        const responseStatus = error.name === 'ValidationError' ? 400 : 500;
        res.status(responseStatus).json({ success: false, message: error.message });
    }
};
