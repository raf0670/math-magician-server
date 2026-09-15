const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../models/User');
const Payment = require('../models/Payment');
const EnrollmentDetail = require('../models/EnrollmentDetail');
let emails = 0;
require('../services/emailService').sendPaymentConfirmedEmail = async () => { emails++; };
const controller = require('../controllers/paymentController');
const userId = new mongoose.Types.ObjectId();
const form = {
    yourName: 'Test Student', email: 'test@example.com', emailAddress: 'test@example.com', address: 'Dhaka', phoneNumber: '01700000000',
    facebookProfile: 'https://facebook.com/test', college: 'Test College', group: 'Science', hscBatch: '2026 or equivalent',
    backupChoice: ['IBA JU'], admissionSystemIdea: 'Yes', preparationMethods: ['By myself'], mathFear: 'Time pressure', mathWeaknesses: ['Wrong approach']
};
let user; let payments; let details; let locked; let gatewayCalls; let gatewayAmounts; let failInitiation; let returnedAmount; let callbackStatus;
function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => value?.$in ? value.$in.some(v => String(v) === String(row[key])) : String(row[key]) === String(value));
}
function query(value) { return { select() { return this; }, sort() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; }
User.findById = () => query(user);
User.findOneAndUpdate = async () => { if (locked) return null; locked = true; return user; };
User.updateOne = async () => { locked = false; };
User.findByIdAndUpdate = async (_id, fields) => { user = { ...user, ...fields }; return user; };
Payment.find = filter => query(payments.filter(row => matches(row, filter)));
Payment.findOne = filter => query(payments.find(row => matches(row, filter)) || null);
Payment.create = async payload => {
    const row = { _id: new mongoose.Types.ObjectId(), ...payload, createdAt: new Date(), save: async () => {} };
    payments.push(row); return row;
};
EnrollmentDetail.create = async payload => { const row = { _id: new mongoose.Types.ObjectId(), ...payload }; details.push(row); return row; };
EnrollmentDetail.findOne = filter => query(details.find(row => matches(row, filter)) || null);
axios.post = async (url, body) => {
    const fields = new URLSearchParams(body);
    if (url.endsWith('/initiate-payment')) {
        gatewayCalls++;
        gatewayAmounts.push(Number(fields.get('payment_amount')));
        return { data: failInitiation ? { status: 'failed', message: 'Gateway unavailable' } : {
            status: 'success', status_code: '200', invoice_number: fields.get('invoice_number'),
            payment_amount: returnedAmount ?? fields.get('payment_amount'), payment_url: 'https://sandbox.paystation.com.bd/test-checkout'
        } };
    }
    const payment = payments.find(p => p.merchantInvoiceNumber === fields.get('invoice_number')) || payments.at(-1);
    return { data: { status_code: '200', data: { invoice_number: payment.merchantInvoiceNumber, trx_status: callbackStatus, payment_amount: returnedAmount ?? payment.amount } } };
};
beforeEach(() => {
    user = { _id: userId, role: 'student', email: 'test@example.com' };
    payments = []; details = []; locked = false; gatewayCalls = 0; gatewayAmounts = []; failInitiation = false; returnedAmount = null; callbackStatus = 'success'; emails = 0;
    Object.assign(process.env, { PAYSTATION_ENV: 'sandbox', PAYSTATION_SANDBOX_BASE_URL: 'https://sandbox.paystation.com.bd', PAYSTATION_SANDBOX_STORE_ID: 'test', PAYSTATION_SANDBOX_PASSWORD: 'test', PAYSTATION_CALLBACK_URL: 'https://example.com/callback' });
});
async function call(handler, body = {}, queryParams = {}) {
    const req = { user, body, query: queryParams };
    let response;
    const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { response = { status: this.code, ...payload }; return this; }, redirect(url) { response = { redirect: url }; } };
    await handler(req, res); return response;
}
function enrollment(extra = {}) { return { planId: 'math', formData: form, paymentChoice: 'full', expectedAmount: 5999, ...extra }; }
async function existingMath() {
    const payment = await Payment.create({ user: userId, planId: 'math', status: 'paid', amount: 5999, paymentChoice: 'full', paidAt: new Date('2026-09-01') });
    await EnrollmentDetail.create({ ...form, preferredBatch: 'Math Course', user: userId, payment: payment._id, planId: 'math', planTitle: 'Math Course' });
    return payment;
}
test('checkout ignores submitted prices, snapshots server discounts, and reuses matching pending checkout', async () => {
    const body = enrollment({ couponCode: 'MAGNUS500', expectedAmount: 5499, amount: 1, discountAmount: 5998 });
    const first = await call(controller.submitManualEnrollment, body);
    assert.equal(first.status, 201); assert.equal(payments[0].amount, 5499);
    assert.equal(payments[0].originalAmount, 5999); assert.equal(payments[0].discountAmount, 500);
    assert.equal(details[0].preferredBatch, 'Math Course'); assert.equal(user.hasMathAccess, undefined);
    const retry = await call(controller.submitManualEnrollment, body);
    assert.equal(retry.status, 200); assert.equal(String(retry.data.paymentId), String(first.data.paymentId));
    assert.equal(gatewayCalls, 1); assert.equal(payments.length, 1); assert.equal(locked, false);
});
const couponCases = [
    ['cadet20', 4799.20, 9598.40],
    ['fcc26', 4439.26, 8878.52],
    ...['zehad500', 'nasif500', 'sadat500', 'shuvro500', 'sajin500'].map(code => [code, 5499, 11498]),
    ['early67', 5329, 11328]
];
for (const [coupon, mathAmount, bundleAmount] of couponCases) {
    for (const [planId, originalAmount, amount] of [['math', 5999, mathAmount], ['mathSlytherin', 11998, bundleAmount]]) {
        test(`${coupon} ${planId} checkout stores and verifies the exact discounted gateway amount`, async () => {
            const body = enrollment({ planId, couponCode: `  ${coupon[0].toUpperCase()}${coupon.slice(1)}  `, expectedAmount: amount });
            const quote = await call(controller.getPaymentQuote, body);
            assert.equal(quote.status, 200);
            assert.equal(quote.data.amount, amount);
            assert.equal((await call(controller.submitManualEnrollment, { ...body, expectedAmount: 1 })).status, 409);
            assert.equal(gatewayCalls, 0);
            assert.equal((await call(controller.submitManualEnrollment, body)).status, 201);
            assert.deepEqual(gatewayAmounts, [amount]);
            assert.equal(payments[0].originalAmount, originalAmount);
            assert.equal(payments[0].amount, amount);
            assert.equal(payments[0].discountAmount, Number((originalAmount - amount).toFixed(2)));
            assert.equal(payments[0].discountType, 'coupon');
            assert.equal(payments[0].couponCode, coupon.toUpperCase());
            const callback = await call(controller.handlePaystationCallback, {}, { invoice_number: payments[0].merchantInvoiceNumber });
            assert.match(callback.redirect, /payment\/success/);
            assert.equal(payments[0].status, 'paid');
            assert.equal(user.hasMathAccess, true);
            assert.equal(user.hasClassAccess, planId === 'mathSlytherin');
        });
    }

}

