const test = require('node:test');
const assert = require('node:assert/strict');
const { getRankPointsForSubmission, shouldCountExam } = require('../services/rankService');

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
