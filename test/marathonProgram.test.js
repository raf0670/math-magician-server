const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { calculateMarathonQuote, getAvailableMarathonPlanIds, hasConsumedMarathonCoupon, isReturningStudentEligible, normalizeCouponCode } = require('../services/marathonPricingService');
const { deriveProgramAccess } = require('../services/programAccessService');
const { _private: marathonLinkValidation, getMarathonDashboard } = require('../controllers/marathonController');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const Payment = require('../models/Payment');
const User = require('../models/User');
const MarathonLink = require('../models/MarathonLink');

function paid(planId, date = '2026-06-01T12:00:00.000Z', extra = {}) {
    return { _id: new mongoose.Types.ObjectId(), planId, status: 'paid', paidAt: new Date(date), paymentChoice: 'full', ...extra };
}

test('Marathon pricing applies the 25% returning-student discount to every purchase shape', () => {
    for (const [planId, originalAmount, discountedAmount] of [
        ['marathonEnglish', 1200, 900],
        ['marathonMaths', 1200, 900],
        ['marathonBoth', 2000, 1500]
    ]) {
        const regular = calculateMarathonQuote(planId, {}, false);
        const returning = calculateMarathonQuote(planId, {}, true);
        assert.equal(regular.amount, originalAmount);
        assert.equal(returning.originalAmount, originalAmount);
        assert.equal(returning.amount, discountedAmount);
        assert.equal(returning.discountAmount, originalAmount - discountedAmount);
        assert.equal(returning.discountType, 'returningStudent');
    }
});

test('section upgrades charge only the bundle difference and enforce the access matrix', () => {
    assert.deepEqual(getAvailableMarathonPlanIds([]), ['marathonEnglish', 'marathonMaths', 'marathonBoth']);
    assert.deepEqual(getAvailableMarathonPlanIds(['english']), ['marathonAddMaths']);
    assert.deepEqual(getAvailableMarathonPlanIds(['maths']), ['marathonAddEnglish']);
    assert.deepEqual(getAvailableMarathonPlanIds(['english', 'maths']), []);
    assert.equal(calculateMarathonQuote('marathonAddMaths', { marathonSections: ['english'] }, false).amount, 800);
    assert.equal(calculateMarathonQuote('marathonAddMaths', { marathonSections: ['english'] }, true).amount, 600);
    assert.throws(() => calculateMarathonQuote('marathonMaths', { marathonSections: ['english'] }), /available Marathon option/);
    assert.throws(() => calculateMarathonQuote('marathonBoth', { marathonSections: ['english', 'maths'] }), /already have access/);
});

test('all Marathon coupons give a non-stacking BDT 200 discount across every purchase shape', () => {
    for (const couponCode of ['magnusbest200', 'magnus200', 'zehadvybest', 'tetrisbest']) {
        for (const [planId, access, expectedAmount] of [
            ['marathonEnglish', {}, 1000],
            ['marathonMaths', {}, 1000],
            ['marathonBoth', {}, 1800],
            ['marathonAddMaths', { marathonSections: ['english'] }, 600],
            ['marathonAddEnglish', { marathonSections: ['maths'] }, 600]
        ]) {
            const quote = calculateMarathonQuote(planId, access, false, { couponCode: ` ${couponCode} `, discountPreference: 'coupon' });
            assert.equal(quote.amount, expectedAmount);
            assert.equal(quote.discountAmount, 200);
            assert.equal(quote.discountType, 'coupon');
            assert.equal(quote.couponCode, couponCode.toUpperCase());
        }
    }
    const returning = calculateMarathonQuote('marathonBoth', {}, true, { couponCode: 'MAGNUSBEST200', discountPreference: 'returning' });
    assert.equal(returning.amount, 1500);
    assert.equal(returning.discountType, 'returningStudent');
    assert.equal(returning.couponCode, '');
});

test('Marathon coupon validation normalizes text and rejects invalid or consumed codes', () => {
    assert.equal(normalizeCouponCode('  magnusbest200 '), 'MAGNUSBEST200');
    assert.equal(normalizeCouponCode('  magnus200 '), 'MAGNUS200');
    assert.equal(normalizeCouponCode('  zehadvybest '), 'ZEHADVYBEST');
    assert.equal(normalizeCouponCode('  tetrisbest '), 'TETRISBEST');
    assert.throws(() => calculateMarathonQuote('marathonEnglish', {}, false, { couponCode: 'wrong', discountPreference: 'coupon' }), /Invalid Marathon coupon/);
    assert.throws(() => calculateMarathonQuote('marathonEnglish', {}, false, { couponCode: 'MAGNUS200,ZEHADVYBEST', discountPreference: 'coupon' }), /Invalid Marathon coupon/);
    for (const couponCode of ['MAGNUSBEST200', 'MAGNUS200', 'ZEHADVYBEST', 'TETRISBEST']) {
        assert.throws(() => calculateMarathonQuote('marathonEnglish', {}, false, { couponCode, discountPreference: 'coupon', couponConsumed: true }), /already been used/);
    }
    assert.throws(() => calculateMarathonQuote('marathonEnglish', {}, false, { discountPreference: 'returning' }), /not available/);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'MAGNUSBEST200', status: 'failed' }]), false);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'MAGNUS200', status: 'failed' }]), false);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'ZEHADVYBEST', status: 'failed' }]), false);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'TETRISBEST', status: 'failed' }]), false);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'magnusbest200', status: 'refund', paidAt: new Date() }]), true);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'magnus200', status: 'paid' }]), true);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'zehadvybest', status: 'approved' }]), true);
    assert.equal(hasConsumedMarathonCoupon([{ couponCode: 'tetrisbest', status: 'paid' }]), true);
});

