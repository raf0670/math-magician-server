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

test('payment method accepts paystation for hosted checkout records', () => {
    assert.equal(_private.getPaymentMethod('paystation'), 'paystation');
    assert.equal(_private.getPaymentMethod(' PayStation '), 'paystation');
});

test('paystation initiate response requires success status and payment url', () => {
    assert.equal(_private.isPaystationInitiateSuccess({
        status_code: 200,
        status: 'success',
        payment_url: 'https://sandbox.paystation.com.bd/pay/123'
    }), true);

    assert.equal(_private.isPaystationInitiateSuccess({
        status_code: 200,
        status: 'failed',
        payment_url: 'https://sandbox.paystation.com.bd/pay/123'
    }), false);

    assert.equal(_private.isPaystationInitiateSuccess({
        status_code: 200,
        status: 'success'
    }), false);
});

test('paystation callback invoice can be read from known field names', () => {
    assert.equal(_private.getCallbackInvoiceNumber({ invoice_number: 'MMS-1' }), 'MMS-1');
    assert.equal(_private.getCallbackInvoiceNumber({ invoice: 'MMS-2' }), 'MMS-2');
    assert.equal(_private.getCallbackInvoiceNumber({ merchantInvoiceNumber: 'MMS-3' }), 'MMS-3');
    assert.equal(_private.getCallbackInvoiceNumber({ merchant_invoice_number: 'MMS-4' }), 'MMS-4');
});

test('paystation status payload merges nested response data', () => {
    assert.deepEqual(_private.getStatusPayload({
        requestId: 'abc',
        data: {
            status: 'success',
            trxId: 'TRX123'
        }
    }), {
        requestId: 'abc',
        data: {
            status: 'success',
            trxId: 'TRX123'
        },
        status: 'success',
        trxId: 'TRX123'
    });
});

test('successful paystation status marks payment paid and unlocks once', () => {
    const payment = {
        status: 'initiated',
        paymentChoice: 'full',
        remainingAmount: 18000,
        trxID: ''
    };

    const result = _private.applyPaystationStatus(payment, {
        status: 'success',
        trxId: 'PS-123'
    }, {
        invoice_number: 'MMS-123'
    });

    assert.equal(result.statusKind, 'success');
    assert.equal(result.shouldUnlock, true);
    assert.equal(result.shouldSendEmail, true);
    assert.equal(payment.status, 'paid');
    assert.equal(payment.remainingAmount, 0);
    assert.equal(payment.trxID, 'PS-123');
    assert.equal(payment.paystationTransactionId, 'PS-123');
    assert.ok(payment.paidAt instanceof Date);
    assert.ok(payment.fullyPaidAt instanceof Date);

    const secondResult = _private.applyPaystationStatus(payment, {
        status: 'success',
        trxId: 'PS-123'
    });

    assert.equal(secondResult.shouldUnlock, true);
    assert.equal(secondResult.shouldSendEmail, false);
});

test('paystation api success with failed transaction status does not unlock access', () => {
    const payment = {
        status: 'initiated',
        paymentChoice: 'full',
        remainingAmount: 18000
    };

    const result = _private.applyPaystationStatus(payment, {
        status_code: '200',
        status: 'success',
        message: 'Transaction found',
        data: {
            trx_status: 'Failed',
            trx_id: ''
        }
    });

    assert.equal(result.statusKind, 'failed');
    assert.equal(result.shouldUnlock, false);
    assert.equal(result.shouldSendEmail, false);
    assert.equal(payment.status, 'failed');
    assert.equal(payment.remainingAmount, 18000);
});

test('paystation nested successful transaction status marks payment paid', () => {
    const payment = {
        status: 'initiated',
        paymentChoice: 'full',
        remainingAmount: 18000,
        trxID: ''
    };

    const result = _private.applyPaystationStatus(payment, {
        status_code: '200',
        status: 'success',
        message: 'Transaction found',
        data: {
            trx_status: 'success',
            trx_id: 'PS-SUCCESS-1'
        }
    });

    assert.equal(result.statusKind, 'success');
    assert.equal(result.shouldUnlock, true);
    assert.equal(payment.status, 'paid');
    assert.equal(payment.remainingAmount, 0);
    assert.equal(payment.paystationTransactionId, 'PS-SUCCESS-1');
});

test('failed and cancelled paystation statuses do not unlock access', () => {
    const failedPayment = {
        status: 'initiated',
        paymentChoice: 'partial',
        remainingAmount: 8000
    };
    const failedResult = _private.applyPaystationStatus(failedPayment, {
        status: 'failed',
        message: 'Declined'
    });

    assert.equal(failedResult.shouldUnlock, false);
    assert.equal(failedResult.shouldSendEmail, false);
    assert.equal(failedPayment.status, 'failed');
    assert.equal(failedPayment.failureReason, 'Declined');

    const cancelledPayment = {
        status: 'initiated',
        paymentChoice: 'full',
        remainingAmount: 18000
    };
    const cancelledResult = _private.applyPaystationStatus(cancelledPayment, {
        status: 'cancelled'
    });

    assert.equal(cancelledResult.shouldUnlock, false);
    assert.equal(cancelledPayment.status, 'cancelled');
});

test('paystation nested cancelled processing and refund statuses do not unlock access', () => {
    const cases = [
        ['cancelled', 'cancelled'],
        ['processing', 'processing'],
        ['refund', 'refund']
    ];

    cases.forEach(([trxStatus, expectedStatus]) => {
        const payment = {
            status: 'initiated',
            paymentChoice: 'full',
            remainingAmount: 18000
        };
        const result = _private.applyPaystationStatus(payment, {
            status_code: '200',
            status: 'success',
            data: {
                trx_status: trxStatus
            }
        });

        assert.equal(result.statusKind, expectedStatus);
        assert.equal(result.shouldUnlock, false);
        assert.equal(result.shouldSendEmail, false);
        assert.equal(payment.status, expectedStatus);
    });
});
