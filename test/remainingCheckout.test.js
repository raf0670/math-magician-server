const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../models/User');
const Payment = require('../models/Payment');
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

    return {
        data: {
            status_code: '200',
            data: {
                invoice_number: payment.finalMerchantInvoiceNumber,
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
