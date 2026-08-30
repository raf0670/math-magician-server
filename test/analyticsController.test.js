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

test('exam leaderboard response hides rows before an official live exam ends', () => {
    const exam = {
        _id: 'exam-1',
        title: 'Daily Live Exam',
        totalMarks: 10,
        competitionCategory: 'daily',
        examType: 'official',
        isLiveExam: true,
        endTime: new Date('2026-08-24T18:00:00.000Z')
    };
    const response = _private.buildExamLeaderboardResponse(exam, [
        {
            student: { _id: 'student-1', name: 'A Student', house: 'Gryffindor' },
            score: 9,
            submittedAt: new Date('2026-08-24T17:00:00.000Z')
        }
    ], {
        now: new Date('2026-08-24T17:30:00.000Z'),
        currentUserId: 'student-1'
    });

    assert.equal(response.resultsAvailable, false);
    assert.equal(response.count, 0);
    assert.deepEqual(response.data, []);
    assert.equal(response.currentUserEntry, null);
    assert.equal(response.resultsAvailableAt, exam.endTime);
});

test('exam leaderboard gives equal scores the same rank', () => {
    const leaderboard = _private.buildExamLeaderboard([
        {
            student: { _id: 'student-1', name: 'First', house: 'Gryffindor' },
            score: 8,
            submittedAt: new Date('2026-08-24T17:03:00.000Z')
        },
        {
            student: { _id: 'student-2', name: 'Second', house: 'Ravenclaw' },
            score: 8,
            submittedAt: new Date('2026-08-24T17:01:00.000Z')
        },
        {
            student: { _id: 'student-3', name: 'Third', house: 'Hufflepuff' },
            score: 6,
            submittedAt: new Date('2026-08-24T17:02:00.000Z')
        }
    ]);

    assert.deepEqual(leaderboard.map((entry) => entry.rank), [1, 1, 3]);
    assert.deepEqual(leaderboard.map((entry) => entry.studentName), ['Second', 'First', 'Third']);
});

test('exam leaderboard excludes retake submissions', () => {
    const leaderboard = _private.buildExamLeaderboard([
        {
            student: { _id: 'student-1', name: 'Official Student', house: 'Gryffindor' },
            score: 7,
            isRetake: false,
            submittedAt: new Date('2026-08-24T17:01:00.000Z')
        },
        {
            student: { _id: 'student-1', name: 'Official Student', house: 'Gryffindor' },
            score: 10,
            isRetake: true,
            submittedAt: new Date('2026-08-24T18:01:00.000Z')
        },
        {
            student: { _id: 'student-2', name: 'Retake Only', house: 'Ravenclaw' },
            score: 10,
            isRetake: true,
            submittedAt: new Date('2026-08-24T18:02:00.000Z')
        }
    ]);

    assert.equal(leaderboard.length, 1);
    assert.equal(leaderboard[0].studentName, 'Official Student');
    assert.equal(leaderboard[0].score, 7);
});

test('retake submissions have zero effective analytics contribution', () => {
    assert.equal(_private.getEffectiveScore({ score: 10, isRetake: true }), 0);
    assert.equal(_private.getEffectiveScore({ score: 10, isRetake: false }), 10);
});

test('exam leaderboard eligibility rejects non-live and non-official exams', () => {
    assert.equal(_private.isOfficialLiveExam({ isLiveExam: true, examType: 'official' }), true);
    assert.equal(_private.isOfficialLiveExam({ isLiveExam: true }), true);
    assert.equal(_private.isOfficialLiveExam({ isLiveExam: false, examType: 'official' }), false);
    assert.equal(_private.isOfficialLiveExam({ isLiveExam: true, examType: 'assignment' }), false);
    assert.equal(_private.isOfficialLiveExam({ isLiveExam: false, examType: 'generatedPractice' }), false);
});

test('exam leaderboard counts disqualified submissions as zero effective score', () => {
    const leaderboard = _private.buildExamLeaderboard([
        {
            student: { _id: 'student-1', name: 'Disqualified Topper', house: 'Slytherin' },
            score: 10,
            isDisqualified: true,
            submittedAt: new Date('2026-08-24T17:01:00.000Z')
        },
        {
            student: { _id: 'student-2', name: 'Valid Student', house: 'Ravenclaw' },
            score: 6,
            submittedAt: new Date('2026-08-24T17:02:00.000Z')
        }
    ]);

    assert.equal(leaderboard[0].studentName, 'Valid Student');
    assert.equal(leaderboard[0].score, 6);
    assert.equal(leaderboard[1].studentName, 'Disqualified Topper');
    assert.equal(leaderboard[1].score, 0);
    assert.equal(leaderboard[1].originalScore, 10);
    assert.equal(leaderboard[1].isDisqualified, true);
});
