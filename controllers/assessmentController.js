const mongoose = require('mongoose');
const AssessmentTest = require('../models/AssessmentTest');
const Exam = require('../models/Exam');
const Submission = require('../models/Submission');

const ASSESSMENT_EXAM_CODE = 'assessment-test-2026-08-16';
const ASSESSMENT_TITLE = 'Assessment Test';
const ASSESSMENT_START_TIME = new Date('2026-08-16T15:00:00.000Z');
const ASSESSMENT_END_TIME = new Date('2026-08-16T16:30:00.000Z');
const ASSESSMENT_DURATION_MINUTES = 90;
const ASSESSMENT_NEGATIVE_MARKS = 0.25;
const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];
const SUBMISSION_REASONS = new Set(['manual', 'timer_expired', 'tab_switch']);

function clean(value) {
    return value?.toString().trim() || '';
}

function normalizeOptionText(value) {
    return clean(value).toLowerCase();
}

function stripOptionLabel(value) {
    return normalizeOptionText(value).replace(/^[a-e]\s*[\).:-]\s*/, '').trim();
}

function normalizeSubject(subject = '') {
    const rawSubject = clean(subject);
    const normalized = rawSubject.toLowerCase();

    if (['math', 'maths', 'mathematics'].includes(normalized)) return 'Maths';
    if (normalized === 'english') return 'English';
    if (['analytical', 'analysis', 'analytic'].includes(normalized)) return 'Analytical';

    return rawSubject || 'General';
}

function normalizeSubmissionReason(value) {
    const reason = clean(value);
    return SUBMISSION_REASONS.has(reason) ? reason : 'manual';
}

function getAssessmentStatus(now = new Date()) {
    if (now < ASSESSMENT_START_TIME) return 'upcoming';
    if (now <= ASSESSMENT_END_TIME) return 'open';
    return 'ended';
}

function getIdString(value) {
    return value?._id?.toString?.() || value?.toString?.() || '';
}

function isAdmin(user) {
    return user?.role === 'admin';
}

function getCorrectOptionIndex(question) {
    if (!question || !Array.isArray(question.options)) return null;

    if (
        Number.isInteger(question.correctOptionIndex)
        && question.correctOptionIndex >= 0
        && question.correctOptionIndex < question.options.length
    ) {
        return question.correctOptionIndex;
    }

    const correctAnswer = question.correctAnswer || question.correct_answer;
    const normalizedCorrectAnswer = normalizeOptionText(correctAnswer);
    if (!normalizedCorrectAnswer) return null;

    const exactIndex = question.options.findIndex((option) => normalizeOptionText(option) === normalizedCorrectAnswer);
    if (exactIndex >= 0) return exactIndex;

    const strippedCorrectAnswer = stripOptionLabel(correctAnswer);
    const strippedIndex = question.options.findIndex((option) => stripOptionLabel(option) === strippedCorrectAnswer);
    if (strippedIndex >= 0) return strippedIndex;

    const labelMatch = normalizedCorrectAnswer.match(/^([a-e])(?:\s*[\).:-])?$/);
    if (labelMatch) {
        const labelIndex = OPTION_LABELS.indexOf(labelMatch[1].toUpperCase());
        if (labelIndex >= 0 && labelIndex < question.options.length) return labelIndex;
    }

    return null;
}

function normalizeAssessmentQuestion(question, index) {
    const plainQuestion = question?.toObject ? question.toObject() : question;
    const options = Array.isArray(plainQuestion?.options) ? plainQuestion.options.map(clean).filter(Boolean) : [];
    const questionText = clean(plainQuestion?.questionText || plainQuestion?.question);
    const topic = clean(plainQuestion?.topic || plainQuestion?.chapter);
    const chapter = clean(plainQuestion?.chapter || plainQuestion?.topic);
    const correctOptionIndex = getCorrectOptionIndex({ ...plainQuestion, options });
    const correctAnswer = correctOptionIndex === null
        ? clean(plainQuestion?.correctAnswer || plainQuestion?.correct_answer)
        : options[correctOptionIndex];
    const questionNo = Number(plainQuestion?.questionNo || plainQuestion?.question_no || index + 1);

    return {
        ...plainQuestion,
        _id: plainQuestion._id,
        questionNo,
        question_no: questionNo,
        instruction: clean(plainQuestion?.instruction),
        question: questionText,
        questionText,
        options,
        correctOptionIndex,
        correctAnswer,
        correct_answer: correctAnswer,
        subject: normalizeSubject(plainQuestion?.subject),
        difficulty: clean(plainQuestion?.difficulty) || 'Assessment',
        chapter,
        topic,
        subTopic: clean(plainQuestion?.subTopic),
        explanation: clean(plainQuestion?.explanation)
    };
}

function redactQuestionAnswers(question) {
    const redacted = { ...question };
    delete redacted.correctOptionIndex;
    delete redacted.correctAnswer;
    delete redacted.correct_answer;
    return redacted;
}

