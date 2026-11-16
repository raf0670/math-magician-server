const { getPaymentPlan } = require('../config/paymentPlans');
const { APPROVED_STATUSES, MARATHON_PLAN_IDS } = require('../config/programs');
const { loadProgramAccess } = require('./programAccessService');

const RETURNING_WINDOW_START = new Date('2025-12-31T18:00:00.000Z');
const RETURNING_WINDOW_END = new Date('2026-12-31T18:00:00.000Z');

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

function calculateMarathonQuote(planId, access = {}, returningStudentEligible = false) {
    if (!MARATHON_PLAN_IDS.includes(planId)) throw invalid('Invalid Marathon plan.');
    const availablePlanIds = getAvailableMarathonPlanIds(access.marathonSections || []);
    if (!availablePlanIds.includes(planId)) {
        throw invalid(availablePlanIds.length
            ? 'Choose the available Marathon option for your current enrollment.'
            : 'You already have access to both Marathon sections.', 409);
    }

    const plan = getPaymentPlan(planId);
    const discountAmount = returningStudentEligible ? plan.amount * 0.25 : 0;
    return {
        planId,
        planTitle: plan.title,
        originalAmount: plan.amount,
        discountAmount,
        discountType: returningStudentEligible ? 'returningStudent' : 'none',
        couponCode: '',
        amount: plan.amount - discountAmount,
        returningStudentEligible: Boolean(returningStudentEligible),
        currency: 'BDT'
    };
}

async function getMarathonQuote(userId, planId) {
    const { access, payments } = await loadProgramAccess(userId);
    return calculateMarathonQuote(planId, access, isReturningStudentEligible(payments));
}

module.exports = {
    RETURNING_WINDOW_START,
    RETURNING_WINDOW_END,
    calculateMarathonQuote,
    getAvailableMarathonPlanIds,
    getMarathonQuote,
    isReturningStudentEligible,
    invalid
};
