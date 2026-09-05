const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getPaystationConfig,
    initiatePayment,
    queryTransactionStatus,
    _private
} = require('../services/paystationService');

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PAYSTATION_ENV;
    delete process.env.PAYSTATION_SANDBOX_BASE_URL;
    delete process.env.PAYSTATION_SANDBOX_STORE_ID;
    delete process.env.PAYSTATION_SANDBOX_PASSWORD;
    delete process.env.PAYSTATION_LIVE_BASE_URL;
    delete process.env.PAYSTATION_LIVE_STORE_ID;
    delete process.env.PAYSTATION_LIVE_PASSWORD;
    delete process.env.PAYSTATION_CALLBACK_URL;
    delete process.env.PAYSTATION_PAY_WITH_CHARGE;
    delete process.env.PAYSTATION_EMI;
}

function setSandboxEnv() {
    resetEnv();
    process.env.PAYSTATION_ENV = 'sandbox';
    process.env.PAYSTATION_SANDBOX_BASE_URL = 'https://sandbox.paystation.com.bd/';
    process.env.PAYSTATION_SANDBOX_STORE_ID = 'sandbox-store';
    process.env.PAYSTATION_SANDBOX_PASSWORD = 'sandbox-password';
    process.env.PAYSTATION_CALLBACK_URL = 'http://localhost:5000/api/payments/paystation/callback';
    process.env.PAYSTATION_PAY_WITH_CHARGE = '1';
}

test.afterEach(resetEnv);

test('paystation config selects sandbox by default and validates required env values', () => {
    setSandboxEnv();

    assert.deepEqual(getPaystationConfig(), {
        environment: 'sandbox',
        baseURL: 'https://sandbox.paystation.com.bd',
        storeId: 'sandbox-store',
        password: 'sandbox-password',
        callbackURL: 'http://localhost:5000/api/payments/paystation/callback',
        payWithCharge: 1,
        emi: 0
    });

    resetEnv();
    assert.throws(
        () => getPaystationConfig(),
        /Missing PayStation environment values: PAYSTATION_SANDBOX_BASE_URL/
    );
});

test('paystation config selects live credentials when enabled', () => {
    resetEnv();
    process.env.PAYSTATION_ENV = 'live';
    process.env.PAYSTATION_LIVE_BASE_URL = 'https://api.paystation.com.bd';
    process.env.PAYSTATION_LIVE_STORE_ID = 'live-store';
    process.env.PAYSTATION_LIVE_PASSWORD = 'live-password';
    process.env.PAYSTATION_CALLBACK_URL = 'https://api.example.com/api/payments/paystation/callback';
    process.env.PAYSTATION_PAY_WITH_CHARGE = 'yes';
    process.env.PAYSTATION_EMI = 'true';

    const config = getPaystationConfig();

    assert.equal(config.environment, 'live');
    assert.equal(config.baseURL, 'https://api.paystation.com.bd');
    assert.equal(config.storeId, 'live-store');
    assert.equal(config.password, 'live-password');
    assert.equal(config.payWithCharge, 1);
    assert.equal(config.emi, 1);
});

test('initiate paystation payment sends hosted checkout payload in BDT', async () => {
    setSandboxEnv();
    const calls = [];
    const httpClient = {
        post: async (...args) => {
            calls.push(args);
            return {
                data: {
                    status_code: 200,
                    status: 'success',
                    payment_url: 'https://sandbox.paystation.com.bd/pay/abc'
                }
            };
        }
    };

    const response = await initiatePayment({
        invoiceNumber: 'MMS-001',
        amount: 10000,
        customer: {
            name: 'Student',
            phone: '01800000000',
            email: 'student@example.com',
            address: 'Farmgate'
        },
        reference: 'Gryffindor partial payment',
        checkoutItems: {
            planId: 'offline',
            paidAmount: 10000
        }
    }, httpClient);

    assert.equal(response.payment_url, 'https://sandbox.paystation.com.bd/pay/abc');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'https://sandbox.paystation.com.bd/initiate-payment');

    const body = calls[0][1];
    assert.equal(body.get('merchantId'), 'sandbox-store');
    assert.equal(body.get('password'), 'sandbox-password');
    assert.equal(body.get('invoice_number'), 'MMS-001');
    assert.equal(body.get('currency'), 'BDT');
    assert.equal(body.get('payment_amount'), '10000');
    assert.equal(body.get('pay_with_charge'), '1');
    assert.equal(body.get('cust_name'), 'Student');
    assert.equal(body.get('cust_phone'), '01800000000');
    assert.equal(body.get('cust_email'), 'student@example.com');
    assert.equal(body.get('cust_address'), 'Farmgate');
    assert.equal(body.get('callback_url'), 'http://localhost:5000/api/payments/paystation/callback');
    assert.equal(JSON.parse(body.get('checkout_items')).planId, 'offline');

    assert.deepEqual(calls[0][2].headers, {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
    });
});

test('query transaction status uses v1 invoice endpoint when transaction id is missing', async () => {
    setSandboxEnv();
    const calls = [];
    const httpClient = {
        post: async (...args) => {
            calls.push(args);
            return { data: { status: 'success' } };
        }
    };

    const response = await queryTransactionStatus({ invoiceNumber: 'MMS-001' }, httpClient);

    assert.deepEqual(response, { status: 'success' });
    assert.equal(calls[0][0], 'https://sandbox.paystation.com.bd/transaction-status');
    assert.equal(calls[0][1].get('invoice_number'), 'MMS-001');
    assert.equal(calls[0][2].headers.merchantId, 'sandbox-store');
});

test('query transaction status uses v2 transaction endpoint when transaction id exists', async () => {
    setSandboxEnv();
    const calls = [];
    const httpClient = {
        post: async (...args) => {
            calls.push(args);
            return { data: { status: 'success' } };
        }
    };

    await queryTransactionStatus({ invoiceNumber: 'MMS-001', trxId: 'TRX-001' }, httpClient);

    assert.equal(calls[0][0], 'https://sandbox.paystation.com.bd/v2/transaction-status');
    assert.deepEqual(calls[0][1], { trxId: 'TRX-001' });
    assert.equal(calls[0][2].headers.merchantId, 'sandbox-store');
});

test('paystation helper normalizes boolean flags and checkout item payloads', () => {
    assert.equal(_private.getBooleanFlag('on'), 1);
    assert.equal(_private.getBooleanFlag('false'), 0);
    assert.equal(_private.normalizeCheckoutItems('plain'), 'plain');
    assert.equal(_private.normalizeCheckoutItems({ a: 1 }), '{"a":1}');
});
