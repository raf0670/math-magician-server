const { syncProgramAccess, loadProgramAccess } = require('../services/programAccessService');
const { getMathQuote, invalid } = require('../services/mathPricingService');
const { MATH_PLAN_IDS, HOUSE_PLAN_IDS, APPROVED_STATUSES, PREPARATION_METHODS, MATH_WEAKNESSES } = require('../config/programs');
const Payment = require('../models/Payment');
const User = require('../models/User');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const SeatBooking = require('../models/SeatBooking');
const { getPaymentPlan } = require('../config/paymentPlans');
const { resolveHouse } = require('../config/competition');
const { sendPaymentConfirmedEmail } = require('../services/emailService');
const {
    getPaystationStatusKind,
    getTransactionId,
    initiatePayment,
    queryTransactionStatus
} = require('../services/paystationService');

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const APPROVED_ACCESS_STATUSES = ['approved', 'paid'];
const PAYMENT_CHOICES = ['full', 'partial'];
const PAYMENT_METHODS = ['bkash', 'bank', 'paystation'];
const PAYSTATION_METHOD = 'paystation';
const PARTIAL_PAYMENT_AMOUNT = 10000;
const FINAL_CHECKOUT_LOCK_MS = 60 * 1000;
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
    ...STUDENT_FORM_FIELDS
];
const FACEBOOK_LINK_ERROR = 'Please enter a valid Facebook profile link.';
const REFERENCE_EMAIL_ERROR = 'Please enter a valid reference email address.';

function clean(value) {
    return value?.toString().trim() || '';
}

function isFacebookProfileLink(value) {
    const trimmedValue = clean(value);
    if (!trimmedValue) return false;

    try {
        const url = new URL(trimmedValue);
        const hostname = url.hostname.toLowerCase();
        return ['http:', 'https:'].includes(url.protocol)
            && (hostname === 'facebook.com' || hostname.endsWith('.facebook.com'));
    } catch {
        return false;
    }
}

function isBasicEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
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

