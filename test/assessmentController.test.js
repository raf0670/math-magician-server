const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../controllers/assessmentController');

function buildAssessmentExam(overrides = {}) {
    return {
        _id: 'assessment-1',
        title: 'Assessment Test',
        duration: 90,
        totalMarks: 1,
        negativeMarksPerQuestion: 0.25,
        allowRetakes: true,
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

test('assessment retake response includes retake attempt metadata and scorecard data', () => {
    const response = _private.buildSubmissionResponse({
        _id: 'submission-1',
        answers: [1],
        score: 1,
        submissionReason: 'manual',
        isRetake: true,
        attemptNumber: 2
    }, buildAssessmentExam());

    assert.equal(response.isRetake, true);
    assert.equal(response.attemptNumber, 2);
    assert.equal(response.score, 1);
    assert.deepEqual(response.answers, [1]);
    assert.equal(response.review[0].correctAnswer, '4');
});

test('assessment retakes are available only after the assessment has ended and retakes are enabled', () => {
    assert.equal(_private.canRetakeAssessment(buildAssessmentExam(), 'open'), false);
    assert.equal(_private.canRetakeAssessment(buildAssessmentExam(), 'ended'), true);
    assert.equal(_private.canRetakeAssessment(buildAssessmentExam({ allowRetakes: false }), 'ended'), false);
});
