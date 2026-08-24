const test = require('node:test');
const assert = require('node:assert/strict');
const { _private, getMissingAssignmentRankPoints, getRankPointsForSubmission, shouldCountExam } = require('../services/rankService');

test('timed assessment exams count for rank points after the official start time', () => {
    const exam = {
        examType: 'assessment',
        isLiveExam: true,
        startTime: new Date('2026-08-16T15:00:00.000Z'),
        endTime: new Date('2026-08-16T16:30:00.000Z'),
        totalMarks: 60
    };
    const submission = {
        exam,
        score: 42
    };

    const duringExam = new Date('2026-08-16T15:30:00.000Z');
    assert.equal(shouldCountExam(exam, duringExam), true);
    assert.equal(getRankPointsForSubmission(submission, duringExam), 42);
});

test('timed assessment exams do not count for rank points before the official start time', () => {
    const exam = {
        examType: 'assessment',
        isLiveExam: true,
        startTime: new Date('2026-08-16T15:00:00.000Z'),
        endTime: new Date('2026-08-16T16:30:00.000Z'),
        totalMarks: 60
    };
    const submission = {
        exam,
        score: 42
    };

    const beforeExam = new Date('2026-08-16T14:59:59.000Z');
    assert.equal(shouldCountExam(exam, beforeExam), false);
    assert.equal(getRankPointsForSubmission(submission, beforeExam), null);
});

test('untimed generated practice exams still do not count for rank points', () => {
    const exam = {
        examType: 'generatedPractice',
        isLiveExam: false,
        totalMarks: 20
    };
    const submission = {
        exam,
        score: 18
    };

    assert.equal(shouldCountExam(exam), false);
    assert.equal(getRankPointsForSubmission(submission), null);
});

test('missing populated exam references do not count for rank points', () => {
    assert.equal(shouldCountExam(null), false);
    assert.equal(getRankPointsForSubmission({ exam: null, score: 10 }), null);
});

test('failed live exam submissions still contribute their achieved score to rank points', () => {
    const exam = {
        examType: 'official',
        isLiveExam: true,
        competitionCategory: 'daily',
        endTime: new Date('2026-08-16T16:30:00.000Z'),
        totalMarks: 10,
        passingMarks: 8
    };
    const submission = {
        exam,
        score: 2
    };

    assert.equal(shouldCountExam(exam, new Date('2026-08-16T16:30:01.000Z')), true);
    assert.equal(getRankPointsForSubmission(submission, new Date('2026-08-16T16:30:01.000Z')), 2);
});

test('completed assignment submission gives two rank points after deadline', () => {
    const exam = {
        examType: 'assignment',
        isLiveExam: true,
        endTime: new Date('2026-08-24T17:59:59.999Z'),
        totalMarks: 3
    };
    const submission = {
        exam,
        answers: [0, 1, 2],
        score: 1
    };

    assert.equal(shouldCountExam(exam, new Date('2026-08-24T18:00:00.000Z')), true);
    assert.equal(getRankPointsForSubmission(submission, new Date('2026-08-24T18:00:00.000Z')), 2);
});

test('unfinished assignment submission gives zero rank points', () => {
    const exam = {
        examType: 'assignment',
        isLiveExam: true,
        endTime: new Date('2026-08-24T17:59:59.999Z'),
        totalMarks: 3
    };
    const submission = {
        exam,
        answers: [0, -1, 2],
        score: 1
    };

    assert.equal(getRankPointsForSubmission(submission, new Date('2026-08-24T18:00:00.000Z')), 0);
});

test('disqualified assignment submission gives zero rank points', () => {
    const exam = {
        examType: 'assignment',
        isLiveExam: true,
        endTime: new Date('2026-08-24T17:59:59.999Z'),
        totalMarks: 3
    };
    const submission = {
        exam,
        answers: [0, 1, 2],
        score: 3,
        isDisqualified: true
    };

    assert.equal(getRankPointsForSubmission(submission, new Date('2026-08-24T18:00:00.000Z')), 0);
});

test('missing assignment penalty is minus five rank points', () => {
    assert.equal(getMissingAssignmentRankPoints(), -5);
});

test('ended daily live exams are eligible for missing-exam penalties', () => {
    const exam = {
        examType: 'official',
        isLiveExam: true,
        competitionCategory: 'daily',
        endTime: new Date('2026-08-16T16:30:00.000Z'),
        totalMarks: 10
    };

    assert.equal(_private.shouldPenalizeMissingDailyLiveExam(exam, new Date('2026-08-16T16:30:01.000Z')), true);
});

test('weekly and not-yet-ended live exams are not eligible for missing daily penalties', () => {
    const endedWeeklyExam = {
        examType: 'official',
        isLiveExam: true,
        competitionCategory: 'weekly',
        endTime: new Date('2026-08-16T16:30:00.000Z'),
        totalMarks: 10
    };
    const openDailyExam = {
        examType: 'official',
        isLiveExam: true,
        competitionCategory: 'daily',
        endTime: new Date('2026-08-16T16:30:00.000Z'),
        totalMarks: 10
    };

    assert.equal(_private.shouldPenalizeMissingDailyLiveExam(endedWeeklyExam, new Date('2026-08-16T16:30:01.000Z')), false);
    assert.equal(_private.shouldPenalizeMissingDailyLiveExam(openDailyExam, new Date('2026-08-16T16:29:59.000Z')), false);
});

test('missing daily live exam applies minus five rank points to eligible students', () => {
    const totals = new Map([['student-1', { points: 0, countedExamCount: 0 }]]);

    _private.applyMissingPenaltiesForEligibleStudents(
        totals,
        [],
        ['student-1'],
        [{ _id: 'daily-exam-1', penalty: -5 }]
    );

    assert.deepEqual(totals.get('student-1'), { points: -5, countedExamCount: 1 });
});

test('submitted daily live exams do not receive missing-exam penalties', () => {
    const totals = new Map([['student-1', { points: 7, countedExamCount: 1 }]]);

    _private.applyMissingPenaltiesForEligibleStudents(
        totals,
        [{ student: 'student-1', exam: { _id: 'daily-exam-1' } }],
        ['student-1'],
        [{ _id: 'daily-exam-1', penalty: -5 }]
    );

    assert.deepEqual(totals.get('student-1'), { points: 7, countedExamCount: 1 });
});
