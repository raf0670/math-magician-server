const Payment = require('../models/Payment');
const User = require('../models/User');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const { getPaymentPlan } = require('../config/paymentPlans');

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const APPROVED_ACCESS_STATUSES = ['approved', 'paid'];
const PAYMENT_CHOICES = ['full', 'partial'];
const PARTIAL_PAYMENT_AMOUNT = 10000;
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
    'preferredBatch',
    'bkashTrxID'
];

function clean(value) {
    return value?.toString().trim() || '';
}

function getBackupChoices(formData) {
    const rawChoices = formData.backupChoice;
    const choices = Array.isArray(rawChoices) ? rawChoices : [rawChoices];
    return choices.map(clean).filter(Boolean);
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
    const missingFields = REQUIRED_FORM_FIELDS.filter((field) => {
        if (field === 'backupChoice') {
            return !getBackupChoices(formData).length;
        }

        return !getFormValue(formData, field);
    });

    return missingFields;
}

function formatEnrollmentForAdmin(payment, detail) {
    return {
        paymentId: payment._id,
        user: payment.user,
        planId: payment.planId,
        planTitle: payment.planTitle,
        amount: payment.amount,
        paymentChoice: payment.paymentChoice || 'full',
        paidAmount: payment.paidAmount || payment.amount,
        remainingAmount: payment.remainingAmount || 0,
        deliveryMode: payment.deliveryMode || getPaymentPlan(payment.planId)?.deliveryMode || '',
        currency: payment.currency,
        status: payment.status,
        bkashTrxID: payment.trxID,
        finalTrxID: payment.finalTrxID,
        merchantInvoiceNumber: payment.merchantInvoiceNumber,
        reviewedBy: payment.reviewedBy,
        reviewedAt: payment.reviewedAt,
        reviewNote: payment.reviewNote,
        paidAt: payment.paidAt,
        fullyPaidAt: payment.fullyPaidAt,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        enrollment: detail || null
    };
}

function getPlanPaymentMeta(plan, paymentChoice) {
    const paidAmount = paymentChoice === 'partial' ? PARTIAL_PAYMENT_AMOUNT : plan.amount;
    return {
        paymentChoice,
        amount: plan.amount,
        paidAmount,
        remainingAmount: Math.max(plan.amount - paidAmount, 0),
        deliveryMode: plan.deliveryMode
    };
}

function applyMissingPaymentMeta(payment) {
    const plan = getPaymentPlan(payment.planId);
    if (!plan) return;

    const choice = PAYMENT_CHOICES.includes(payment.paymentChoice) ? payment.paymentChoice : 'full';
    const meta = getPlanPaymentMeta(plan, choice);

    payment.amount = payment.amount || meta.amount;
    payment.paymentChoice = choice;
    payment.paidAmount = payment.paidAmount || meta.paidAmount;
    payment.remainingAmount = typeof payment.remainingAmount === 'number' ? payment.remainingAmount : meta.remainingAmount;
    payment.deliveryMode = payment.deliveryMode || meta.deliveryMode;
}

async function syncUserPaymentAccess(userId) {
    const approvedPayments = await Payment.find({
        user: userId,
        status: { $in: APPROVED_ACCESS_STATUSES }
    }).select('paymentChoice remainingAmount fullyPaidAt').lean();

    const hasApprovedPayment = approvedPayments.length > 0;
    const hasFullyPaid = approvedPayments.some((payment) => {
        const paymentChoice = payment.paymentChoice || 'full';
        return paymentChoice === 'full'
            || payment.remainingAmount === 0
            || Boolean(payment.fullyPaidAt);
    });
    const paymentStatus = hasFullyPaid
        ? 'fullyPaid'
        : hasApprovedPayment
            ? 'partiallyPaid'
            : 'unpaid';

    await User.findByIdAndUpdate(userId, {
        hasClassAccess: hasApprovedPayment,
        paymentStatus
    });

    return {
        hasClassAccess: hasApprovedPayment,
        paymentStatus
    };
}

