const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/examController');

function buildLiveExam(endTime, overrides = {}) {
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
        ],
        ...overrides
    };
}

function buildSubmission(overrides = {}) {
    return {
        _id: 'submission-1',
        answers: [1],
        score: 1,
        submittedAt: new Date('2026-08-16T15:10:00.000Z'),
        submissionReason: 'manual',
        ...overrides
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
    assert.equal(Object.hasOwn(response, 'passingMarks'), false);
    assert.equal(Object.hasOwn(response, 'isPassed'), false);
});

test('duplicate pending official live exam submission response is still receipt-only', () => {
    const exam = buildLiveExam(new Date('2099-01-01T00:00:00.000Z'));
    const response = _private.buildStudentSubmissionResponse(buildSubmission(), exam, { alreadySubmitted: true });

    assert.equal(response.alreadySubmitted, true);
    assert.equal(response.resultsAvailable, false);
    assert.equal(Object.hasOwn(response, 'score'), false);
    assert.equal(Object.hasOwn(response, 'review'), false);
    assert.equal(Object.hasOwn(response, 'answers'), false);
    assert.equal(Object.hasOwn(response, 'passingMarks'), false);
    assert.equal(Object.hasOwn(response, 'isPassed'), false);
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

test('ended official live exam submission response includes default pass status', () => {
    const exam = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'), {
        totalMarks: 10
    });
    const response = _private.buildStudentSubmissionResponse(buildSubmission({ score: 4 }), exam);

    assert.equal(response.passingMarks, 4);
    assert.equal(response.isPassed, true);
});

test('explicit passing marks override the live exam default', () => {
    const exam = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'), {
        totalMarks: 10,
        passingMarks: 7
    });

    const failedResponse = _private.buildStudentSubmissionResponse(buildSubmission({ score: 6 }), exam);
    const passedResponse = _private.buildStudentSubmissionResponse(buildSubmission({ score: 7 }), exam);

    assert.equal(failedResponse.passingMarks, 7);
    assert.equal(failedResponse.isPassed, false);
    assert.equal(passedResponse.passingMarks, 7);
    assert.equal(passedResponse.isPassed, true);
});

test('older live exams without passing marks use floor of forty percent', () => {
    const exam = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'), {
        totalMarks: 19
    });
    delete exam.passingMarks;

    assert.equal(_private.getEffectivePassingMarks(exam), 7);
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
    assert.equal(Object.hasOwn(pendingSummary.submission, 'isPassed'), false);
    assert.equal(Object.hasOwn(pendingSummary.submission, 'passingMarks'), false);
    assert.equal(endedSummary.submission.score, 1);
    assert.equal(endedSummary.submission.isPassed, true);
    assert.equal(endedSummary.submission.passingMarks, 0);
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

test('assignment date converts to a full Bangladesh calendar day in UTC', () => {
    const window = _private.getBangladeshFullDayWindow('2026-08-24');

    assert.equal(window.assignmentDate, '2026-08-24');
    assert.equal(window.startTime.toISOString(), '2026-08-23T18:00:00.000Z');
    assert.equal(window.endTime.toISOString(), '2026-08-24T17:59:59.999Z');
});

test('assignment payload accepts assessment-style strict JSON questions', () => {
    const { payload, errors } = _private.parseAssignmentPayload({
        title: 'Assignment 01',
        assignmentDate: '2026-08-24',
        questions: JSON.stringify([
            {
                subject: 'Maths',
                question_no: 1,
                instruction: 'Solve the math.',
                question: '2 + 2 = ?',
                options: ['A) 3', 'B) 4', 'C) 5', 'D) 6', 'E) None of these'],
                correct_answer: 'B) 4',
                explanation: '2 + 2 equals 4.'
            }
        ])
    }, '507f1f77bcf86cd799439011');

    assert.deepEqual(errors, []);
    assert.equal(payload.questions.length, 1);
    assert.equal(payload.questions[0].instruction, 'Solve the math.');
    assert.equal(payload.questions[0].correctOptionIndex, 1);
    assert.equal(payload.questions[0].source, 'assignment');
});

test('assignment summary hides score before deadline and reveals it after', () => {
    const pendingAssignment = buildLiveExam(new Date('2099-01-01T00:00:00.000Z'), {
        examType: 'assignment'
    });
    const endedAssignment = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'), {
        examType: 'assignment'
    });
    const submission = buildSubmission();

    const pendingSummary = _private.serializeExamSummary(
        pendingAssignment,
        new Map([[pendingAssignment._id, submission]])
    );
    const endedSummary = _private.serializeExamSummary(
        endedAssignment,
        new Map([[endedAssignment._id, submission]])
    );

    assert.equal(pendingSummary.hasSubmitted, true);
    assert.equal(pendingSummary.submission.submittedAt, submission.submittedAt);
    assert.equal(Object.hasOwn(pendingSummary.submission, 'score'), false);
    assert.equal(endedSummary.submission.score, 1);
});

test('duplicate pending assignment submission response is receipt-only', () => {
    const assignment = buildLiveExam(new Date('2099-01-01T00:00:00.000Z'), {
        examType: 'assignment'
    });
    const response = _private.buildStudentSubmissionResponse(buildSubmission(), assignment, { alreadySubmitted: true });

    assert.equal(response.alreadySubmitted, true);
    assert.equal(response.resultsAvailable, false);
    assert.equal(Object.hasOwn(response, 'score'), false);
    assert.equal(Object.hasOwn(response, 'review'), false);
    assert.equal(Object.hasOwn(response, 'answers'), false);
});

test('ended assignment submission response includes full scorecard data', () => {
    const assignment = buildLiveExam(new Date('2000-01-01T00:00:00.000Z'), {
        examType: 'assignment'
    });
    const response = _private.buildStudentSubmissionResponse(buildSubmission(), assignment);

    assert.equal(response.resultsAvailable, true);
    assert.equal(response.score, 1);
    assert.deepEqual(response.answers, [1]);
    assert.equal(response.review[0].correctAnswer, '4');
});

test('practice question source filter excludes live exam and assignment authored questions', () => {
    assert.deepEqual(_private.buildPracticeQuestionSourceFilter(), {
        source: { $nin: ['liveExam', 'assignment'] }
    });
});