function validateAssessmentQuestion(question) {
    const errors = [];

    if (!question.questionText) errors.push('question text is missing');
    if (!Array.isArray(question.options) || question.options.length < 2) errors.push('at least two options are required');
    if (question.correctOptionIndex === null || question.correctOptionIndex < 0) errors.push('correct answer does not match an option');

    return errors;
}

async function loadAssessmentQuestionSet() {
    const rawQuestions = await AssessmentTest.find({})
        .sort({ question_no: 1, questionNo: 1, _id: 1 })
        .lean();

    const validQuestions = [];
    const invalidQuestions = [];

    rawQuestions.forEach((question, index) => {
        const normalizedQuestion = normalizeAssessmentQuestion(question, index);
        const errors = validateAssessmentQuestion(normalizedQuestion);

        if (errors.length) {
            invalidQuestions.push({
                questionId: getIdString(normalizedQuestion._id),
                questionNo: normalizedQuestion.questionNo,
                errors
            });
            return;
        }

        validQuestions.push(normalizedQuestion);
    });

    return {
        rawQuestionCount: rawQuestions.length,
        validQuestions,
        invalidQuestions
    };
}

async function syncAssessmentExamShell(questionSet) {
    const questionIds = questionSet.validQuestions.map((question) => question._id);

    return Exam.findOneAndUpdate(
        { examCode: ASSESSMENT_EXAM_CODE },
        {
            title: ASSESSMENT_TITLE,
            questions: questionIds,
            duration: ASSESSMENT_DURATION_MINUTES,
            totalMarks: questionIds.length,
            negativeMarksPerQuestion: ASSESSMENT_NEGATIVE_MARKS,
            examType: 'assessment',
            examCode: ASSESSMENT_EXAM_CODE,
            questionSource: 'AssessmentTest',
            competitionCategory: 'daily',
            allowRetakes: false,
            isLiveExam: true,
            startTime: ASSESSMENT_START_TIME,
            endTime: ASSESSMENT_END_TIME
        },
        {
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            upsert: true
        }
    ).lean();
}

function buildAssessmentExamPayload(exam, questionSet, options = {}) {
    const includeAnswers = Boolean(options.includeAnswers);
    const questions = includeAnswers
        ? questionSet.validQuestions
        : questionSet.validQuestions.map(redactQuestionAnswers);

    return {
        ...exam,
        questions,
        status: getAssessmentStatus(),
        questionCount: questions.length,
        invalidQuestionCount: questionSet.invalidQuestions.length,
        invalidQuestions: questionSet.invalidQuestions,
        assessmentMode: options.assessmentMode || 'exam'
    };
}

function buildQuestionReview(question, answer) {
    const selectedOption = answer === undefined || answer === null || answer === -1
        ? null
        : question.options?.[answer] || null;
    const correctOption = question.options?.[question.correctOptionIndex] || question.correctAnswer || null;

    return {
        questionId: question._id,
        selectedOptionIndex: answer,
        selectedOption,
        correctOptionIndex: question.correctOptionIndex,
        correctAnswer: correctOption,
        isCorrect: answer === question.correctOptionIndex,
        explanation: question.explanation || ''
    };
}

function gradeAnswers(exam, answers) {
    const questions = exam.questions || [];
    const totalQuestions = questions.length;
    const review = [];
    let score = 0;

    if (!totalQuestions) {
        return {
            score: 0,
            totalMarks: exam.totalMarks || 0,
            negativeMarksPerQuestion: ASSESSMENT_NEGATIVE_MARKS,
            review
        };
    }

    const marksPerQuestion = exam.totalMarks / totalQuestions;

    questions.forEach((question, index) => {
        const studentAnswer = answers[index];

        if (studentAnswer === undefined || studentAnswer === null || studentAnswer === -1) {
            review.push(buildQuestionReview(question, studentAnswer));
            return;
        }

        if (studentAnswer === question.correctOptionIndex) {
            score += marksPerQuestion;
        } else {
            score -= ASSESSMENT_NEGATIVE_MARKS;
        }

        review.push(buildQuestionReview(question, studentAnswer));
    });

    return {
        score: parseFloat(score.toFixed(2)),
        totalMarks: exam.totalMarks,
        negativeMarksPerQuestion: ASSESSMENT_NEGATIVE_MARKS,
        review
    };
}

function buildSubmissionResponse(submission, exam, options = {}) {
    const graded = gradeAnswers(exam, submission.answers || []);

    return {
        success: true,
        message: options.alreadySubmitted
            ? 'Your answer sheet was already submitted. Showing the saved result.'
            : 'Assessment test graded successfully!',
        score: submission.score,
        totalMarks: graded.totalMarks,
        negativeMarksPerQuestion: graded.negativeMarksPerQuestion,
        review: graded.review,
        answers: submission.answers || [],
        submissionReason: normalizeSubmissionReason(submission.submissionReason),
        submissionId: submission._id,
        alreadySubmitted: Boolean(options.alreadySubmitted)
    };
}

