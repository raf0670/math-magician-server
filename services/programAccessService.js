const Payment = require('../models/Payment');
const User = require('../models/User');
const { getHouseFromPlanId } = require('../config/competition');
const { APPROVED_STATUSES, HOUSE_PLAN_IDS } = require('../config/programs');

function paymentStatus(payments) {
    if (!payments.length) return 'unpaid';
    return payments.some(p => (p.paymentChoice || 'full') === 'full' || p.remainingAmount === 0 || p.fullyPaidAt)
        ? 'fullyPaid' : 'partiallyPaid';
}
function firstPaidAt(payments) {
    const times = payments.map(p => p.paidAt || p.reviewedAt || p.createdAt).filter(Boolean).map(d => new Date(d).getTime()).filter(Number.isFinite);
    return times.length ? new Date(Math.min(...times)) : null;
}
function deriveProgramAccess(user = {}, payments = []) {
    const approved = payments.filter(p => APPROVED_STATUSES.includes(p.status));
    const math = approved.filter(p => ['math', 'mathSlytherin'].includes(p.planId));
    const general = approved.filter(p => p.planId !== 'math');
    const originalHouses = general.filter(p => HOUSE_PLAN_IDS.includes(p.planId));
    const housePayment = originalHouses.find(p => getHouseFromPlanId(p.planId) === user.house) || originalHouses[0];
    const slytherin = general.filter(p => ['mathSlytherin', 'slytherinUpgrade'].includes(p.planId));
    return {
        hasClassAccess: general.length > 0,
        hasMathAccess: math.length > 0,
        house: housePayment ? getHouseFromPlanId(housePayment.planId) : slytherin.length ? 'Slytherin' : general.length ? user.house || '' : '',
        paymentStatus: paymentStatus(general.length ? general : math),
        mathPaymentStatus: paymentStatus(math),
        mathAccessStartsAt: math.length ? user.mathAccessStartsAt || firstPaidAt(math) : null,
        // Legacy general memberships intentionally retain their historical penalty rules.
        generalAccessStartsAt: general.length ? user.generalAccessStartsAt || (originalHouses.length ? null : firstPaidAt(slytherin)) : null,
        existingHouseEligible: originalHouses.length > 0
    };
}
async function loadProgramAccess(userId) {
    const [user, payments] = await Promise.all([
        User.findById(userId).lean(),
        Payment.find({ user: userId, status: { $in: APPROVED_STATUSES } }).sort({ createdAt: 1 }).lean()
    ]);
    return { user, payments, access: deriveProgramAccess(user, payments) };
}
async function syncProgramAccess(userId) {
    const { access } = await loadProgramAccess(userId);
    const { existingHouseEligible, ...fields } = access;
    await User.findByIdAndUpdate(userId, fields);
    require('../middleware/auth').invalidateAuthUser(userId);
    return access;
}
module.exports = { deriveProgramAccess, loadProgramAccess, syncProgramAccess };
