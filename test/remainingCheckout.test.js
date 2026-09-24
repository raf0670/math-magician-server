const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PaystationCheckoutAttempt = require('../models/PaystationCheckoutAttempt');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const SeatBooking = require('../models/SeatBooking');

require('../services/emailService').sendPaymentConfirmedEmail = async () => {};
const controller = require('../controllers/paymentController');

const userId = new mongoose.Types.ObjectId();
const paymentId = new mongoose.Types.ObjectId();
let user;
let payment;
let gatewayCalls;
let gatewayAmounts;
let callbackStatus;
let checkoutLocked;
let attempts;
let statusError;

function matches(row, filter) {
    if (!row) return false;
    return Object.entries(filter).every(([key, expected]) => {
        if (key === '$or') return expected.some((entry) => matches(row, entry));
        const actual = row[key];
        if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
            if (expected.$in) return expected.$in.some((value) => String(value) === String(actual));
            if (expected.$gt !== undefined) return Number(actual) > Number(expected.$gt);
            if (expected.$lte !== undefined) return new Date(actual || 0) <= new Date(expected.$lte);
            if (expected.$exists !== undefined) return expected.$exists === (actual !== undefined);
        }
        return String(actual) === String(expected);
    });
}

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        lean: async () => value,
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
    };
}

User.findById = () => query(user);
User.findByIdAndUpdate = async (_id, fields) => {
    user = { ...user, ...fields };
    return user;
};
Payment.findById = () => query(payment);
Payment.findOne = (filter) => query(matches(payment, filter) ? payment : null);
Payment.findOneAndUpdate = async (_filter, update) => {
    if (checkoutLocked) return null;
    checkoutLocked = true;
    Object.assign(payment, update.$set || {});
    return payment;
};
PaystationCheckoutAttempt.findOne = (filter) => query(attempts.find((row) => matches(row, filter)) || null);
PaystationCheckoutAttempt.create = async (payload) => {
    const row = { _id: new mongoose.Types.ObjectId(), ...payload, createdAt: new Date(), save: async () => {} };
    attempts.push(row);
    return row;
};
EnrollmentDetail.findOne = () => query({
    yourName: 'Partial Student',
    emailAddress: 'partial@example.com',
    phoneNumber: '01700000000',
    address: 'Dhaka'
});
SeatBooking.findOne = () => query(null);

axios.post = async (url, body) => {
    if (url.endsWith('/initiate-payment')) {
        const fields = new URLSearchParams(body);
        gatewayCalls += 1;
        gatewayAmounts.push(Number(fields.get('payment_amount')));
        return {
            data: {
                status: 'success',
                status_code: '200',
                invoice_number: fields.get('invoice_number'),
                payment_amount: fields.get('payment_amount'),
                payment_url: 'https://sandbox.paystation.com.bd/final-checkout'
            }
        };
    }

    if (statusError) throw new Error('Status API unavailable');
    const fields = new URLSearchParams(body);
    const queriedInvoice = body instanceof URLSearchParams ? fields.get('invoice_number') : '';

    return {
        data: {
            status_code: '200',
            data: {
                ...(queriedInvoice ? { invoice_number: queriedInvoice } : {}),
                trx_status: callbackStatus,
                trx_id: 'FINAL-TRX-1',
                payment_amount: payment.finalPaidAmount
            }
        }
    };
};

beforeEach(() => {
    user = {
        _id: userId,
        role: 'student',
        name: 'Partial Student',
        email: 'partial@example.com',
        house: 'Gryffindor',
        hasClassAccess: true,
        paymentStatus: 'partiallyPaid'
    };
    payment = {
        _id: paymentId,
        user: userId,
        planId: 'offline',
        planTitle: 'Gryffindor',
        amount: 18000,
        paidAmount: 10000,
        remainingAmount: 8000,
        paymentChoice: 'partial',
        paymentMethod: 'paystation',
        provider: 'paystation',
        status: 'paid',
        currency: 'BDT',
        merchantInvoiceNumber: 'MMS-INITIAL-1',
        createdAt: new Date('2026-09-01'),
        save: async () => {}
    };
    gatewayCalls = 0;
    gatewayAmounts = [];
    callbackStatus = 'success';
    checkoutLocked = false;
    attempts = [];
    statusError = false;
    Payment.find = (filter) => query(matches(payment, filter) ? [payment] : []);
    Object.assign(process.env, {
        PAYSTATION_ENV: 'sandbox',
        PAYSTATION_SANDBOX_BASE_URL: 'https://sandbox.paystation.com.bd',
        PAYSTATION_SANDBOX_STORE_ID: 'test',
        PAYSTATION_SANDBOX_PASSWORD: 'test',
        PAYSTATION_CALLBACK_URL: 'https://example.com/callback',
        FRONTEND_URL: 'https://example.com'
    });
});

async function call(handler, body = {}, queryParams = {}) {
    const req = { user, body, query: queryParams };
    let response;
    const res = {
        code: 200,
        status(code) { this.code = code; return this; },
        json(payload) { response = { status: this.code, ...payload }; return this; },
        redirect(url) { response = { redirect: url }; return this; }
    };
    await handler(req, res);
    return response;
}

test('remaining checkout ignores client amounts and reuses the verified server-priced checkout', async () => {
    const first = await call(controller.submitRemainingCheckout, { amount: 1, remainingAmount: 1 });
    assert.equal(first.status, 201);
    assert.equal(first.data.remainingAmount, 8000);
    assert.equal(first.data.paymentUrl, 'https://sandbox.paystation.com.bd/final-checkout');
    assert.deepEqual(gatewayAmounts, [8000]);

    const second = await call(controller.submitRemainingCheckout, { amount: 999999 });
    assert.equal(second.status, 200);
    assert.equal(second.data.invoice, first.data.invoice);
    assert.equal(gatewayCalls, 1);
});