function makeFinalInvoiceNumber(userId) {
    const shortUser = userId.toString().slice(-6);
    return `MMS-FIN-${shortUser}-${Date.now()}`;
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

function getPaymentChoice(value) {
    const paymentChoice = clean(value);
    return PAYMENT_CHOICES.includes(paymentChoice) ? paymentChoice : '';
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

function getReferencePayload(source = {}) {
    return {
        referenceName: clean(source.referenceName || source.referrerName || source.refName),
        referenceEmail: clean(source.referenceEmail || source.referrerEmail || source.refEmail).toLowerCase()
    };
}

function getEnrollmentDetailPayload(source) {
    if (!source) return null;

    return {
        ...getStudentDetailPayload(source),
        ...getReferencePayload(source),
        _id: source._id,
        user: source.user,
        payment: source.payment,
        planId: source.planId,
        planTitle: source.planTitle,
        bkashTrxID: source.bkashTrxID,
        paymentMethod: source.paymentMethod,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
    };
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
        preparationMethods: Array.isArray(source.preparationMethods) ? source.preparationMethods : [],
        mathFear: clean(source.mathFear),
        mathWeaknesses: Array.isArray(source.mathWeaknesses) ? source.mathWeaknesses : [],
        mathWeaknessOther: clean(source.mathWeaknessOther),
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
        originalAmount: payment.originalAmount || payment.amount,
        discountAmount: payment.discountAmount || 0,
        discountType: payment.discountType || 'none',
        couponCode: payment.couponCode || '',
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
        finalPaymentMethod: payment.finalPaymentMethod,
        finalPaidAmount: payment.finalPaidAmount,
        finalPaystationStatus: payment.finalPaystationStatus,
        merchantInvoiceNumber: payment.merchantInvoiceNumber,
        reviewedBy: payment.reviewedBy,
        reviewedAt: payment.reviewedAt,
        reviewNote: payment.reviewNote,
        paidAt: payment.paidAt,
        fullyPaidAt: payment.fullyPaidAt,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        enrollment: getEnrollmentDetailPayload(detail)
    };
}

function formatPaymentUser(user) {
    if (!user) return null;

    return {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        house: user.house || '',
        bio: user.bio || '',
        hasClassAccess: Boolean(user.hasClassAccess),
        hasMathAccess: Boolean(user.hasMathAccess),
        mathPaymentStatus: user.mathPaymentStatus || 'unpaid',
        mathAccessStartsAt: user.mathAccessStartsAt || null,
        generalAccessStartsAt: user.generalAccessStartsAt || null,
        hasBooked: Boolean(user.hasBooked),
        bookedPlanId: user.bookedPlanId || '',
        bookedAt: user.bookedAt || null,
        paymentStatus: user.paymentStatus || 'unpaid'
    };
}

function money(value) {
    return Math.round(Number(value) * 100) / 100;
}

function getOutstandingPaymentState(access, payments = []) {
    if (!access?.hasClassAccess || access.paymentStatus !== 'partiallyPaid') {
        return { remainingPayment: null, reason: 'not-partially-paid' };
    }

    const candidates = payments.filter((payment) => (
        APPROVED_ACCESS_STATUSES.includes(payment.status)
        && HOUSE_PLAN_IDS.includes(payment.planId)
        && payment.paymentChoice === 'partial'
        && !payment.fullyPaidAt
        && Number(payment.remainingAmount) > 0
    ));

    if (candidates.length !== 1) {
        return {
            remainingPayment: null,
            reason: candidates.length > 1 ? 'ambiguous' : 'missing'
        };
    }

    const payment = candidates[0];
    const totalAmount = money(payment.amount);
    const paidAmount = money(payment.paidAmount);
    const remainingAmount = money(totalAmount - paidAmount);
    const storedRemainingAmount = money(payment.remainingAmount);

    if (
        !Number.isFinite(totalAmount)
        || !Number.isFinite(paidAmount)
        || !Number.isFinite(remainingAmount)
        || totalAmount <= 0
        || paidAmount <= 0
        || remainingAmount <= 0
        || Math.abs(remainingAmount - storedRemainingAmount) > 0.009
    ) {
        return { remainingPayment: null, reason: 'inconsistent' };
    }

    return {
        reason: '',
        payment,
        remainingPayment: {
            paymentId: payment._id,
            planId: payment.planId,
            planTitle: payment.planTitle,
            totalAmount,
            paidAmount,
            remainingAmount,
            currency: payment.currency || 'BDT'
        }
    };
}

async function getCurrentGeneralAccess(userId) {
    return loadProgramAccess(userId);
}

async function rejectExistingGeneralEnrollment(req, res) {
    const { access } = await getCurrentGeneralAccess(req.user._id);
    if (!access.hasClassAccess) return false;

    res.status(409).json({
        success: false,
        message: access.paymentStatus === 'partiallyPaid'
            ? 'You are already enrolled. Pay the remaining installment from your dashboard overview.'
            : 'You already have active class access for this program.'
    });
    return true;
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

function getFrontendUrl() {
    return clean(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function buildFrontendRedirect(path, params = {}) {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        query.set(key, value.toString());
    });

    const queryString = query.toString();
    return `${getFrontendUrl()}${path}${queryString ? `?${queryString}` : ''}`;
}

function getPaystationCustomer(source = {}, user = {}) {
    return {
        name: getFormValue(source, 'yourName') || clean(user.name) || "Magician's School Student",
        phone: getFormValue(source, 'phoneNumber') || '01894688018',
        email: getFormValue(source, 'emailAddress') || getFormValue(source, 'email') || clean(user.email),
        address: getFormValue(source, 'address') || 'Dhaka'
    };
}

function getPaystationCheckoutItems({ plan, paymentMeta, mode }) {
    return {
        service: 'Admission preparation program',
        mode,
        planId: plan.id,
        planTitle: plan.title,
        paymentChoice: paymentMeta.paymentChoice,
        totalAmount: paymentMeta.amount,
        paidAmount: paymentMeta.paidAmount,
        remainingAmount: paymentMeta.remainingAmount,
        currency: 'BDT'
    };
}

function isPaystationInitiateSuccess(payload = {}) {
    return payload.status_code?.toString() === '200'
        && clean(payload.status).toLowerCase() === 'success'
        && Boolean(clean(payload.payment_url));
}

function verifyExactPaymentAmount(expectedAmount, expectedInvoice, payload = {}) {
    const reported = payload.request_amount ?? payload.payment_amount;
    if (reported === undefined || !Number.isFinite(Number(reported)) || Math.round(Number(reported) * 100) !== Math.round(expectedAmount * 100)) {
        throw invalid('PayStation did not confirm the exact course price. Please contact support before paying.', 502);
    }
    if (payload.invoice_number && payload.invoice_number !== expectedInvoice) throw invalid('Payment invoice verification failed.', 502);
}

function verifyMathPaymentAmount(payment, payload = {}) {
    if (!MATH_PLAN_IDS.includes(payment.planId)) return;
    verifyExactPaymentAmount(payment.paidAmount || payment.amount, payment.merchantInvoiceNumber, payload);
}

function verifyFinalPaymentAmount(payment, payload = {}) {
    verifyExactPaymentAmount(payment.finalPaidAmount, payment.finalMerchantInvoiceNumber, payload);
}

function getCallbackPayload(req) {
    return {
        ...(req.query || {}),
        ...(req.body || {})
    };
}

function getCallbackInvoiceNumber(payload = {}) {
    return clean(
        payload.invoice_number
        || payload.invoice
        || payload.merchantInvoiceNumber
        || payload.merchant_invoice_number
    );
}

function getStatusPayload(response = {}) {
    if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        return { ...response, ...response.data };
    }

    return response;
}

async function startPaystationPayment({
    user,
    plan,
    paymentChoice,
    source,
    mode,
    referencePayload = {}
}) {
    const paymentMeta = getPlanPaymentMeta(plan, paymentChoice);
    const merchantInvoiceNumber = makeInvoiceNumber(user._id);
    const payment = await Payment.create({
        user: user._id,
        planId: plan.id,
        planTitle: plan.title,
        originalAmount: plan.quote?.originalAmount || plan.amount,
        discountAmount: plan.quote?.discountAmount || 0,
        discountType: plan.quote?.discountType || 'none',
        couponCode: plan.quote?.couponCode || '',
        amount: paymentMeta.amount,
        paymentChoice: paymentMeta.paymentChoice,
        paidAmount: paymentMeta.paidAmount,
        remainingAmount: paymentMeta.remainingAmount,
        deliveryMode: paymentMeta.deliveryMode,
        provider: PAYSTATION_METHOD,
        paymentMethod: PAYSTATION_METHOD,
        merchantInvoiceNumber,
        status: 'initiated'
    });

    try {
        const createResponse = await initiatePayment({
            invoiceNumber: merchantInvoiceNumber,
            amount: paymentMeta.paidAmount,
            customer: getPaystationCustomer(source, user),
            reference: `${plan.title} ${paymentMeta.paymentChoice} payment`,
            checkoutItems: getPaystationCheckoutItems({ plan, paymentMeta, mode })
        });

        payment.rawCreateResponse = createResponse;
        payment.paystationPaymentUrl = clean(createResponse.payment_url);
        payment.paystationStatus = clean(createResponse.status);

        if (!isPaystationInitiateSuccess(createResponse)) {
            payment.status = 'failed';
            payment.failureReason = createResponse.message || 'PayStation could not create a payment link.';
            await payment.save();
            const error = new Error(payment.failureReason);
            error.statusCode = 502;
            throw error;
        }

        verifyMathPaymentAmount(payment, createResponse);

        await payment.save();

        const detail = await EnrollmentDetail.create({
            user: user._id,
            payment: payment._id,
            planId: payment.planId,
            planTitle: payment.planTitle,
            bkashTrxID: '',
            paymentMethod: PAYSTATION_METHOD,
            ...referencePayload,
            ...getStudentDetailPayload(source)
        });

        return {
            payment,
            detail,
            paymentUrl: payment.paystationPaymentUrl
        };
    } catch (error) {
        if (payment.status !== 'failed') {
            payment.status = 'failed';
            payment.failureReason = error.message || 'PayStation payment initiation failed.';
            payment.rawCreateResponse = payment.rawCreateResponse || { error: error.message };
            await payment.save().catch(() => null);
        }

        throw error;
    }
}

async function startFinalPaystationPayment({ user, payment, remainingPayment }) {
    if (
        ['initiated', 'processing'].includes(payment.finalPaystationStatus)
        && clean(payment.finalPaystationPaymentUrl)
        && money(payment.finalPaidAmount) === remainingPayment.remainingAmount
    ) {
        return { payment, paymentUrl: payment.finalPaystationPaymentUrl, reused: true };
    }

    const now = new Date();
    const lockedPayment = await Payment.findOneAndUpdate({
        _id: payment._id,
        user: user._id,
        remainingAmount: payment.remainingAmount,
        $or: [
            { finalCheckoutLockUntil: { $exists: false } },
            { finalCheckoutLockUntil: null },
            { finalCheckoutLockUntil: { $lte: now } }
        ]
    }, {
        $set: { finalCheckoutLockUntil: new Date(now.getTime() + FINAL_CHECKOUT_LOCK_MS) }
    }, { new: true });

    if (!lockedPayment) {
        const latest = await Payment.findById(payment._id);
        if (
            ['initiated', 'processing'].includes(latest?.finalPaystationStatus)
            && clean(latest?.finalPaystationPaymentUrl)
            && money(latest?.finalPaidAmount) === remainingPayment.remainingAmount
        ) {
            return { payment: latest, paymentUrl: latest.finalPaystationPaymentUrl, reused: true };
        }
        throw invalid('Your remaining-payment checkout is already being prepared. Please try again in a moment.', 409);
    }

    const detail = await EnrollmentDetail.findOne({ payment: lockedPayment._id }).lean();
    const invoiceNumber = makeFinalInvoiceNumber(user._id);
    lockedPayment.finalMerchantInvoiceNumber = invoiceNumber;
    lockedPayment.finalPaymentMethod = PAYSTATION_METHOD;
    lockedPayment.finalPaidAmount = remainingPayment.remainingAmount;
    lockedPayment.finalPaystationStatus = 'initiated';
    lockedPayment.finalPaystationPaymentUrl = '';
    lockedPayment.finalFailureReason = '';
    lockedPayment.finalRawCreateResponse = undefined;
    await lockedPayment.save();

    try {
        const createResponse = await initiatePayment({
            invoiceNumber,
            amount: remainingPayment.remainingAmount,
            customer: getPaystationCustomer(detail || {}, user),
            reference: `${lockedPayment.planTitle} final installment`,
            checkoutItems: {
                service: 'Admission preparation program final installment',
                mode: 'remaining-checkout',
                paymentId: lockedPayment._id,
                planId: lockedPayment.planId,
                planTitle: lockedPayment.planTitle,
                totalAmount: remainingPayment.totalAmount,
                previouslyPaid: remainingPayment.paidAmount,
                paidAmount: remainingPayment.remainingAmount,
                remainingAmount: 0,
                currency: lockedPayment.currency || 'BDT'
            }
        });

        lockedPayment.finalRawCreateResponse = createResponse;
        lockedPayment.finalPaystationPaymentUrl = clean(createResponse.payment_url);
        lockedPayment.finalPaystationStatus = clean(createResponse.status).toLowerCase();

        if (!isPaystationInitiateSuccess(createResponse)) {
            lockedPayment.finalPaystationStatus = 'failed';
            lockedPayment.finalFailureReason = createResponse.message || 'PayStation could not create the remaining-payment link.';
            lockedPayment.finalCheckoutLockUntil = undefined;
            await lockedPayment.save();
            throw invalid(lockedPayment.finalFailureReason, 502);
        }

        verifyFinalPaymentAmount(lockedPayment, createResponse);
        lockedPayment.finalPaystationStatus = 'initiated';
        lockedPayment.finalCheckoutLockUntil = undefined;
        await lockedPayment.save();
        return { payment: lockedPayment, paymentUrl: lockedPayment.finalPaystationPaymentUrl, reused: false };
    } catch (error) {
        if (lockedPayment.finalPaystationStatus !== 'failed') {
            lockedPayment.finalPaystationStatus = 'failed';
            lockedPayment.finalFailureReason = error.message || 'Remaining-payment initiation failed.';
            lockedPayment.finalRawCreateResponse = lockedPayment.finalRawCreateResponse || { error: error.message };
            lockedPayment.finalCheckoutLockUntil = undefined;
            await lockedPayment.save().catch(() => null);
        }
        throw error;
    }
}

function applyPaystationStatus(payment, statusPayload, callbackPayload = {}) {
    const statusKind = getPaystationStatusKind(statusPayload);
    const transactionId = getTransactionId(statusPayload) || getTransactionId(callbackPayload);
    const wasPaid = APPROVED_ACCESS_STATUSES.includes(payment.status);
    // A delayed callback must not downgrade a verified purchase. Refunds remain authoritative.
    if (wasPaid && statusKind !== 'success' && statusKind !== 'refund') return { statusKind: 'success', shouldUnlock: true, shouldSendEmail: false };

    payment.rawExecuteResponse = statusPayload;
    payment.rawCallbackResponse = callbackPayload;
    payment.paystationStatus = statusKind;

    if (transactionId) {
        payment.paystationTransactionId = transactionId;
        if (!payment.trxID) payment.trxID = transactionId;
    }

    if (statusKind === 'success') {
        payment.status = 'paid';
        payment.paidAt = payment.paidAt || new Date();
        payment.failureReason = '';

        if (payment.paymentChoice === 'full') {
            payment.remainingAmount = 0;
            payment.fullyPaidAt = payment.fullyPaidAt || payment.paidAt;
        }

        return { statusKind, shouldUnlock: true, shouldSendEmail: !wasPaid };
    }

    if (statusKind === 'processing') {
        payment.status = 'processing';
        payment.failureReason = '';
        return { statusKind, shouldUnlock: false, shouldSendEmail: false };
    }

    payment.status = statusKind === 'cancelled' || statusKind === 'refund' ? statusKind : 'failed';
    payment.failureReason = statusPayload.message || callbackPayload.message || `PayStation payment ${payment.status}.`;
    return { statusKind, shouldUnlock: false, shouldSendEmail: false };
}

function applyFinalPaystationStatus(payment, statusPayload, callbackPayload = {}) {
    const statusKind = getPaystationStatusKind(statusPayload);
    const transactionId = getTransactionId(statusPayload) || getTransactionId(callbackPayload);
    const wasPaid = payment.finalPaystationStatus === 'success' && payment.remainingAmount === 0;

    // Delayed gateway messages must not undo a verified installment. Refunds remain authoritative.
    if (wasPaid && statusKind !== 'success' && statusKind !== 'refund') {
        return { statusKind: 'success', shouldUnlock: true, shouldSendEmail: false };
    }

    payment.finalRawExecuteResponse = statusPayload;
    payment.finalRawCallbackResponse = callbackPayload;
    payment.finalPaystationStatus = statusKind;

    if (transactionId) {
        payment.finalPaystationTransactionId = transactionId;
        payment.finalTrxID = transactionId;
    }

    if (statusKind === 'success') {
        payment.remainingAmount = 0;
        payment.fullyPaidAt = payment.fullyPaidAt || new Date();
        payment.finalFailureReason = '';
        return { statusKind, shouldUnlock: true, shouldSendEmail: !wasPaid };
    }

    if (statusKind === 'processing') {
        payment.finalFailureReason = '';
        return { statusKind, shouldUnlock: false, shouldSendEmail: false };
    }

    if (statusKind === 'refund') {
        payment.remainingAmount = payment.finalPaidAmount;
        payment.fullyPaidAt = undefined;
        payment.finalFailureReason = statusPayload.message || callbackPayload.message || 'Final installment refunded.';
        return { statusKind, shouldUnlock: false, shouldSendEmail: false };
    }

    payment.finalFailureReason = statusPayload.message || callbackPayload.message || `PayStation final payment ${statusKind}.`;
    return { statusKind, shouldUnlock: false, shouldSendEmail: false };
}

exports.handlePaystationCallback = async (req, res) => {
    const callbackPayload = getCallbackPayload(req);
    const invoiceNumber = getCallbackInvoiceNumber(callbackPayload);
    const callbackTrxId = getTransactionId(callbackPayload);
    let callbackPaymentStage = '';

    try {
        if (!invoiceNumber && !callbackTrxId) {
            return res.redirect(buildFrontendRedirect('/payment/failed', {
                reason: 'missing-payment-reference'
            }));
        }

        let payment = invoiceNumber
            ? await Payment.findOne({ merchantInvoiceNumber: invoiceNumber })
            : await Payment.findOne({
                $or: [
                    { paystationTransactionId: callbackTrxId },
                    { trxIDNormalized: callbackTrxId.toUpperCase() },
                    { finalPaystationTransactionId: callbackTrxId },
                    { finalTrxIDNormalized: callbackTrxId.toUpperCase() }
                ]
            });

        if (!payment && invoiceNumber) {
            payment = await Payment.findOne({ finalMerchantInvoiceNumber: invoiceNumber });
        }

        if (!payment) {
            return res.redirect(buildFrontendRedirect('/payment/failed', {
                invoice: invoiceNumber,
                reason: 'payment-not-found'
            }));
        }

        const isFinalInstallment = (
            (invoiceNumber && payment.finalMerchantInvoiceNumber === invoiceNumber)
            || (!invoiceNumber && callbackTrxId && [payment.finalPaystationTransactionId, payment.finalTrxID]
                .filter(Boolean)
                .some((value) => value.toUpperCase() === callbackTrxId.toUpperCase()))
        );
        callbackPaymentStage = isFinalInstallment ? 'final' : 'initial';
        const statusResponse = await queryTransactionStatus({
            invoiceNumber: isFinalInstallment ? payment.finalMerchantInvoiceNumber : payment.merchantInvoiceNumber,
            trxId: callbackTrxId || (isFinalInstallment ? payment.finalPaystationTransactionId : payment.paystationTransactionId)
        });
        const statusPayload = getStatusPayload(statusResponse);
        if (getPaystationStatusKind(statusPayload) === 'success') {
            if (isFinalInstallment) verifyFinalPaymentAmount(payment, statusPayload);
            else verifyMathPaymentAmount(payment, statusPayload);
        }
        const result = isFinalInstallment
            ? applyFinalPaystationStatus(payment, statusPayload, callbackPayload)
            : applyPaystationStatus(payment, statusPayload, callbackPayload);

        await payment.save();
        if (!result.shouldUnlock) await syncUserPaymentAccess(payment.user);

        if (result.shouldUnlock) {
            await syncUserPaymentAccess(payment.user);

            if (result.shouldSendEmail) {
                const user = await User.findById(payment.user).select('name email').lean();
                if (user?.email) {
                    await sendPaymentConfirmedEmail({
                        to: user.email,
                        name: user.name,
                        planTitle: payment.planTitle
                    }).catch((emailError) => {
                        console.error('PayStation payment confirmation email failed:', emailError.message);
                    });
                }
            }

            return res.redirect(buildFrontendRedirect('/payment/success', {
                paymentId: payment._id,
                invoice: isFinalInstallment ? payment.finalMerchantInvoiceNumber : payment.merchantInvoiceNumber,
                status: 'paid',
                plan: payment.planId,
                paymentChoice: isFinalInstallment ? 'final' : payment.paymentChoice,
                remainingAmount: payment.remainingAmount,
                paymentStage: isFinalInstallment ? 'final' : 'initial'
            }));
        }

        return res.redirect(buildFrontendRedirect('/payment/failed', {
            paymentId: payment._id,
            invoice: payment.merchantInvoiceNumber,
            status: payment.status,
            reason: result.statusKind,
            paymentStage: callbackPaymentStage
        }));
    } catch (error) {
        console.error('PayStation callback failed:', error.message);
        return res.redirect(buildFrontendRedirect('/payment/failed', {
            invoice: invoiceNumber,
            reason: 'verification-failed',
            paymentStage: callbackPaymentStage
        }));
    }
};

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

const syncUserPaymentAccess = syncProgramAccess;

exports.getPaymentQuote = async (req, res) => {
    try {
        res.json({ success: true, data: await getMathQuote(req.user._id, req.body.planId, req.body.couponCode) });
    } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
};
exports.getMathEnrollmentContext = async (req, res) => {
    try {
        const { access, payments } = await loadProgramAccess(req.user._id);
        const detail = await EnrollmentDetail.findOne({ user: req.user._id, payment: { $in: payments.map(p => p._id) } }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, data: { ...access, student: detail ? getStudentDetailPayload(detail) : null } });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
function validateMathSurvey(source) {
    const errors = [];
    for (const [field, values] of [['preparationMethods', PREPARATION_METHODS], ['mathWeaknesses', MATH_WEAKNESSES]]) {
        if (!Array.isArray(source[field]) || !source[field].length || source[field].some(v => !values.includes(v))) errors.push(field);
    }
    if (!clean(source.mathFear) || clean(source.mathFear).length > 5000) errors.push('mathFear');
    if (source.mathWeaknesses?.includes('Others') && !clean(source.mathWeaknessOther)) errors.push('mathWeaknessOther');
    if (clean(source.mathWeaknessOther).length > 2000) errors.push('mathWeaknessOther');
    return errors;
}
async function submitMathEnrollment(req, res) {
    let locked = false;
    try {
        if (req.body.paymentChoice !== 'full') throw invalid('The Math Course requires full payment.');
        const lock = await User.findOneAndUpdate({ _id: req.user._id, $or: [{ mathCheckoutLockUntil: { $exists: false } }, { mathCheckoutLockUntil: { $lt: new Date() } }] }, { mathCheckoutLockUntil: new Date(Date.now() + 120000) });
        if (!lock) throw invalid('Checkout is already being prepared. Please try again shortly.', 409);
        locked = true;
        const quote = await getMathQuote(req.user._id, req.body.planId, req.body.couponCode);
        if (Number(req.body.expectedAmount) !== quote.amount) throw invalid('Your enrollment price has changed. Refresh the page to confirm the current price.', 409);
        let source = req.body.formData;
        if (quote.planId === 'slytherinUpgrade') {
            const paidMath = await Payment.find({ user: req.user._id, planId: { $in: ['math', 'mathSlytherin'] }, status: { $in: APPROVED_ACCESS_STATUSES } }).select('_id').lean();
            source = await EnrollmentDetail.findOne({ user: req.user._id, payment: { $in: paidMath.map(p => p._id) } }).sort({ createdAt: -1 }).lean();
        }
        if (!source || typeof source !== 'object') throw invalid('Enrollment details are required.');
        source = { ...source, preferredBatch: quote.planId === 'math' ? 'Math Course' : 'Slytherin' };
        const missingFields = [...validateManualEnrollmentForm(source), ...validateMathSurvey(source)];
        if (missingFields.length) return res.status(400).json({ success: false, message: 'Please complete all required enrollment fields.', missingFields });
        if (!isFacebookProfileLink(source.facebookProfile)) throw invalid(FACEBOOK_LINK_ERROR);
        // Validate the complete document before creating a hosted payment session.
        await new EnrollmentDetail({ ...getStudentDetailPayload(source), user: req.user._id, payment: new (require('mongoose').Types.ObjectId)(), planId: quote.planId, planTitle: quote.planTitle }).validate();
        const pending = await Payment.findOne({ user: req.user._id, planId: { $in: MATH_PLAN_IDS }, status: { $in: ['initiated', 'processing'] } }).sort({ createdAt: -1 }).lean();
        if (pending) {
            if (pending.planId !== quote.planId || pending.amount !== quote.amount || !pending.paystationPaymentUrl) throw invalid('A math checkout is already pending. Complete or cancel it before starting a different purchase.', 409);
            return res.json({ success: true, data: { paymentId: pending._id, paymentUrl: pending.paystationPaymentUrl, status: pending.status } });
        }
        const plan = { ...getPaymentPlan(quote.planId), amount: quote.amount, quote };
        const { payment, paymentUrl } = await startPaystationPayment({ user: req.user, plan, paymentChoice: 'full', source, mode: 'enrollment' });
        res.status(201).json({ success: true, data: { paymentId: payment._id, paymentUrl, status: payment.status, paidAmount: payment.amount } });
    } catch (error) {
        res.status(error.statusCode || (error.name === 'ValidationError' ? 400 : 500)).json({ success: false, message: error.message });
    } finally {
        if (locked) await User.updateOne({ _id: req.user._id }, { $unset: { mathCheckoutLockUntil: 1 } });
    }
}

exports.submitManualEnrollment = async (req, res) => {
    if (MATH_PLAN_IDS.includes(req.body.planId)) return submitMathEnrollment(req, res);
    try {
        if (await rejectExistingGeneralEnrollment(req, res)) return;
        const { planId, formData } = req.body;
        const paymentChoice = getPaymentChoice(req.body.paymentChoice);
        const plan = getPaymentPlan(planId);

        if (MATH_PLAN_IDS.includes(planId)) return res.status(400).json({ success: false, message: 'Use Math Course enrollment for this plan.' });
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

        if (!isFacebookProfileLink(formData.facebookProfile)) {
            return res.status(400).json({
                success: false,
                message: FACEBOOK_LINK_ERROR,
                invalidFields: ['facebookProfile']
            });
        }

        const referencePayload = getReferencePayload(formData);
        if (referencePayload.referenceEmail && !isBasicEmail(referencePayload.referenceEmail)) {
            return res.status(400).json({
                success: false,
                message: REFERENCE_EMAIL_ERROR,
                invalidFields: ['referenceEmail']
            });
        }

        const { payment, detail, paymentUrl } = await startPaystationPayment({
            user: req.user,
            plan,
            paymentChoice,
            source: formData,
            mode: 'enrollment',
            referencePayload
        });

        await User.findByIdAndUpdate(req.user._id, {
            house: resolveHouse({ planId: payment.planId, preferredBatch: formData.preferredBatch })
        });

        res.status(201).json({
            success: true,
            message: 'PayStation payment link created.',
            data: {
                paymentId: payment._id,
                paymentUrl,
                merchantInvoiceNumber: payment.merchantInvoiceNumber,
                status: payment.status,
                paymentChoice: payment.paymentChoice,
                paidAmount: payment.paidAmount,
                remainingAmount: payment.remainingAmount,
                deliveryMode: payment.deliveryMode,
                paymentMethod: payment.paymentMethod,
                ...referencePayload,
                enrollmentId: detail._id
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
        }

        const status = error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.submitSeatBooking = async (req, res) => {
    try {
        if (await rejectExistingGeneralEnrollment(req, res)) return;
        const { planId, formData } = req.body;
        const plan = getPaymentPlan(planId);

        if (MATH_PLAN_IDS.includes(planId)) return res.status(400).json({ success: false, message: 'Use Math Course enrollment for this plan.' });
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

        if (!isFacebookProfileLink(formData.facebookProfile)) {
            return res.status(400).json({
                success: false,
                message: FACEBOOK_LINK_ERROR,
                invalidFields: ['facebookProfile']
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
                paymentStatus: 'unpaid',
                house: resolveHouse({ planId: plan.id, preferredBatch: formData.preferredBatch })
            },
            { new: true, runValidators: true }
        ).select('name email role house bio hasClassAccess hasBooked bookedPlanId bookedAt paymentStatus').lean();

        res.status(201).json({
            success: true,
            message: 'Seat booked successfully.',
            data: {
                booking: formatSeatBooking(booking),
                user: formatPaymentUser(user)
            }
        });
    } catch (error) {
        const status = error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
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
        if (await rejectExistingGeneralEnrollment(req, res)) return;
        const paymentChoice = getPaymentChoice(req.body.paymentChoice);
        const booking = await SeatBooking.findOne({ user: req.user._id }).lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Please book a seat before checkout.' });
        }

        if (!PAYMENT_CHOICES.includes(paymentChoice)) {
            return res.status(400).json({ success: false, message: 'Payment choice must be full or partial.' });
        }

        const plan = getPaymentPlan(booking.planId);
        if (!plan) {
            return res.status(400).json({ success: false, message: 'The booked payment plan is no longer available.' });
        }

        const { payment, detail, paymentUrl } = await startPaystationPayment({
            user: req.user,
            plan,
            paymentChoice,
            source: booking,
            mode: 'booked-checkout'
        });

        await User.findByIdAndUpdate(req.user._id, {
            house: resolveHouse({ planId: payment.planId, preferredBatch: booking.preferredBatch })
        });

        res.status(201).json({
            success: true,
            message: 'PayStation payment link created.',
            data: {
                paymentId: payment._id,
                paymentUrl,
                merchantInvoiceNumber: payment.merchantInvoiceNumber,
                status: payment.status,
                paymentChoice: payment.paymentChoice,
                paidAmount: payment.paidAmount,
                remainingAmount: payment.remainingAmount,
                deliveryMode: payment.deliveryMode,
                paymentMethod: payment.paymentMethod,
                enrollmentId: detail._id
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
        }

        const status = error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.submitRemainingCheckout = async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.status(403).json({ success: false, message: 'Remaining-payment checkout is only available to student accounts.' });
        }

        const { user, payments, access } = await getCurrentGeneralAccess(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Student account was not found.' });
        }
        if (!access.hasClassAccess) {
            return res.status(403).json({ success: false, message: 'An approved partial enrollment is required before paying a remaining installment.' });
        }
        if (access.paymentStatus !== 'partiallyPaid') {
            return res.status(409).json({ success: false, message: 'This enrollment does not have an outstanding installment.' });
        }

        const state = getOutstandingPaymentState(access, payments);
        if (!state.remainingPayment) {
            const message = state.reason === 'ambiguous'
                ? 'Multiple outstanding enrollment payments were found. Please contact support before paying.'
                : 'Your remaining balance could not be verified. Please contact support before paying.';
            return res.status(409).json({ success: false, message });
        }

        const payment = await Payment.findById(state.payment._id);
        if (!payment || payment.user.toString() !== user._id.toString()) {
            return res.status(404).json({ success: false, message: 'The original enrollment payment was not found.' });
        }

        const checkout = await startFinalPaystationPayment({
            user,
            payment,
            remainingPayment: state.remainingPayment
        });

        return res.status(checkout.reused ? 200 : 201).json({
            success: true,
            message: checkout.reused ? 'Existing remaining-payment checkout returned.' : 'Remaining-payment checkout created.',
            data: {
                ...state.remainingPayment,
                paymentUrl: checkout.paymentUrl,
                invoice: checkout.payment.finalMerchantInvoiceNumber,
                status: checkout.payment.finalPaystationStatus
            }
        });
    } catch (error) {
        const status = error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
        return res.status(status).json({ success: false, message: error.message });
    }
};

exports.getPaymentAccess = async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.status(200).json({
                success: true,
                data: {
                    hasMathAccess: true,
                hasClassAccess: true,
                    paymentStatus: 'fullyPaid',
                    remainingPayment: null,
                    house: req.user.house || '',
                    hasBooked: Boolean(req.user.hasBooked),
                    bookedPlanId: req.user.bookedPlanId || '',
                    bookedAt: req.user.bookedAt || null
                }
            });
        }

        const access = await syncUserPaymentAccess(req.user._id);
        const [booking, payments] = await Promise.all([
            SeatBooking.findOne({ user: req.user._id }).select('planId createdAt').lean(),
            Payment.find({ user: req.user._id, status: { $in: APPROVED_STATUSES } }).sort({ createdAt: 1 }).lean()
        ]);
        const { remainingPayment } = getOutstandingPaymentState(access, payments);

        res.status(200).json({
            success: true,
            data: {
                ...access,
                hasClassAccess: access.hasClassAccess,
                paymentStatus: access.paymentStatus,
                remainingPayment,
                house: access.house,
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
        const visibleStatuses = [...REVIEW_STATUSES, 'paid', 'initiated', 'processing', 'failed', 'cancelled', 'refund'];
        const paymentFilter = visibleStatuses.includes(status) ? { status } : { status: { $in: visibleStatuses } };
        if (req.query.planId) paymentFilter.planId = clean(req.query.planId);

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

        const shouldSendPaymentConfirmedEmail = payment.status !== 'approved' && status === 'approved';

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

        if (shouldSendPaymentConfirmedEmail && updatedPayment?.user?.email) {
            try {
                await sendPaymentConfirmedEmail({
                    to: updatedPayment.user.email,
                    name: updatedPayment.user.name,
                    planTitle: updatedPayment.planTitle
                });
            } catch (emailError) {
                console.error('Payment confirmation email failed:', emailError.message);
            }
        }

        res.status(200).json({
            success: true,
            message: `Enrollment marked as ${status}.`,
            data: {
                ...formatEnrollmentForAdmin(updatedPayment, detail),
                ...access,
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
        payment.finalPaymentMethod = 'bkash';
        payment.finalPaidAmount = payment.remainingAmount;
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
                ...access,
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

exports._private = {
    verifyMathPaymentAmount,
    verifyFinalPaymentAmount,
    validateMathSurvey,
    getPaymentChoice,
    getPaymentMethod,
    getPlanPaymentMeta,
    getCallbackInvoiceNumber,
    getStatusPayload,
    isPaystationInitiateSuccess,
    applyPaystationStatus,
    applyFinalPaystationStatus,
    getOutstandingPaymentState
};
