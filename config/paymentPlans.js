const PAYMENT_PLANS = {
    offline: {
        id: 'offline',
        title: 'IBA Offline Batch - Farmgate',
        amount: 18000
    },
    premium: {
        id: 'premium',
        title: 'IBA Online Batch',
        amount: 17500
    },
    online: {
        id: 'online',
        title: 'IBA Offline Batch - Bailey Road',
        amount: 18000
    }
};

function getPaymentPlan(planId) {
    return PAYMENT_PLANS[planId] || null;
}

module.exports = { PAYMENT_PLANS, getPaymentPlan };
