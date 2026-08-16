const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveHouse } = require('../config/competition');
const { getPaymentPlan } = require('../config/paymentPlans');

test('gryffindor2 payment plan is available as Gryffindor 2.0', () => {
    const plan = getPaymentPlan('gryffindor2');

    assert.equal(plan.title, 'Gryffindor 2.0');
    assert.equal(plan.amount, 18000);
    assert.equal(plan.deliveryMode, 'offline');
    assert.equal(plan.partialAmount, 10000);
});

test('gryffindor2 plan resolves to the main Gryffindor house', () => {
    assert.equal(resolveHouse({ planId: 'gryffindor2' }), 'Gryffindor');
});

test('Gryffindor 2.0 batch resolves to the main Gryffindor house', () => {
    assert.equal(resolveHouse({ preferredBatch: 'Farmgate - Gryffindor 2.0' }), 'Gryffindor');
});
