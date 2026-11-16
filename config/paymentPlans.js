const PAYMENT_PLANS = {
    marathonEnglish: { id: 'marathonEnglish', title: 'Marathon English', amount: 1200, deliveryMode: 'online', partialAmount: 1200 },
    marathonMaths: { id: 'marathonMaths', title: 'Marathon Maths', amount: 1200, deliveryMode: 'online', partialAmount: 1200 },
    marathonBoth: { id: 'marathonBoth', title: 'Marathon English + Maths', amount: 2000, deliveryMode: 'online', partialAmount: 2000 },
    marathonAddEnglish: { id: 'marathonAddEnglish', title: 'Add Marathon English', amount: 800, deliveryMode: 'online', partialAmount: 800 },
    marathonAddMaths: { id: 'marathonAddMaths', title: 'Add Marathon Maths', amount: 800, deliveryMode: 'online', partialAmount: 800 },
    math: { id: 'math', title: 'Math Course', amount: 4500, deliveryMode: 'online', partialAmount: 4500 },
    mathSlytherin: { id: 'mathSlytherin', title: 'Math + Slytherin', amount: 9000, deliveryMode: 'online', partialAmount: 9000 },
    slytherinUpgrade: { id: 'slytherinUpgrade', title: 'Slytherin Upgrade', amount: 4500, deliveryMode: 'online', partialAmount: 4500 },
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
