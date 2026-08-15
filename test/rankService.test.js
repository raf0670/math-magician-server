const test = require('node:test');
const assert = require('node:assert/strict');
const { getRankPointsForSubmission, shouldCountExam } = require('../services/rankService');

test('open assessment exams count for rank points even when they are not live exams', () => {
    const exam = {
        examType: 'assessment',
        isLiveExam: false,
        totalMarks: 60
    };
    const submission = {
        exam,
        score: 42
    };

    assert.equal(shouldCountExam(exam), true);
    assert.equal(getRankPointsForSubmission(submission), 42);
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
