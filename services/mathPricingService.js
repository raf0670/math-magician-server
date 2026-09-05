const { getPaymentPlan } = require('../config/paymentPlans');
const { MATH_PLAN_IDS } = require('../config/programs');
const { loadProgramAccess } = require('./programAccessService');

function invalid(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function calculateMathQuote(planId, couponCode = '', access = {}) {
    if (typeof couponCode !== 'string') throw invalid('Invalid discount code.');
    if (!MATH_PLAN_IDS.includes(planId)) throw invalid('Invalid math plan.');
    if (access.existingHouseEligible && planId !== 'math') throw invalid('Your house already includes full website access. Choose Math only.');
    if (planId === 'slytherinUpgrade') {
        if (!access.hasMathAccess || access.hasClassAccess) throw invalid('The upgrade requires an active math-only enrollment.');
        if (couponCode?.trim()) throw invalid('Discount codes do not apply to the Slytherin upgrade.');
    } else if (access.hasMathAccess) {
        throw invalid('You are already enrolled in Math. Use the Slytherin upgrade to add website access.', 409);
    }
    const plan = getPaymentPlan(planId);
    const originalMinor = Math.round(plan.amount * 100);
    const code = (couponCode || '').toString().trim().toUpperCase();
    const discounts = [{ kind: 'none', amount: 0 }];
    if (access.existingHouseEligible && planId === 'math') discounts.push({ kind: 'existingHouse', amount: Math.round(originalMinor * 0.25) });
    if (code === 'MAGNUS500') discounts.push({ kind: 'coupon', amount: 50000 });
    else if (code === '7A597883') discounts.push({ kind: 'coupon', amount: Math.round(originalMinor * 0.99) });
    else if (code) throw invalid('Invalid discount code.');
    const best = discounts.sort((a, b) => b.amount - a.amount)[0];
    return {
        planId, planTitle: plan.title, originalAmount: originalMinor / 100,
        discountAmount: best.amount / 100, discountType: best.kind,
        couponCode: best.kind === 'coupon' ? code : '',
        amount: (originalMinor - best.amount) / 100,
        existingHouseEligible: Boolean(access.existingHouseEligible), currency: 'BDT'
    };
}
async function getMathQuote(userId, planId, couponCode) {
    const { access } = await loadProgramAccess(userId);
    return calculateMathQuote(planId, couponCode, access);
}
module.exports = { calculateMathQuote, getMathQuote, invalid };
