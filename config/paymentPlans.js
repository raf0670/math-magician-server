const PAYMENT_PLANS = {
    offline: {
        id: 'offline',
        title: 'Gryffindor',
        amount: 18000
    },
    premium: {
        id: 'premium',
        title: 'Ravenclaw',
        amount: 17500
    },
    online: {
        id: 'online',
        title: 'Hufflepuff',
        amount: 18000
    }
};

function getPaymentPlan(planId) {
    return PAYMENT_PLANS[planId] || null;
}

module.exports = { PAYMENT_PLANS, getPaymentPlan };
