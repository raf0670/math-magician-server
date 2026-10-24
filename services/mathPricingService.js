const { getPaymentPlan } = require('../config/paymentPlans');
const { MATH_PLAN_IDS } = require('../config/programs');
const { loadProgramAccess } = require('./programAccessService');

function invalid(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function calculateMathQuote(planId, couponCode = '', access = {}) {
    if (typeof couponCode !== 'string') throw invalid('Invalid discount code.');
    if (!MATH_PLAN_IDS.includes(planId)) throw invalid('Invalid math plan.');
    if (couponCode.trim()) throw invalid('Discount codes are no longer available.');
    if (access.existingHouseEligible && planId !== 'math') throw invalid('Your house already includes full website access. Choose Math only.');
    if (planId === 'slytherinUpgrade') {
        if (!access.hasMathAccess || access.hasClassAccess) throw invalid('The upgrade requires an active math-only enrollment.');
    } else if (access.hasMathAccess) {
        throw invalid('You are already enrolled in Math. Use the Slytherin upgrade to add website access.', 409);
    }
    const plan = getPaymentPlan(planId);
    return {
        planId, planTitle: plan.title, originalAmount: plan.amount,
        discountAmount: 0, discountType: 'none',
        couponCode: '', amount: plan.amount,
        existingHouseEligible: Boolean(access.existingHouseEligible), currency: 'BDT'
    };
}
async function getMathQuote(userId, planId, couponCode) {
    const { access } = await loadProgramAccess(userId);
    return calculateMathQuote(planId, couponCode, access);
}
module.exports = { calculateMathQuote, getMathQuote, invalid };
