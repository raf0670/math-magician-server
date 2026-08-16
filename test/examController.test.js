const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/examController');

function buildLiveExam(endTime) {
    return {
        _id: 'exam-1',
        title: 'Daily Live Exam',
        isLiveExam: true,
        examType: 'official',
        endTime,
        totalMarks: 1,
        negativeMarksPerQuestion: 0.25,
        questions: [
            {
                _id: 'question-1',
                questionText: '2 + 2 = ?',
                options: ['3', '4', '5', '6'],
                correctOptionIndex: 1,
                correctAnswer: '4',
                explanation: 'Basic addition.'
            }
        ]
    };
}

function buildSubmission() {
    return {
        _id: 'submission-1',
        answers: [1],
        score: 1,
        submittedAt: new Date('2026-08-16T15:10:00.000Z'),
        submissionReason: 'manual'
    };
}

test('pending official live exam submission response hides score, review, and answers', () => {
    const exam = buildLiveExam(new Date('2099-01-01T00:00:00.000Z'));
    const response = _private.buildStudentSubmissionResponse(buildSubmission(), exam);

    assert.equal(response.success, true);
    assert.equal(response.submitted, true);
    assert.equal(response.resultsAvailable, false);
    assert.equal(response.resultsAvailableAt, exam.endTime);
    assert.equal(Object.hasOwn(response, 'score'), false);
    assert.equal(Object.hasOwn(response, 'review'), false);
    assert.equal(Object.hasOwn(response, 'answers'), false);
});

test('duplicate pending official live exam submission response is still receipt-only', () => {
    const exam = buildLiveExam(new Date('2099-01-01T00:00:00.000Z'));
    const response = _private.buildStudentSubmissionResponse(buildSubmission(), exam, { alreadySubmitted: true });

    assert.equal(response.alreadySubmitted, true);
    assert.equal(response.resultsAvailable, false);
    assert.equal(Object.hasOwn(response, 'score'), false);
    assert.equal(Object.hasOwn(response, 'review'), false);
    assert.equal(Object.hasOwn(response, 'answers'), false);
});

test('ended official live exam submission response includes full scorecard data', () => {
    const exam = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'));
    const response = _private.buildStudentSubmissionResponse(buildSubmission(), exam);

    assert.equal(response.resultsAvailable, true);
    assert.equal(response.score, 1);
    assert.deepEqual(response.answers, [1]);
    assert.equal(response.review.length, 1);
    assert.equal(response.review[0].correctAnswer, '4');
});

test('live exam summary hides score before end time and reveals it after', () => {
    const pendingExam = buildLiveExam(new Date('2099-01-01T00:00:00.000Z'));
    const endedExam = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'));
    const submission = buildSubmission();

    const pendingSummary = _private.serializeExamSummary(
        pendingExam,
        new Map([[pendingExam._id, submission]])
    );
    const endedSummary = _private.serializeExamSummary(
        endedExam,
        new Map([[endedExam._id, submission]])
    );

    assert.equal(pendingSummary.hasSubmitted, true);
    assert.equal(pendingSummary.submission.submittedAt, submission.submittedAt);
    assert.equal(Object.hasOwn(pendingSummary.submission, 'score'), false);
    assert.equal(endedSummary.submission.score, 1);
});

test('timer-expired live exam submissions are accepted inside the technical grace window', () => {
    const endTime = new Date('2026-08-16T16:30:00.000Z');

    assert.equal(
        _private.isTimerExpiredSubmissionInsideGrace('timer_expired', endTime, new Date('2026-08-16T16:30:30.000Z')),
        true
    );
});

test('manual or too-late live exam submissions are outside the technical grace window', () => {
    const endTime = new Date('2026-08-16T16:30:00.000Z');

    assert.equal(
        _private.isTimerExpiredSubmissionInsideGrace('manual', endTime, new Date('2026-08-16T16:30:10.000Z')),
        false
    );
    assert.equal(
        _private.isTimerExpiredSubmissionInsideGrace('timer_expired', endTime, new Date('2026-08-16T16:30:31.000Z')),
        false
    );
});
