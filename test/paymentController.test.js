const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/paymentController');

test('payment choice is required for new payment submissions', () => {
    assert.equal(_private.getPaymentChoice(), '');
    assert.equal(_private.getPaymentChoice(''), '');
    assert.equal(_private.getPaymentChoice('monthly'), '');
});

test('payment choice accepts full and partial values', () => {
    assert.equal(_private.getPaymentChoice('full'), 'full');
    assert.equal(_private.getPaymentChoice('partial'), 'partial');
    assert.equal(_private.getPaymentChoice(' full '), 'full');
});

test('payment metadata still supports full and partial payment choices', () => {
    const plan = {
        amount: 18000,
        deliveryMode: 'offline'
    };

    assert.deepEqual(_private.getPlanPaymentMeta(plan, 'full'), {
        paymentChoice: 'full',
        amount: 18000,
        paidAmount: 18000,
        remainingAmount: 0,
        deliveryMode: 'offline'
    });
    assert.deepEqual(_private.getPlanPaymentMeta(plan, 'partial'), {
        paymentChoice: 'partial',
        amount: 18000,
        paidAmount: 10000,
        remainingAmount: 8000,
        deliveryMode: 'offline'
    });
});