test('returning eligibility uses paid non-Marathon records in the 2026 Dhaka calendar year', () => {
    assert.equal(isReturningStudentEligible([paid('math', '2025-12-31T18:00:00.000Z')]), true);
    assert.equal(isReturningStudentEligible([paid('premium', '2026-12-31T17:59:59.999Z')]), true);
    assert.equal(isReturningStudentEligible([paid('math', '2025-12-31T17:59:59.999Z')]), false);
    assert.equal(isReturningStudentEligible([paid('math', '2026-12-31T18:00:00.000Z')]), false);
    assert.equal(isReturningStudentEligible([paid('marathonEnglish')]), false);
    assert.equal(isReturningStudentEligible([paid('marathonEnglish', undefined, { discountType: 'returningStudent' })]), true);
    assert.equal(isReturningStudentEligible([paid('math', undefined, { status: 'refund' })]), false);
    assert.equal(isReturningStudentEligible([{ planId: 'offline', status: 'approved', reviewedAt: new Date('2026-03-01') }]), true);
});

test('Marathon payments derive only their purchased sections and never grant general or Math access', () => {
    for (const [plans, sections] of [
        [['marathonEnglish'], ['english']],
        [['marathonMaths'], ['maths']],
        [['marathonBoth'], ['english', 'maths']],
        [['marathonEnglish', 'marathonAddMaths'], ['english', 'maths']],
        [['marathonMaths', 'marathonAddEnglish'], ['maths', 'english']]
    ]) {
        const access = deriveProgramAccess({}, plans.map(planId => paid(planId)));
        assert.deepEqual(access.marathonSections, sections);
        assert.equal(access.hasClassAccess, false);
        assert.equal(access.hasMathAccess, false);
    }
    assert.deepEqual(deriveProgramAccess({}, [paid('marathonBoth', undefined, { status: 'refund' })]).marathonSections, []);
});

test('Marathon enrollment metadata and secure link validation accept the intended values', async () => {
    assert.ok(EnrollmentDetail.schema.path('preferredBatch').enumValues.includes('Marathon'));
    assert.ok(Payment.schema.path('discountType').enumValues.includes('returningStudent'));
    assert.equal(marathonLinkValidation.isHttpsUrl('https://meet.google.com/example'), true);
    assert.equal(marathonLinkValidation.isHttpsUrl('http://example.com/class'), false);
    assert.equal(marathonLinkValidation.isHttpsUrl('not-a-url'), false);
});

test('student Marathon API returns class and Messenger links only for entitled sections while admins see both', async () => {
    const userId = new mongoose.Types.ObjectId();
    let payments = [{ ...paid('marathonEnglish'), user: userId }];
    const links = [
        { section: 'english', url: 'https://example.com/english', isPublished: true, updatedAt: new Date() },
        { section: 'maths', url: 'https://example.com/maths', isPublished: true, updatedAt: new Date() }
    ];
    function query(value) {
        return { select() { return this; }, sort() { return this; }, populate() { return this; }, lean: async () => value };
    }
    User.findById = () => query({ _id: userId, role: 'student' });
    Payment.find = () => query(payments);
    MarathonLink.find = () => query(links);

    async function call(user) {
        let response;
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { response = { status: this.statusCode, body }; return this; } };
        await getMarathonDashboard({ user }, res);
        return response;
    }

    const student = await call({ _id: userId, role: 'student' });
    assert.equal(student.status, 200);
    assert.equal(student.body.data.sections.find(section => section.id === 'english').joinUrl, 'https://example.com/english');
    assert.equal(student.body.data.sections.find(section => section.id === 'maths').joinUrl, null);
    assert.equal(student.body.data.sections.find(section => section.id === 'english').messengerGroupUrl, 'https://m.me/j/lakgQkQoKfW3W0XM/?send_source=gc:copy_invite_link_c');
    assert.equal(student.body.data.sections.find(section => section.id === 'maths').messengerGroupUrl, null);

    payments = [{ ...paid('marathonMaths'), user: userId }];
    const mathsStudent = await call({ _id: userId, role: 'student' });
    assert.equal(mathsStudent.body.data.sections.find(section => section.id === 'english').messengerGroupUrl, null);
    assert.equal(mathsStudent.body.data.sections.find(section => section.id === 'maths').messengerGroupUrl, 'https://m.me/j/H5kf04ICYCIH5p0Z/?send_source=gc:copy_invite_link_c');

    payments = [{ ...paid('marathonBoth'), user: userId }];
    const bothStudent = await call({ _id: userId, role: 'student' });
    assert.equal(bothStudent.body.data.sections.every(section => Boolean(section.messengerGroupUrl)), true);

    payments = [];
    const unenrolledStudent = await call({ _id: userId, role: 'student' });
    assert.equal(unenrolledStudent.body.data.sections.every(section => section.messengerGroupUrl === null), true);

    const admin = await call({ _id: userId, role: 'admin' });
    assert.deepEqual(admin.body.data.sections.map(section => section.joinUrl), ['https://example.com/english', 'https://example.com/maths']);
    assert.equal(admin.body.data.sections.every(section => Boolean(section.messengerGroupUrl)), true);
});
