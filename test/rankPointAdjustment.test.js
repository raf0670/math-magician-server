const test = require('node:test');
const assert = require('node:assert/strict');
const { _private: adjustmentPrivate, RankPointAdjustmentError } = require('../services/rankPointAdjustmentService');
const { _private: rankPrivate } = require('../services/rankService');

function csv(value) {
    return Buffer.from(value, 'utf8');
}

test('bonus CSV accepts current and canonical headers with signed and zero values', () => {
    const currentRows = adjustmentPrivate.parseRankPointCsv(csv(
        '\ufeffName,Sum Bonus\n"student.one@example.com",4\nstudent.two@example.com,-2\nstudent.zero@example.com,0\n'
    ));
    const canonicalRows = adjustmentPrivate.parseRankPointCsv(csv(
        'Email,Bonus RP\nstudent@example.com,1.25\n'
    ));

    assert.deepEqual(currentRows.map(({ email, points }) => ({ email, points })), [
        { email: 'student.one@example.com', points: 4 },
        { email: 'student.two@example.com', points: -2 },
        { email: 'student.zero@example.com', points: 0 }
    ]);
    assert.equal(canonicalRows[0].points, 1.25);
});

test('bonus CSV rejects duplicate emails and values with more than two decimals', () => {
    assert.throws(
        () => adjustmentPrivate.parseRankPointCsv(csv('Email,Bonus RP\na@example.com,1\nA@example.com,2\n')),
        (error) => error instanceof RankPointAdjustmentError && /more than once/.test(error.message)
    );
    assert.throws(
        () => adjustmentPrivate.parseRankPointCsv(csv('Email,Bonus RP\na@example.com,1.234\n')),
        (error) => error instanceof RankPointAdjustmentError && /invalid RP value/.test(error.message)
    );
});

test('bonus CSV requires exactly two recognized columns and no more than 500 rows', () => {
    assert.throws(
        () => adjustmentPrivate.parseRankPointCsv(csv('Email,Bonus RP,Notes\na@example.com,1,good\n')),
        /exactly two columns/
    );

    const rows = Array.from({ length: 501 }, (_, index) => `student${index}@example.com,1`).join('\n');
    assert.throws(
        () => adjustmentPrivate.parseRankPointCsv(csv(`Email,Bonus RP\n${rows}\n`)),
        /at most 500/
    );
});

test('batch statistics retain zero rows and signed net points', () => {
    assert.deepEqual(adjustmentPrivate.buildStats([
        { points: 4 },
        { points: 0 },
        { points: -2 },
        { points: 1.25 }
    ]), {
        rowCount: 4,
        positiveCount: 2,
        zeroCount: 1,
        negativeCount: 1,
        totalPoints: 3.25
    });
});

test('idempotency ignores row order but includes class date and house', () => {
    const metadata = adjustmentPrivate.normalizeMetadata({
        label: 'Class bonus',
        reason: 'Participation',
        expectedHouse: 'Gryffindor',
        effectiveDate: '2026-10-01'
    });
    const first = adjustmentPrivate.buildIdempotency(metadata, [
        { email: 'b@example.com', points: 2 },
        { email: 'a@example.com', points: 1 }
    ]);
    const second = adjustmentPrivate.buildIdempotency(metadata, [
        { email: 'a@example.com', points: 1 },
        { email: 'b@example.com', points: 2 }
    ]);
    const otherHouse = adjustmentPrivate.buildIdempotency(
        { ...metadata, expectedHouse: 'Hufflepuff' },
        [{ email: 'a@example.com', points: 1 }, { email: 'b@example.com', points: 2 }]
    );

    assert.equal(first, second);
    assert.notEqual(first, otherHouse);
});

test('access eligibility is evaluated on the effective class date', () => {
    const date = new Date('2026-10-01T00:00:00.000Z');
    assert.equal(adjustmentPrivate.isEligibleOnDate({ hasClassAccess: true }, date), true);
    assert.equal(adjustmentPrivate.isEligibleOnDate({
        hasClassAccess: false,
        generalAccessSuspended: true,
        generalAccessSuspendedAt: new Date('2026-10-02T00:00:00.000Z')
    }, date), true);
    assert.equal(adjustmentPrivate.isEligibleOnDate({
        hasClassAccess: false,
        generalAccessSuspended: true,
        generalAccessSuspendedAt: new Date('2026-09-30T00:00:00.000Z')
    }, date), false);
});

test('ledger points apply exactly without multipliers or counted-exam changes', () => {
    const totals = new Map([
        ['gryffindor', { points: 5, countedExamCount: 2 }],
        ['slytherin', { points: 10, countedExamCount: 1 }]
    ]);
    rankPrivate.applyRankPointAdjustments(totals, [
        { student: 'gryffindor', program: 'general', points: 4 },
        { student: 'slytherin', program: 'general', points: 4 },
        { student: 'gryffindor', program: 'math', points: 100 },
        { student: 'new-student', program: 'general', points: -2 }
    ], { program: 'general' });

    assert.deepEqual(totals.get('gryffindor'), { points: 9, countedExamCount: 2 });
    assert.deepEqual(totals.get('slytherin'), { points: 14, countedExamCount: 1 });
    assert.deepEqual(totals.get('new-student'), { points: -2, countedExamCount: 0 });
});
