const PAYMENT_PLANS = {
    offline: {
        id: 'offline',
        title: 'IBA Offline Batch',
        amount: 15000
    },
    premium: {
        id: 'premium',
        title: 'IBA Premium Combo',
        amount: 18000
    },
    online: {
        id: 'online',
        title: 'IBA Online Live',
        amount: 12000
    }
};

function getPaymentPlan(planId) {
    return PAYMENT_PLANS[planId] || null;
}

module.exports = { PAYMENT_PLANS, getPaymentPlan };
