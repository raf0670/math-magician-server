const PAYMENT_PLANS = {
    math: { id: 'math', title: 'Math Course', amount: 5999, deliveryMode: 'online', partialAmount: 5999 },
    mathSlytherin: { id: 'mathSlytherin', title: 'Math + Slytherin', amount: 11998, deliveryMode: 'online', partialAmount: 11998 },
    slytherinUpgrade: { id: 'slytherinUpgrade', title: 'Slytherin Upgrade', amount: 5999, deliveryMode: 'online', partialAmount: 5999 },
    offline: {
        id: 'offline',
        title: 'Gryffindor',
        amount: 18000,
        deliveryMode: 'offline',
        partialAmount: 10000
    },
    gryffindor2: {
        id: 'gryffindor2',
        title: 'Gryffindor 2.0',
        amount: 18000,
        deliveryMode: 'offline',
        partialAmount: 10000
    },
    premium: {
        id: 'premium',
        title: 'Ravenclaw',
        amount: 17500,
        deliveryMode: 'online',
        partialAmount: 10000
    },
    online: {
        id: 'online',
        title: 'Hufflepuff',
        amount: 18000,
        deliveryMode: 'offline',
        partialAmount: 10000
    }
};

function getPaymentPlan(planId) {
    const plan = PAYMENT_PLANS[planId] || null;
    if (!plan) return null;

    return {
        ...plan,
        remainingAmount: Math.max(plan.amount - plan.partialAmount, 0)
    };
}

module.exports = { PAYMENT_PLANS, getPaymentPlan };