test('cadet15 is rejected by quote and checkout endpoints without creating a payment', async () => {
    for (const planId of ['math', 'mathSlytherin']) {
        for (const couponCode of ['cadet15', 'CADET15', '  CaDeT15  ']) {
            const body = enrollment({ planId, couponCode });
            assert.equal((await call(controller.getPaymentQuote, body)).status, 400);
            assert.equal((await call(controller.submitManualEnrollment, body)).status, 400);
        }
    }
    assert.equal(gatewayCalls, 0);
    assert.equal(payments.length, 0);
});

test('already-issued cadet15 payments retain their original amount and discount on verification', async () => {
    const payment = await Payment.create({
        user: userId, planId: 'math', status: 'initiated', paymentMethod: 'paystation', paymentChoice: 'full',
        amount: 5099.15, paidAmount: 5099.15, originalAmount: 5999, discountAmount: 899.85,
        discountType: 'coupon', couponCode: 'CADET15', merchantInvoiceNumber: 'LEGACY-CADET15'
    });
    const callback = await call(controller.handlePaystationCallback, {}, { invoice_number: payment.merchantInvoiceNumber });
    assert.match(callback.redirect, /payment\/success/);
    assert.equal(payment.status, 'paid');
    assert.equal(payment.amount, 5099.15);
    assert.equal(payment.discountAmount, 899.85);
    assert.equal(payment.couponCode, 'CADET15');
    assert.equal(user.hasMathAccess, true);
    assert.equal(gatewayCalls, 0);
});

