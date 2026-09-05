const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMathQuote } = require('../services/mathPricingService');
const { deriveProgramAccess } = require('../services/programAccessService');
const { programFilter, canAccessProgram } = require('../config/programs');
const { buildRankInfoMapFromSubmissions, isPenaltyEligibleForMembership } = require('../services/rankService');
const { _private: exams } = require('../controllers/examController');
const { _private: payments } = require('../controllers/paymentController');
const EnrollmentDetail = require('../models/EnrollmentDetail');
const { initiatePayment } = require('../services/paystationService');

function paid(planId, extra = {}) { return { planId, status: 'paid', paymentChoice: 'full', paidAt: new Date('2026-09-05T12:00:00Z'), ...extra }; }

test('access matrix separates math from general website and retains original houses', () => {
    for (const [plans, general, math, house] of [
        [[], false, false, ''], [['math'], false, true, ''], [['mathSlytherin'], true, true, 'Slytherin'],
        [['offline'], true, false, 'Gryffindor'], [['offline', 'math'], true, true, 'Gryffindor'],
        [['premium', 'math'], true, true, 'Ravenclaw'], [['online', 'math'], true, true, 'Hufflepuff'],
        [['gryffindor2', 'math'], true, true, 'Gryffindor'], [['math', 'slytherinUpgrade'], true, true, 'Slytherin']
    ]) {
        const access = deriveProgramAccess({}, plans.map(id => paid(id)));
        assert.equal(access.hasClassAccess, general, plans.join(','));
        assert.equal(access.hasMathAccess, math, plans.join(','));
        assert.equal(access.house, house, plans.join(','));
        assert.equal(canAccessProgram(access, 'general'), general);
        assert.equal(canAccessProgram(access, 'math'), math);
    }
});
test('pending, rejected, refunded, and booked-only memberships grant neither access nor discounts', () => {
    for (const status of ['pending', 'initiated', 'processing', 'failed', 'cancelled', 'rejected', 'refund']) {
        const access = deriveProgramAccess({ house: 'Gryffindor', hasBooked: true }, [paid('offline', { status }), paid('math', { status })]);
        assert.equal(access.existingHouseEligible, false);
        assert.equal(access.hasClassAccess, false);
        assert.equal(access.hasMathAccess, false);
    }
});
test('math payment preserves house membership and partially-paid general balance status', () => {
    const house = paid('offline', { status: 'approved', paymentChoice: 'partial', remainingAmount: 8000 });
    const access = deriveProgramAccess({ house: 'Gryffindor' }, [house, paid('math')]);
    assert.equal(access.paymentStatus, 'partiallyPaid');
    assert.equal(access.mathPaymentStatus, 'fullyPaid');
    assert.equal(access.existingHouseEligible, true);
    assert.equal(house.remainingAmount, 8000);
    assert.equal(access.generalAccessStartsAt, null);
});
test('upgrade starts general access at its payment date and preserves math start date', () => {
    const mathDate = new Date('2026-09-05'); const upgradeDate = new Date('2026-09-10');
    const access = deriveProgramAccess({}, [paid('math', { paidAt: mathDate }), paid('slytherinUpgrade', { paidAt: upgradeDate })]);
    assert.deepEqual(access.mathAccessStartsAt, mathDate);
    assert.deepEqual(access.generalAccessStartsAt, upgradeDate);
});
test('revoking one purchase preserves access from the other active purchase', () => {
    const mathRevoked = deriveProgramAccess({ house: 'Ravenclaw' }, [paid('premium'), paid('math', { status: 'refund' })]);
    assert.equal(mathRevoked.hasClassAccess, true); assert.equal(mathRevoked.hasMathAccess, false);
    const upgradeRevoked = deriveProgramAccess({ house: 'Slytherin' }, [paid('math'), paid('slytherinUpgrade', { status: 'rejected' })]);
    assert.equal(upgradeRevoked.hasClassAccess, false); assert.equal(upgradeRevoked.hasMathAccess, true); assert.equal(upgradeRevoked.house, '');
});
test('prices use the whole package and best single discount with two-decimal precision', () => {
    for (const [plan, code, eligible, amount] of [
        ['math', '', false, 5999], ['mathSlytherin', '', false, 11998],
        ['math', '', true, 4499.25], ['math', 'MAGNUS500', false, 5499],
        ['mathSlytherin', 'MAGNUS500', false, 11498], ['math', '7a597883', false, 59.99],
        ['mathSlytherin', '7a597883', false, 119.98], ['math', 'MAGNUS500', true, 4499.25],
        ['math', '7a597883', true, 59.99]
    ]) assert.equal(calculateMathQuote(plan, code, { existingHouseEligible: eligible }).amount, amount);
});
test('pricing rejects invalid codes, duplicate math enrollment, and ineligible upgrades', () => {
    assert.throws(() => calculateMathQuote('math', 'INVALID'), /Invalid discount/);
    assert.throws(() => calculateMathQuote('math', {}), /Invalid discount/);
    assert.throws(() => calculateMathQuote('offline'), /Invalid math plan/);
    assert.throws(() => calculateMathQuote('math', '', { hasMathAccess: true }), /already enrolled/);
    assert.throws(() => calculateMathQuote('mathSlytherin', '', { existingHouseEligible: true }), /house already/);
    assert.throws(() => calculateMathQuote('slytherinUpgrade'), /active math-only/);
    assert.throws(() => calculateMathQuote('slytherinUpgrade', '', { hasMathAccess: true, hasClassAccess: true }), /active math-only/);
    assert.throws(() => calculateMathQuote('slytherinUpgrade', 'MAGNUS500', { hasMathAccess: true }), /do not apply/);
    assert.equal(calculateMathQuote('slytherinUpgrade', '', { hasMathAccess: true }).amount, 5999);
});
test('legacy records remain general and math exams cannot affect normal rank totals', () => {
    assert.deepEqual(programFilter(), { program: { $ne: 'math' } });
    assert.deepEqual(programFilter('math'), { program: 'math' });
    const makeSubmission = (program, score) => ({ student: 'student1', score, exam: { program, totalMarks: 20, competitionCategory: 'daily', isLiveExam: true, examType: 'official', endTime: new Date('2026-01-01') } });
    const submissions = [makeSubmission(undefined, 10), makeSubmission('math', 20)];
    assert.equal(buildRankInfoMapFromSubmissions(submissions, ['student1']).get('student1').rankPoints, 5);
    assert.equal(buildRankInfoMapFromSubmissions(submissions, ['student1'], { program: 'math' }).get('student1').rankPoints, 10);
});
test('new memberships receive no missed-exam penalties for pre-access exams', () => {
    const user = { mathAccessStartsAt: new Date('2026-09-05'), generalAccessStartsAt: new Date('2026-09-10') };
    for (const program of ['general', 'math']) assert.equal(isPenaltyEligibleForMembership({ startTime: new Date('2026-09-01') }, user, program), false);
    assert.equal(isPenaltyEligibleForMembership({ startTime: new Date('2026-09-06') }, user, 'math'), true);
    assert.equal(isPenaltyEligibleForMembership({ startTime: new Date('2026-09-06') }, user, 'general'), false);
    assert.equal(isPenaltyEligibleForMembership({ startTime: new Date('2026-09-11') }, user, 'general'), true);
    assert.equal(isPenaltyEligibleForMembership({ startTime: new Date('2026-09-01') }, {}, 'general'), true);
});
test('math authoring rejects other subjects while preserving daily and full-length timing', () => {
    const question = { subject: 'Maths', question: '2 + 2?', options: ['1','2','3','4','5'], correct_answer: '4', explanation: 'Two plus two is four.' };
    const body = { program: 'math', title: 'Math exam', startTime: '2026-09-10T12:00:00Z', endTime: '2026-09-10T13:30:00Z', questions: [question] };
    const daily = exams.parseLiveExamPayload(body, 'admin');
    assert.deepEqual(daily.errors, []); assert.equal(daily.payload.program, 'math'); assert.equal(daily.payload.duration, 15);
    assert.equal(daily.payload.questions[0].source, 'liveExam');
    assert.equal(exams.parseLiveExamPayload({ ...body, competitionCategory: 'weekly' }, 'admin').payload.duration, 90);
    assert.match(exams.parseLiveExamPayload({ ...body, questions: [{ ...question, subject: 'English' }] }, 'admin').errors.join(), /math questions only/);
});
test('math survey requires multiple-choice answers and descriptive Others details', () => {
    const source = { preparationMethods: ['By myself', 'Personal batch'], mathWeaknesses: ['Wrong approach'], mathFear: 'Time pressure' };
    assert.deepEqual(payments.validateMathSurvey(source), []);
    assert.ok(payments.validateMathSurvey({ ...source, mathWeaknesses: ['Others'] }).includes('mathWeaknessOther'));
    assert.ok(payments.validateMathSurvey({ ...source, preparationMethods: [] }).includes('preparationMethods'));
    assert.ok(payments.validateMathSurvey({ ...source, mathFear: '' }).includes('mathFear'));
    assert.deepEqual(payments.validateMathSurvey({ ...source, mathWeaknesses: ['Others'], mathWeaknessOther: 'Geometry' }), []);
    assert.ok(EnrollmentDetail.schema.path('preferredBatch').enumValues.includes('Math Course'));
});
test('duplicate/delayed callbacks preserve paid state; refunds revoke it', () => {
    const payment = paid('math', { amount: 59.99, remainingAmount: 0 });
    const repeated = payments.applyPaystationStatus(payment, { trx_status: 'success' });
    assert.equal(repeated.shouldSendEmail, false); assert.equal(payment.status, 'paid');
    payments.applyPaystationStatus(payment, { trx_status: 'processing' }); assert.equal(payment.status, 'paid');
    payments.applyPaystationStatus(payment, { trx_status: 'failed' }); assert.equal(payment.status, 'paid');
    const refund = payments.applyPaystationStatus(payment, { trx_status: 'refund' });
    assert.equal(refund.shouldUnlock, false); assert.equal(payment.status, 'refund');
});
test('gateway initiation preserves fractional taka and never rounds a discounted price to an integer', async () => {
    const keys = { PAYSTATION_ENV: 'sandbox', PAYSTATION_SANDBOX_BASE_URL: 'https://sandbox.paystation.com.bd', PAYSTATION_SANDBOX_STORE_ID: 'test', PAYSTATION_SANDBOX_PASSWORD: 'test', PAYSTATION_CALLBACK_URL: 'https://example.com/callback' };
    const previous = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]));
    Object.assign(process.env, keys);
    try {
        let captured;
        await initiatePayment({ invoiceNumber: 'test', amount: 4499.25, customer: {} }, { post: async (_url, body) => { captured = body; return { data: { status: 'success' } }; } });
        assert.equal(new URLSearchParams(captured).get('payment_amount'), '4499.25');
    } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
