const { getPaymentPlan } = require('../config/paymentPlans');
const { APPROVED_STATUSES, MARATHON_PLAN_IDS } = require('../config/programs');
const { loadProgramAccess } = require('./programAccessService');
const Payment = require('../models/Payment');

const RETURNING_WINDOW_START = new Date('2025-12-31T18:00:00.000Z');
const RETURNING_WINDOW_END = new Date('2026-12-31T18:00:00.000Z');
const MARATHON_COUPON_CODE = 'MAGNUSBEST200';
const MARATHON_COUPON_AMOUNT = 200;

function invalid(message, statusCode = 400) {
    return Object.assign(new Error(message), { statusCode });
}

function paymentDate(payment = {}) {
    const value = payment.paidAt || payment.reviewedAt || payment.createdAt;
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
}

function isReturningStudentEligible(payments = []) {
    return payments.some(payment => {
        if (!APPROVED_STATUSES.includes(payment.status)) return false;
        // Preserve an eligibility decision already recorded on a settled Marathon purchase.
        // A Marathon payment without this snapshot never creates eligibility by itself.
        if (MARATHON_PLAN_IDS.includes(payment.planId)) return payment.discountType === 'returningStudent';
        const date = paymentDate(payment);
        return Boolean(date && date >= RETURNING_WINDOW_START && date < RETURNING_WINDOW_END);
    });
}

function getAvailableMarathonPlanIds(sections = []) {
    const current = new Set(sections);
    if (current.has('english') && current.has('maths')) return [];
    if (current.has('english')) return ['marathonAddMaths'];
    if (current.has('maths')) return ['marathonAddEnglish'];
    return ['marathonEnglish', 'marathonMaths', 'marathonBoth'];
}

function normalizeCouponCode(value) {
    return value?.toString().trim().toUpperCase() || '';
}

function hasConsumedMarathonCoupon(payments = []) {
    return payments.some(payment => normalizeCouponCode(payment.couponCode) === MARATHON_COUPON_CODE
        && (Boolean(payment.paidAt) || ['approved', 'paid', 'refund'].includes(payment.status)));
}

function calculateMarathonQuote(planId, access = {}, returningStudentEligible = false, options = {}) {
    if (!MARATHON_PLAN_IDS.includes(planId)) throw invalid('Invalid Marathon plan.');
    const availablePlanIds = getAvailableMarathonPlanIds(access.marathonSections || []);
    if (!availablePlanIds.includes(planId)) {
        throw invalid(availablePlanIds.length
            ? 'Choose the available Marathon option for your current enrollment.'
            : 'You already have access to both Marathon sections.', 409);
    }

    const plan = getPaymentPlan(planId);
    const couponCode = normalizeCouponCode(options.couponCode);
    const requestedPreference = options.discountPreference?.toString().trim().toLowerCase() || '';
    if (requestedPreference && !['returning', 'coupon', 'none'].includes(requestedPreference)) {
        throw invalid('Invalid Marathon discount selection.');
    }
    const discountPreference = requestedPreference || (couponCode ? 'coupon' : returningStudentEligible ? 'returning' : 'none');
    if (discountPreference === 'returning' && !returningStudentEligible) {
        throw invalid('The returning-student discount is not available for this account.');
    }
    if (discountPreference === 'coupon') {
        if (couponCode !== MARATHON_COUPON_CODE) throw invalid('Invalid Marathon coupon code.');
        if (options.couponConsumed) throw invalid('MAGNUSBEST200 has already been used by this account.', 409);
    }

    const discountAmount = discountPreference === 'returning'
        ? plan.amount * 0.25
        : discountPreference === 'coupon'
            ? MARATHON_COUPON_AMOUNT
            : 0;
    return {
        planId,
        planTitle: plan.title,
        originalAmount: plan.amount,
        discountAmount,
        discountType: discountPreference === 'returning' ? 'returningStudent' : discountPreference,
        discountPreference,
        couponCode: discountPreference === 'coupon' ? MARATHON_COUPON_CODE : '',
        amount: plan.amount - discountAmount,
        returningStudentEligible: Boolean(returningStudentEligible),
        couponAvailable: !options.couponConsumed,
        currency: 'BDT'
    };
}

async function loadMarathonPricingContext(userId) {
    const [{ access, payments }, couponPayments] = await Promise.all([
        loadProgramAccess(userId),
        Payment.find({ user: userId, planId: { $in: MARATHON_PLAN_IDS }, couponCode: MARATHON_COUPON_CODE }).lean()
    ]);
    return {
        access,
        payments,
        returningStudentEligible: isReturningStudentEligible(payments),
        couponConsumed: hasConsumedMarathonCoupon(couponPayments)
    };
}

async function getMarathonQuote(userId, planId, couponCode = '', discountPreference = '') {
    const context = await loadMarathonPricingContext(userId);
    return calculateMarathonQuote(planId, context.access, context.returningStudentEligible, {
        couponCode,
        discountPreference,
        couponConsumed: context.couponConsumed
    });
}

module.exports = {
    MARATHON_COUPON_AMOUNT,
    MARATHON_COUPON_CODE,
    RETURNING_WINDOW_START,
    RETURNING_WINDOW_END,
    calculateMarathonQuote,
    getAvailableMarathonPlanIds,
    getMarathonQuote,
    hasConsumedMarathonCoupon,
    isReturningStudentEligible,
    loadMarathonPricingContext,
    normalizeCouponCode,
    invalid
};