test('stale prices and concurrent checkouts are rejected before creating payment sessions', async () => {
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ expectedAmount: 1 }))).status, 409);
    locked = true;
    assert.equal((await call(controller.submitManualEnrollment, enrollment())).status, 409);
    assert.equal(gatewayCalls, 0);
});
test('failed gateway initiation releases the lock and allows a fresh retry', async () => {
    failInitiation = true;
    assert.equal((await call(controller.submitManualEnrollment, enrollment())).status, 502);
    assert.equal(locked, false); assert.equal(payments[0].status, 'failed');
    failInitiation = false;
    assert.equal((await call(controller.submitManualEnrollment, enrollment())).status, 201);
    assert.equal(gatewayCalls, 2);
});
test('partial payments, invalid forms, and silently rounded gateway amounts cannot start math checkout', async () => {
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ paymentChoice: 'partial' }))).status, 400);
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ formData: { ...form, mathFear: '' } }))).status, 400);
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ formData: { ...form, group: 'Invalid' } }))).status, 400);
    assert.equal(gatewayCalls, 0);
    returnedAmount = 60;
    const result = await call(controller.submitManualEnrollment, enrollment({ couponCode: '7a597883', expectedAmount: 59.99 }));
    assert.equal(result.status, 502); assert.equal(payments.at(-1).status, 'failed');
    assert.match(result.message, /exact course price/);
});
test('approved house students get the automatic discount and cannot buy the bundle', async () => {
    user.house = 'Gryffindor';
    await Payment.create({ user: userId, planId: 'offline', status: 'approved', paymentChoice: 'partial', remainingAmount: 8000 });
    const result = await call(controller.submitManualEnrollment, enrollment({ expectedAmount: 4499.25 }));
    assert.equal(result.status, 201); assert.equal(payments.at(-1).amount, 4499.25); assert.equal(user.house, 'Gryffindor');
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ planId: 'mathSlytherin', expectedAmount: 11998 }))).status, 400);
});
test('fcc26 beats the automatic house discount and is stored through checkout', async () => {
    user.house = 'Gryffindor';
    await Payment.create({ user: userId, planId: 'offline', status: 'approved', paymentChoice: 'partial', remainingAmount: 8000 });
    const body = enrollment({ couponCode: '  FcC26  ', expectedAmount: 4439.26 });
    const quote = await call(controller.getPaymentQuote, body);
    assert.equal(quote.status, 200);
    assert.equal(quote.data.amount, 4439.26);
    assert.equal(quote.data.discountAmount, 1559.74);
    assert.equal(quote.data.discountType, 'coupon');
    assert.equal(quote.data.couponCode, 'FCC26');
    const result = await call(controller.submitManualEnrollment, body);
    const mathPayment = payments.at(-1);
    assert.equal(result.status, 201);
    assert.equal(mathPayment.originalAmount, 5999);
    assert.equal(mathPayment.amount, 4439.26);
    assert.equal(mathPayment.discountAmount, 1559.74);
    assert.equal(mathPayment.discountType, 'coupon');
    assert.equal(mathPayment.couponCode, 'FCC26');
    assert.deepEqual(gatewayAmounts, [4439.26]);
    await call(controller.handlePaystationCallback, {}, { invoice_number: mathPayment.merchantInvoiceNumber });
    assert.equal(mathPayment.status, 'paid');
    assert.equal(user.hasMathAccess, true);
    assert.equal(user.house, 'Gryffindor');
});
test('upgrade reuses paid math enrollment details, forbids coupons and duplicate purchases', async () => {
    await existingMath();
    assert.equal((await call(controller.submitManualEnrollment, enrollment())).status, 409);
    const result = await call(controller.submitManualEnrollment, enrollment({ planId: 'slytherinUpgrade', formData: undefined }));
    assert.equal(result.status, 201); assert.equal(details.at(-1).mathFear, form.mathFear); assert.equal(details.at(-1).preferredBatch, 'Slytherin');
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ planId: 'slytherinUpgrade', couponCode: 'MAGNUS500' }))).status, 400);
    assert.equal((await call(controller.submitManualEnrollment, enrollment({ planId: 'slytherinUpgrade', couponCode: 'fcc26' }))).status, 400);
});
test('verified callbacks grant only math access, repeated callbacks do not resend email, and refunds remove access', async () => {
    await call(controller.submitManualEnrollment, enrollment());
    const invoice = payments[0].merchantInvoiceNumber;
    const first = await call(controller.handlePaystationCallback, {}, { invoice_number: invoice });
    assert.match(first.redirect, /payment\/success/); assert.match(first.redirect, /plan=math/);
    assert.equal(user.hasMathAccess, true); assert.equal(user.hasClassAccess, false); assert.equal(user.house, '');
    assert.equal(emails, 1);
    await call(controller.handlePaystationCallback, {}, { invoice_number: invoice });
    assert.equal(emails, 1);
    callbackStatus = 'refund';
    await call(controller.handlePaystationCallback, {}, { invoice_number: invoice });
    assert.equal(user.hasMathAccess, false); assert.equal(user.hasClassAccess, false);
});
test('bundle verification grants both permissions while mismatched callback amounts grant none', async () => {
    await call(controller.submitManualEnrollment, enrollment({ planId: 'mathSlytherin', expectedAmount: 11998 }));
    const invoice = payments[0].merchantInvoiceNumber;
    returnedAmount = 5999;
    const bad = await call(controller.handlePaystationCallback, {}, { invoice_number: invoice });
    assert.match(bad.redirect, /payment\/failed/); assert.equal(user.hasClassAccess, undefined);
    returnedAmount = 11998;
    await call(controller.handlePaystationCallback, {}, { invoice_number: invoice });
    assert.equal(user.hasClassAccess, true); assert.equal(user.hasMathAccess, true); assert.equal(user.house, 'Slytherin');
});
