const Payment = require('../models/Payment');
const User = require('../models/User');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const SeatBooking = require('../models/SeatBooking');
const { getPaymentPlan } = require('../config/paymentPlans');

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const APPROVED_ACCESS_STATUSES = ['approved', 'paid'];
const PAYMENT_CHOICES = ['full', 'partial'];
const PAYMENT_METHODS = ['bkash', 'bank'];
const PARTIAL_PAYMENT_AMOUNT = 10000;
const STUDENT_FORM_FIELDS = [
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
    'preferredBatch'
];
const REQUIRED_FORM_FIELDS = [
    ...STUDENT_FORM_FIELDS,
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

function validateSeatBookingForm(formData) {
    return STUDENT_FORM_FIELDS.filter((field) => {
        if (field === 'backupChoice') {
            return !getBackupChoices(formData).length;
        }

        return !getFormValue(formData, field);
    });
}

function getPaymentMethod(value) {
    const paymentMethod = clean(value || 'bkash').toLowerCase();
    return PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : '';
}

async function findExistingTransaction(trxID, excludedPaymentId = null) {
    const trxIDNormalized = clean(trxID).toUpperCase();
    if (!trxIDNormalized) return null;

    const filter = {
        $or: [
            { trxIDNormalized },
            { finalTrxIDNormalized: trxIDNormalized }
        ]
    };

    if (excludedPaymentId) {
        filter._id = { $ne: excludedPaymentId };
    }

    return Payment.findOne(filter);
}

function getStudentDetailPayload(source) {
    return {
        email: getFormValue(source, 'email'),
        yourName: getFormValue(source, 'yourName'),
        address: getFormValue(source, 'address'),
        phoneNumber: getFormValue(source, 'phoneNumber'),
        facebookProfile: getFormValue(source, 'facebookProfile'),
        emailAddress: getFormValue(source, 'emailAddress'),
        college: getFormValue(source, 'college'),
        group: getFormValue(source, 'group'),
        hscBatch: getFormValue(source, 'hscBatch'),
        backupChoice: getBackupChoices(source),
        admissionSystemIdea: getFormValue(source, 'admissionSystemIdea'),
        previousIbaPreparation: getFormValue(source, 'previousIbaPreparation'),
        previousStudyDetails: getFormValue(source, 'previousStudyDetails'),
        strongestSection: getFormValue(source, 'strongestSection'),
        weakestSection: getFormValue(source, 'weakestSection'),
        preferredBatch: getFormValue(source, 'preferredBatch')
    };
}

function formatSeatBooking(booking) {
    if (!booking) return null;

    return {
        bookingId: booking._id,
        planId: booking.planId,
        planTitle: booking.planTitle,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        student: getStudentDetailPayload(booking)
    };
}

function formatPreBookingForAdmin(booking) {
    const plan = getPaymentPlan(booking.planId);

    return {
        bookingId: booking._id,
        user: booking.user,
        planId: booking.planId,
        planTitle: booking.planTitle,
        amount: plan?.amount || 0,
        deliveryMode: plan?.deliveryMode || '',
        currency: 'BDT',
        status: 'pre-booking',
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        enrollment: getStudentDetailPayload(booking)
    };
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
        paymentMethod: payment.paymentMethod || payment.provider || 'bkash',
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
        const paymentMethod = getPaymentMethod(req.body.paymentMethod || formData?.paymentMethod);
        const plan = getPaymentPlan(planId);

        if (!plan) {
            return res.status(400).json({ success: false, message: 'Invalid payment plan.' });
        }

        if (!PAYMENT_CHOICES.includes(paymentChoice)) {
            return res.status(400).json({ success: false, message: 'Payment choice must be full or partial.' });
        }

        if (!paymentMethod) {
            return res.status(400).json({ success: false, message: 'Payment method must be bkash or bank.' });
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
        const existingPayment = await findExistingTransaction(bkashTrxID);

        if (existingPayment) {
            return res.status(409).json({
                success: false,
                message: 'This transaction ID has already been submitted.'
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
            provider: paymentMethod,
            paymentMethod,
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
            paymentMethod,
            ...getStudentDetailPayload(formData)
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
                paymentMethod: payment.paymentMethod,
                bkashTrxID: payment.trxID,
                enrollmentId: detail._id
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
        }

        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.submitSeatBooking = async (req, res) => {
    try {
        const { planId, formData } = req.body;
        const plan = getPaymentPlan(planId);

        if (!plan) {
            return res.status(400).json({ success: false, message: 'Invalid payment plan.' });
        }

        if (!formData || typeof formData !== 'object') {
            return res.status(400).json({ success: false, message: 'Booking form details are required.' });
        }

        const missingFields = validateSeatBookingForm(formData);
        if (missingFields.length) {
            return res.status(400).json({
                success: false,
                message: 'Please complete all required booking fields.',
                missingFields
            });
        }

        const bookingPayload = {
            user: req.user._id,
            planId: plan.id,
            planTitle: plan.title,
            ...getStudentDetailPayload(formData)
        };

        const booking = await SeatBooking.findOneAndUpdate(
            { user: req.user._id },
            bookingPayload,
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        ).lean();

        const user = await User.findByIdAndUpdate(
            req.user._id,
            {
                hasBooked: true,
                bookedPlanId: plan.id,
                bookedAt: new Date(),
                hasClassAccess: false,
                paymentStatus: 'unpaid'
            },
            { new: true, runValidators: true }
        ).select('name email role bio hasClassAccess hasBooked bookedPlanId bookedAt paymentStatus').lean();

        res.status(201).json({
            success: true,
            message: 'Seat booked successfully.',
            data: {
                booking: formatSeatBooking(booking),
                user: user ? {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    bio: user.bio || '',
                    hasClassAccess: Boolean(user.hasClassAccess),
                    hasBooked: Boolean(user.hasBooked),
                    bookedPlanId: user.bookedPlanId || '',
                    bookedAt: user.bookedAt || null,
                    paymentStatus: user.paymentStatus || 'unpaid'
                } : null
            }
        });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.getMyBooking = async (req, res) => {
    try {
        const booking = await SeatBooking.findOne({ user: req.user._id }).lean();

        res.status(200).json({
            success: true,
            data: {
                hasBooked: Boolean(booking || req.user.hasBooked),
                bookedPlanId: booking?.planId || req.user.bookedPlanId || '',
                bookedAt: booking?.createdAt || req.user.bookedAt || null,
                booking: formatSeatBooking(booking)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.submitBookedCheckout = async (req, res) => {
    try {
        const paymentChoice = clean(req.body.paymentChoice || 'full');
        const paymentMethod = getPaymentMethod(req.body.paymentMethod);
        const trxID = clean(req.body.trxID || req.body.bkashTrxID || req.body.transactionId);
        const booking = await SeatBooking.findOne({ user: req.user._id }).lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Please book a seat before checkout.' });
        }

        if (!PAYMENT_CHOICES.includes(paymentChoice)) {
            return res.status(400).json({ success: false, message: 'Payment choice must be full or partial.' });
        }

        if (!paymentMethod) {
            return res.status(400).json({ success: false, message: 'Payment method must be bkash or bank.' });
        }

        if (!trxID) {
            return res.status(400).json({ success: false, message: 'Transaction ID or reference is required.' });
        }

        const plan = getPaymentPlan(booking.planId);
        if (!plan) {
            return res.status(400).json({ success: false, message: 'The booked payment plan is no longer available.' });
        }

        const existingPayment = await findExistingTransaction(trxID);
        if (existingPayment) {
            return res.status(409).json({
                success: false,
                message: 'This transaction ID has already been submitted.'
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
            provider: paymentMethod,
            paymentMethod,
            merchantInvoiceNumber: makeInvoiceNumber(req.user._id),
            status: 'pending',
            trxID
        });

        const detail = await EnrollmentDetail.create({
            user: req.user._id,
            payment: payment._id,
            planId: payment.planId,
            planTitle: payment.planTitle,
            bkashTrxID: trxID,
            paymentMethod,
            ...getStudentDetailPayload(booking)
        });

        res.status(201).json({
            success: true,
            message: 'Payment submitted for admin review.',
            data: {
                paymentId: payment._id,
                status: payment.status,
                paymentChoice: payment.paymentChoice,
                paidAmount: payment.paidAmount,
                remainingAmount: payment.remainingAmount,
                deliveryMode: payment.deliveryMode,
                paymentMethod: payment.paymentMethod,
                bkashTrxID: payment.trxID,
                enrollmentId: detail._id
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
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
                    paymentStatus: 'fullyPaid',
                    hasBooked: Boolean(req.user.hasBooked),
                    bookedPlanId: req.user.bookedPlanId || '',
                    bookedAt: req.user.bookedAt || null
                }
            });
        }

        const access = await syncUserPaymentAccess(req.user._id);
        const booking = await SeatBooking.findOne({ user: req.user._id }).select('planId createdAt').lean();

        res.status(200).json({
            success: true,
            data: {
                hasClassAccess: Boolean(req.user.hasClassAccess || access.hasClassAccess),
                paymentStatus: access.paymentStatus,
                hasBooked: Boolean(booking || req.user.hasBooked),
                bookedPlanId: booking?.planId || req.user.bookedPlanId || '',
                bookedAt: booking?.createdAt || req.user.bookedAt || null
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

exports.getAdminPreBookings = async (req, res) => {
    try {
        const bookings = await SeatBooking.find({})
            .populate('user', 'name email role hasClassAccess hasBooked bookedPlanId bookedAt paymentStatus')
            .sort({ createdAt: -1 })
            .lean();

        const bookingPairs = bookings.map((booking) => ({
            user: booking.user?._id || booking.user,
            planId: booking.planId
        }));
        const userIds = bookingPairs.map((pair) => pair.user).filter(Boolean);
        const planIds = [...new Set(bookingPairs.map((pair) => pair.planId).filter(Boolean))];

        const existingReviews = userIds.length && planIds.length
            ? await Payment.find({
                user: { $in: userIds },
                planId: { $in: planIds },
                status: { $in: REVIEW_STATUSES }
            }).select('user planId').lean()
            : [];
        const reviewedBookingKeys = new Set(
            existingReviews.map((payment) => `${payment.user.toString()}:${payment.planId}`)
        );
        const preBookings = bookings.filter((booking) => {
            const userId = booking.user?._id || booking.user;
            return userId && !reviewedBookingKeys.has(`${userId.toString()}:${booking.planId}`);
        });

        res.status(200).json({
            success: true,
            count: preBookings.length,
            data: preBookings.map(formatPreBookingForAdmin)
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
        const existingPayment = await findExistingTransaction(finalTrxID, req.params.paymentId);

        if (existingPayment) {
            return res.status(409).json({
                success: false,
                message: 'This transaction ID has already been submitted.'
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
            return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
        }

        const responseStatus = error.name === 'ValidationError' ? 400 : 500;
        res.status(responseStatus).json({ success: false, message: error.message });
    }
};