test('payment access exposes the verified historical remaining balance', async () => {
    const access = await call(controller.getPaymentAccess);
    assert.equal(access.status, 200);
    assert.equal(access.data.hasClassAccess, true);
    assert.equal(access.data.paymentStatus, 'partiallyPaid');
    assert.deepEqual(access.data.remainingPayment, {
        paymentId,
        planId: 'offline',
        planTitle: 'Gryffindor',
        totalAmount: 18000,
        paidAmount: 10000,
        remainingAmount: 8000,
        currency: 'BDT'
    });
});

test('general suspension blocks re-enrollment and remaining-payment checkout without changing the payment', async () => {
    user.generalAccessSuspended = true;
    const originalStatus = payment.status;
    const originalPaidAmount = payment.paidAmount;

    const enrollmentGuard = await call(controller._private.rejectExistingGeneralEnrollment);
    assert.equal(enrollmentGuard.status, 403);
    assert.match(enrollmentGuard.message, /suspended/i);

    const checkout = await call(controller.submitRemainingCheckout);
    assert.equal(checkout.status, 403);
    assert.match(checkout.message, /suspended/i);
    assert.equal(payment.status, originalStatus);
    assert.equal(payment.paidAmount, originalPaidAmount);
});

test('verified final callback marks fully paid and a refund restores partial access', async () => {
    const checkout = await call(controller.submitRemainingCheckout);
    assert.equal(checkout.status, 201);

    const paid = await call(controller.handlePaystationCallback, {}, { invoice_number: payment.finalMerchantInvoiceNumber });
    assert.match(paid.redirect, /paymentStage=final/);
    assert.equal(payment.remainingAmount, 0);
    assert.equal(user.hasClassAccess, true);
    assert.equal(user.paymentStatus, 'fullyPaid');

    callbackStatus = 'refund';
    const refunded = await call(controller.handlePaystationCallback, {}, { invoice_number: payment.finalMerchantInvoiceNumber });
    assert.match(refunded.redirect, /payment\/failed/);
    assert.equal(payment.remainingAmount, 8000);
    assert.equal(user.hasClassAccess, true);
    assert.equal(user.paymentStatus, 'partiallyPaid');
});

test('remaining checkout rejects fully paid and ambiguous students', async () => {
    payment.remainingAmount = 0;
    payment.fullyPaidAt = new Date();
    user.paymentStatus = 'fullyPaid';
    const fullyPaid = await call(controller.submitRemainingCheckout);
    assert.equal(fullyPaid.status, 409);

    payment.remainingAmount = 8000;
    payment.fullyPaidAt = undefined;
    user.paymentStatus = 'partiallyPaid';
    Payment.find = (filter) => query(matches(payment, filter) ? [payment, { ...payment, _id: new mongoose.Types.ObjectId() }] : []);
    const ambiguous = await call(controller.submitRemainingCheckout);
    assert.equal(ambiguous.status, 409);
    assert.match(ambiguous.message, /Multiple outstanding/);
});

test('an expired processing checkout is superseded and replaced with a fresh URL', async () => {
    const first = await call(controller.submitRemainingCheckout);
    attempts[0].expiresAt = new Date(Date.now() - 1000);
    checkoutLocked = false;
    callbackStatus = 'processing';

    const replacement = await call(controller.submitRemainingCheckout);
    assert.equal(replacement.status, 201);
    assert.equal(replacement.data.reused, false);
    assert.equal(replacement.data.alreadyPaid, false);
    assert.notEqual(replacement.data.invoice, first.data.invoice);
    assert.equal(gatewayCalls, 2);
    assert.ok(attempts[0].supersededAt);
    assert.equal(attempts.length, 2);
});

test('an expired checkout already paid at PayStation settles without opening another URL', async () => {
    await call(controller.submitRemainingCheckout);
    attempts[0].expiresAt = new Date(Date.now() - 1000);
    checkoutLocked = false;
    callbackStatus = 'success';

    const result = await call(controller.submitRemainingCheckout);
    assert.equal(result.status, 200);
    assert.equal(result.data.alreadyPaid, true);
    assert.equal(result.data.paymentUrl, '');
    assert.equal(gatewayCalls, 1);
    assert.equal(payment.remainingAmount, 0);
    assert.equal(user.paymentStatus, 'fullyPaid');
});

test('status API outages return 503 without replacing or superseding the expired checkout', async () => {
    await call(controller.submitRemainingCheckout);
    attempts[0].expiresAt = new Date(Date.now() - 1000);
    checkoutLocked = false;
    statusError = true;

    const result = await call(controller.submitRemainingCheckout);
    assert.equal(result.status, 503);
    assert.match(result.message, /could not verify/);
    assert.equal(gatewayCalls, 1);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].supersededAt, undefined);
});

test('a delayed success settles once and a later successful attempt is flagged for review', async () => {
    const first = await call(controller.submitRemainingCheckout);
    attempts[0].expiresAt = new Date(Date.now() - 1000);
    checkoutLocked = false;
    callbackStatus = 'processing';
    const second = await call(controller.submitRemainingCheckout);

    callbackStatus = 'success';
    const settled = await call(controller.handlePaystationCallback, {}, { invoice_number: first.data.invoice });
    assert.match(settled.redirect, /payment\/success/);
    const duplicate = await call(controller.handlePaystationCallback, {}, { invoice_number: second.data.invoice });
    assert.match(duplicate.redirect, /review=duplicate-success/);
    assert.equal(attempts[1].duplicateSuccess, true);
    assert.equal(attempts[1].reviewRequired, true);
    assert.equal(payment.remainingAmount, 0);
});