exports.submitManualEnrollment = async (req, res) => {
    try {
        const { planId, formData } = req.body;
        const paymentChoice = clean(req.body.paymentChoice || 'full');
        const plan = getPaymentPlan(planId);

        if (!plan) {
            return res.status(400).json({ success: false, message: 'Invalid payment plan.' });
        }

        if (!PAYMENT_CHOICES.includes(paymentChoice)) {
            return res.status(400).json({ success: false, message: 'Payment choice must be full or partial.' });
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
        const existingPayment = await Payment.findOne({
            $or: [
                { trxIDNormalized },
                { finalTrxIDNormalized: trxIDNormalized }
            ]
        });

        if (existingPayment) {
            return res.status(409).json({
                success: false,
                message: 'This bKash transaction ID has already been submitted.'
            });
        }

        const paymentMeta = getPlanPaymentMeta(plan, paymentChoice);
        const payment = await Payment.create({
            user: req.user._id,
            planId: plan.id,
            planTitle: plan.title,
            amount: paymentMeta.amount,
            paymentChoice: paymentMeta.paymentChoice,
            paidAmount: paymentMeta.paidAmount,
            remainingAmount: paymentMeta.remainingAmount,
            deliveryMode: paymentMeta.deliveryMode,
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
            backupChoice: getBackupChoices(formData),
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
                paymentChoice: payment.paymentChoice,
                paidAmount: payment.paidAmount,
                remainingAmount: payment.remainingAmount,
                deliveryMode: payment.deliveryMode,
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
        if (req.user.role === 'admin') {
            return res.status(200).json({
                success: true,
                data: {
                    hasClassAccess: true,
                    paymentStatus: 'fullyPaid'
                }
            });
        }

        const access = await syncUserPaymentAccess(req.user._id);

        res.status(200).json({
            success: true,
            data: {
                hasClassAccess: Boolean(req.user.hasClassAccess || access.hasClassAccess),
                paymentStatus: access.paymentStatus
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
            .populate('user', 'name email role hasClassAccess paymentStatus')
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

        applyMissingPaymentMeta(payment);
        payment.status = status;
        payment.reviewedBy = req.user._id;
        payment.reviewedAt = new Date();
        payment.reviewNote = reviewNote;

        if (status === 'approved') {
            payment.paidAt = payment.paidAt || new Date();
            payment.failureReason = '';

            if (payment.paymentChoice === 'full') {
                payment.remainingAmount = 0;
                payment.fullyPaidAt = payment.fullyPaidAt || payment.paidAt;
            }
        }

        if (status === 'rejected') {
            payment.failureReason = reviewNote || 'Rejected by admin';
        }

        await payment.save();
        const access = await syncUserPaymentAccess(payment.user);

        const updatedPayment = await Payment.findById(payment._id)
            .populate('user', 'name email role hasClassAccess paymentStatus')
            .populate('reviewedBy', 'name email')
            .lean();
        const detail = await EnrollmentDetail.findOne({ payment: payment._id }).lean();

        res.status(200).json({
            success: true,
            message: `Enrollment marked as ${status}.`,
            data: {
                ...formatEnrollmentForAdmin(updatedPayment, detail),
                hasClassAccess: access.hasClassAccess,
                paymentStatus: access.paymentStatus
            }
        });
    } catch (error) {
        const responseStatus = error.name === 'ValidationError' ? 400 : 500;
        res.status(responseStatus).json({ success: false, message: error.message });
    }
};

exports.markEnrollmentFullyPaid = async (req, res) => {
    try {
        const finalTrxID = clean(req.body.finalTrxID || req.body.trxID || req.body.bkashTrxID);

        if (!finalTrxID) {
            return res.status(400).json({ success: false, message: 'Final bKash transaction ID is required.' });
        }

        const finalTrxIDNormalized = finalTrxID.toUpperCase();
        const existingPayment = await Payment.findOne({
            _id: { $ne: req.params.paymentId },
            $or: [
                { trxIDNormalized: finalTrxIDNormalized },
                { finalTrxIDNormalized }
            ]
        });

        if (existingPayment) {
            return res.status(409).json({
                success: false,
                message: 'This bKash transaction ID has already been submitted.'
            });
        }

        const payment = await Payment.findById(req.params.paymentId);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Enrollment payment request was not found.' });
        }

        if (!APPROVED_ACCESS_STATUSES.includes(payment.status)) {
            return res.status(400).json({ success: false, message: 'Only approved enrollments can be marked fully paid.' });
        }

        applyMissingPaymentMeta(payment);

        if (payment.paymentChoice !== 'partial') {
            return res.status(400).json({ success: false, message: 'Only partial enrollments need a final installment.' });
        }

        if (payment.remainingAmount === 0 && payment.finalTrxID) {
            return res.status(400).json({ success: false, message: 'This enrollment is already fully paid.' });
        }

        if (payment.trxIDNormalized === finalTrxIDNormalized) {
            return res.status(409).json({ success: false, message: 'Final transaction ID must be different from the initial payment.' });
        }

        payment.finalTrxID = finalTrxID;
        payment.remainingAmount = 0;
        payment.fullyPaidAt = new Date();
        payment.reviewedBy = req.user._id;
        payment.reviewedAt = new Date();
        payment.failureReason = '';

        await payment.save();
        const access = await syncUserPaymentAccess(payment.user);

        const updatedPayment = await Payment.findById(payment._id)
            .populate('user', 'name email role hasClassAccess paymentStatus')
            .populate('reviewedBy', 'name email')
            .lean();
        const detail = await EnrollmentDetail.findOne({ payment: payment._id }).lean();

        res.status(200).json({
            success: true,
            message: 'Enrollment marked as fully paid.',
            data: {
                ...formatEnrollmentForAdmin(updatedPayment, detail),
                hasClassAccess: access.hasClassAccess,
                paymentStatus: access.paymentStatus
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'This bKash transaction ID has already been submitted.' });
        }

        const responseStatus = error.name === 'ValidationError' ? 400 : 500;
        res.status(responseStatus).json({ success: false, message: error.message });
    }
};