async function getAssessmentContext() {
    const questionSet = await loadAssessmentQuestionSet();
    const exam = await syncAssessmentExamShell(questionSet);

    return { exam, questionSet, status: getAssessmentStatus() };
}

exports.getAssessmentSummary = async (req, res) => {
    try {
        const { exam, questionSet, status } = await getAssessmentContext();
        const submission = await Submission.findOne({
            student: req.user.id,
            exam: exam._id
        })
            .select('score submittedAt')
            .lean();
        const admin = isAdmin(req.user);

        res.status(200).json({
            success: true,
            data: {
                _id: exam._id,
                title: exam.title,
                duration: exam.duration,
                totalMarks: exam.totalMarks,
                negativeMarksPerQuestion: ASSESSMENT_NEGATIVE_MARKS,
                examType: exam.examType,
                isLiveExam: true,
                startTime: exam.startTime,
                endTime: exam.endTime,
                status,
                questionCount: questionSet.validQuestions.length,
                rawQuestionCount: questionSet.rawQuestionCount,
                invalidQuestionCount: questionSet.invalidQuestions.length,
                invalidQuestions: questionSet.invalidQuestions,
                hasSubmitted: Boolean(submission),
                submission: submission
                    ? {
                        score: submission.score,
                        submittedAt: submission.submittedAt
                    }
                    : null,
                canPreview: admin && status === 'upcoming',
                canEnter: status === 'open' || status === 'ended' || (admin && status === 'upcoming'),
                canSubmit: status === 'open',
                canReview: status === 'ended'
            }
        });
    } catch (error) {
        console.error('[assessmentController:getAssessmentSummary]', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAssessmentExam = async (req, res) => {
    try {
        const { exam, questionSet, status } = await getAssessmentContext();
        const admin = isAdmin(req.user);

        if (!questionSet.validQuestions.length) {
            return res.status(404).json({
                success: false,
                message: 'No valid assessment questions were found.',
                invalidQuestions: questionSet.invalidQuestions
            });
        }

        if (status === 'upcoming' && !admin) {
            return res.status(403).json({
                success: false,
                message: `This assessment test unlocks on ${ASSESSMENT_START_TIME.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })} Bangladesh time.`
            });
        }

        const includeAnswers = status === 'ended' || (admin && status === 'upcoming');
        const assessmentMode = admin && status === 'upcoming' ? 'preview' : 'exam';

        res.status(200).json({
            success: true,
            data: buildAssessmentExamPayload(exam, questionSet, { includeAnswers, assessmentMode })
        });
    } catch (error) {
        console.error('[assessmentController:getAssessmentExam]', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.submitAssessmentExam = async (req, res) => {
    try {
        const studentId = req.user?._id || req.user?.id;
        const { answers } = req.body;
        const submissionReason = normalizeSubmissionReason(req.body.submissionReason);

        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Not authorized, please log in again before submitting.' });
        }

        if (!Array.isArray(answers)) {
            return res.status(400).json({ success: false, message: 'Please submit answers as an array of selected option indexes.' });
        }

        const { exam, questionSet, status } = await getAssessmentContext();

        if (!questionSet.validQuestions.length) {
            return res.status(400).json({
                success: false,
                message: 'This assessment test has no valid questions to grade.'
            });
        }

        if (status === 'upcoming') {
            return res.status(403).json({
                success: false,
                message: 'This assessment test has not started yet.'
            });
        }

        if (status === 'ended') {
            return res.status(403).json({
                success: false,
                message: 'The assessment test submission portal has closed.'
            });
        }

        const normalizedExam = buildAssessmentExamPayload(exam, questionSet, { includeAnswers: true });
        const existingSubmission = await Submission.findOne({
            student: studentId,
            exam: normalizedExam._id
        });

        if (existingSubmission) {
            return res.status(200).json(buildSubmissionResponse(existingSubmission, normalizedExam, { alreadySubmitted: true }));
        }

        const graded = gradeAnswers(normalizedExam, answers);

        try {
            const submission = await Submission.create({
                student: studentId,
                exam: normalizedExam._id,
                answers,
                score: graded.score,
                submissionReason
            });

            return res.status(201).json(buildSubmissionResponse(submission, normalizedExam));
        } catch (error) {
            if (error.code !== 11000) throw error;

            const duplicateSubmission = await Submission.findOne({
                student: studentId,
                exam: normalizedExam._id
            });

            if (!duplicateSubmission) throw error;
            return res.status(200).json(buildSubmissionResponse(duplicateSubmission, normalizedExam, { alreadySubmitted: true }));
        }
    } catch (error) {
        console.error('[assessmentController:submitAssessmentExam]', error);
        const status = error instanceof mongoose.Error.ValidationError ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};
