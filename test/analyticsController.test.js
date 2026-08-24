const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/analyticsController');

test('competition exam filter includes open assessment exams', () => {
    const filter = _private.buildCompetitionExamFilter();

    assert.deepEqual(filter.$or[1], { examType: 'assessment' });
});

test('competition exam filter still requires non-assessment exams to be live official exams', () => {
    const filter = _private.buildCompetitionExamFilter();
    const liveOfficialBranch = filter.$or[0].$and;

    assert.deepEqual(liveOfficialBranch[0], { isLiveExam: true });
    assert.deepEqual(liveOfficialBranch[1], _private.buildOfficialExamFilter());
});

test('official live exam submissions are unavailable before the exam end time', () => {
    const submission = {
        exam: {
            examType: 'official',
            isLiveExam: true,
            endTime: new Date('2026-08-16T16:00:00.000Z')
        },
        score: 9
    };

    assert.equal(_private.isSubmissionResultAvailable(submission, new Date('2026-08-16T15:59:59.000Z')), false);
});

test('official live exam submissions are available after the exam end time', () => {
    const submission = {
        exam: {
            examType: 'official',
            isLiveExam: true,
            endTime: new Date('2026-08-16T16:00:00.000Z')
        },
        score: 9
    };

    assert.equal(_private.isSubmissionResultAvailable(submission, new Date('2026-08-16T16:00:01.000Z')), true);
});

test('official live exam submissions are available at the exact exam end time', () => {
    const submission = {
        exam: {
            examType: 'official',
            isLiveExam: true,
            endTime: new Date('2026-08-16T16:00:00.000Z')
        },
        score: 9
    };

    assert.equal(_private.isSubmissionResultAvailable(submission, new Date('2026-08-16T16:00:00.000Z')), true);
});

test('assessment submissions keep their existing analytics availability', () => {
    const submission = {
        exam: {
            examType: 'assessment',
            isLiveExam: true,
            endTime: new Date('2026-08-16T16:00:00.000Z')
        },
        score: 42
    };

    assert.equal(_private.isSubmissionResultAvailable(submission, new Date('2026-08-16T15:30:00.000Z')), true);
});

test('assignment submissions are unavailable before the assignment deadline', () => {
    const submission = {
        exam: {
            examType: 'assignment',
            isLiveExam: true,
            endTime: new Date('2026-08-24T17:59:59.999Z')
        },
        score: 2
    };

    assert.equal(_private.isSubmissionResultAvailable(submission, new Date('2026-08-24T17:00:00.000Z')), false);
    assert.equal(_private.isSubmissionResultAvailable(submission, new Date('2026-08-24T18:00:00.000Z')), true);
});
