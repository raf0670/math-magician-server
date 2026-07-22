const Exam = require('../models/Exam');
const Submission = require('../models/Submission');
const QuestionBank = require('../models/QuestionBank');
const mongoose = require('mongoose');

const SUBJECTS = ['Math', 'English', 'Analytical'];
const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];
const LEGACY_GENERATED_EXAM_TITLE = /Random Questions/i;
const LIVE_EXAM_SOURCE = 'liveExam';
const QUIZ_SUBJECT_WEIGHTS = [
    { subject: 'English', weight: 45 },
    { subject: 'Math', weight: 35 },
    { subject: 'Analytical', weight: 20 }
];

function buildOfficialExamFilter() {
    return {
        $and: [
            {
                $or: [
                    { examType: 'official' },
                    { examType: { $exists: false } }
                ]
            },
            { title: { $not: LEGACY_GENERATED_EXAM_TITLE } },
            {
                $or: [
                    { isLiveExam: false },
                    { isLiveExam: { $exists: false } }
                ]
            }
        ]
    };
}

function buildQuestionSelect(includeAnswers = false) {
    const baseFields = 'questionNo question_no question questionText options subject difficulty chapter topic subTopic explanation source createdBy';
    return includeAnswers ? `${baseFields} correctOptionIndex correctAnswer correct_answer` : baseFields;
}

function clean(value) {
    return value?.toString().trim() || '';
}

function getLiveExamStatus(exam, now = new Date()) {
    const startTime = exam?.startTime ? new Date(exam.startTime) : null;
    const endTime = exam?.endTime ? new Date(exam.endTime) : null;

    if (!startTime || Number.isNaN(startTime.getTime()) || !endTime || Number.isNaN(endTime.getTime())) {
        return 'scheduled';
    }

    if (now < startTime) return 'upcoming';
    if (now <= endTime) return 'open';
    return 'ended';
}

function calculateDurationMinutes(startTime, endTime) {
    const durationMs = endTime.getTime() - startTime.getTime();
    return Math.max(1, Math.ceil(durationMs / 60000));
}

function getEffectiveNegativeMarksPerQuestion(value) {
    const penalty = Number(value);
    return Number.isFinite(penalty) && penalty > 0 ? penalty : 0.25;
}

function normalizeSubject(subject = '') {
    const rawSubject = subject == null ? '' : subject.toString().trim();
    const cleaned = rawSubject.toLowerCase();

    if (['math', 'maths', 'mathematics'].includes(cleaned)) return 'Math';
    if (cleaned === 'english') return 'English';
    if (['analytical', 'analysis', 'analytic'].includes(cleaned)) return 'Analytical';

    return rawSubject;
}

function escapedRegex(value) {
    return (value == null ? '' : value.toString()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSubjectRegex(subject) {
    if (subject === 'Math') return /^(math|maths|mathematics)$/i;
    if (subject === 'English') return /^english$/i;
    if (subject === 'Analytical') return /^(analytical|analysis|analytic)$/i;
    return new RegExp(`^${escapedRegex(subject)}$`, 'i');
}

function buildDifficultyRegex(difficulty) {
    return new RegExp(`^${escapedRegex(difficulty)}$`, 'i');
}

function buildRecognizedSubjectFilter() {
    return {
        $or: SUBJECTS.map((subject) => ({ subject: buildSubjectRegex(subject) }))
    };
}

function calculateQuizSubjectTargets(questionCount) {
    const baseTargets = QUIZ_SUBJECT_WEIGHTS.map((item, index) => {
        const rawCount = (questionCount * item.weight) / 100;
        return {
            ...item,
            index,
            count: Math.floor(rawCount),
            remainder: rawCount - Math.floor(rawCount)
        };
    });

    let remainingQuestions = questionCount - baseTargets.reduce((sum, item) => sum + item.count, 0);
    const remainderOrder = [...baseTargets].sort((first, second) => {
        if (second.remainder !== first.remainder) return second.remainder - first.remainder;
        return first.index - second.index;
    });

    for (let index = 0; remainingQuestions > 0; index += 1) {
        remainderOrder[index % remainderOrder.length].count += 1;
        remainingQuestions -= 1;
    }

    return baseTargets.map(({ subject, count }) => ({ subject, count }));
}

function shuffleQuestions(questions) {
    const shuffled = [...questions];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function normalizeOptionText(value) {
    return value?.toString().trim().toLowerCase() || '';
}

function stripOptionLabel(value) {
    return normalizeOptionText(value).replace(/^[a-e]\s*[\).:-]\s*/, '').trim();
}

function getCorrectOptionIndex(question) {
    if (!question || !Array.isArray(question.options)) return null;

    if (Number.isInteger(question.correctOptionIndex) && question.correctOptionIndex >= 0 && question.correctOptionIndex < question.options.length) {
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

function normalizeQuestionForClient(question) {
    if (!question) return null;

    const plainQuestion = question.toObject ? question.toObject() : question;
    const questionText = plainQuestion.questionText || plainQuestion.question || '';
    const topic = plainQuestion.topic || plainQuestion.chapter || '';
    const chapter = plainQuestion.chapter || plainQuestion.topic || '';
    const correctOptionIndex = getCorrectOptionIndex(plainQuestion);
    const correctAnswer = correctOptionIndex === null
        ? plainQuestion.correctAnswer || plainQuestion.correct_answer || ''
        : plainQuestion.options?.[correctOptionIndex] || plainQuestion.correctAnswer || plainQuestion.correct_answer || '';

    return {
        ...plainQuestion,
        questionNo: plainQuestion.questionNo || plainQuestion.question_no,
        question_no: plainQuestion.question_no || plainQuestion.questionNo,
        question: plainQuestion.question || questionText,
        questionText,
        topic,
        chapter,
        subTopic: plainQuestion.subTopic || '',
        correctOptionIndex,
        correctAnswer,
        correct_answer: plainQuestion.correct_answer || correctAnswer
    };
}

function redactQuestionAnswers(question) {
    if (!question) return question;
    const redacted = { ...question };
    delete redacted.correctOptionIndex;
    delete redacted.correctAnswer;
    delete redacted.correct_answer;
    return redacted;
}

function normalizeExamForClient(exam) {
    if (!exam) return null;

    const plainExam = exam.toObject ? exam.toObject() : exam;
    return {
        ...plainExam,
        negativeMarksPerQuestion: getEffectiveNegativeMarksPerQuestion(plainExam.negativeMarksPerQuestion),
        questions: (plainExam.questions || [])
            .map(normalizeQuestionForClient)
            .filter(Boolean)
    };
}

async function normalizePopulatedExam(exam, options = {}) {
    if (!exam) return null;
    const includeAnswers = options.includeAnswers !== false;

    const plainExam = exam.toObject ? exam.toObject() : exam;
    let normalizedQuestions = (plainExam.questions || [])
        .map(normalizeQuestionForClient)
        .filter((question) => question?.questionText && Array.isArray(question.options) && question.options.length);

    if (normalizedQuestions.length === 0 && plainExam.questions?.length) {
        const questionIds = plainExam.questions
            .map((question) => question?._id || question)
            .filter(Boolean);
        const fallbackQuestions = await QuestionBank.find({ _id: { $in: questionIds } }).select(buildQuestionSelect(true)).lean();
        const fallbackById = new Map(fallbackQuestions.map((question) => [question._id.toString(), question]));

        normalizedQuestions = questionIds
            .map((questionId) => fallbackById.get(questionId.toString()))
            .map(normalizeQuestionForClient)
            .filter((question) => question?.questionText && Array.isArray(question.options) && question.options.length);
    }

    return {
        ...plainExam,
        negativeMarksPerQuestion: getEffectiveNegativeMarksPerQuestion(plainExam.negativeMarksPerQuestion),
        questions: includeAnswers ? normalizedQuestions : normalizedQuestions.map(redactQuestionAnswers)
    };
}

function normalizeLabeledOption(option, index) {
    const text = clean(option);
    const label = OPTION_LABELS[index];
    const labelPattern = new RegExp(`^${label}\\s*[).:-]\\s*`, 'i');
    return labelPattern.test(text) ? text : `${label}) ${text}`;
}

function parseLiveExamPayload(body = {}, userId) {
    const title = clean(body.title);
    const startTime = new Date(body.startTime);
    const endTime = new Date(body.endTime);
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const errors = [];

    if (!title) errors.push('Live exam title is required.');
    if (Number.isNaN(startTime.getTime())) errors.push('Please add a valid start time.');
    if (Number.isNaN(endTime.getTime())) errors.push('Please add a valid end time.');
    if (!Number.isNaN(startTime.getTime()) && !Number.isNaN(endTime.getTime()) && endTime <= startTime) {
        errors.push('Live exam end time must be after the start time.');
    }
    if (!questions.length) errors.push('Please add at least one question.');

    const normalizedQuestions = questions.map((item, questionIndex) => {
        const subject = clean(item.subject);
        const topic = clean(item.topic);
        const subTopic = clean(item.subTopic);
        const difficulty = clean(item.difficulty);
        const questionText = clean(item.question || item.questionText);
        const explanation = clean(item.explanation);
        const rawOptions = Array.isArray(item.options) ? item.options.map(clean) : [];
        const options = rawOptions.map(normalizeLabeledOption);
        const correctAnswer = clean(item.correct_answer || item.correctAnswer);

        if (!subject) errors.push(`Question ${questionIndex + 1}: subject is required.`);
        if (!topic) errors.push(`Question ${questionIndex + 1}: topic is required.`);
        if (!subTopic) errors.push(`Question ${questionIndex + 1}: sub-topic is required.`);
        if (!difficulty) errors.push(`Question ${questionIndex + 1}: difficulty is required.`);
        if (!questionText) errors.push(`Question ${questionIndex + 1}: question text is required.`);
        if (!explanation) errors.push(`Question ${questionIndex + 1}: explanation is required.`);
        if (rawOptions.length !== 5 || rawOptions.some((option) => !option)) {
            errors.push(`Question ${questionIndex + 1}: exactly five options are required.`);
        }

        const normalizedCorrectAnswer = normalizeOptionText(correctAnswer);
        const strippedCorrectAnswer = stripOptionLabel(correctAnswer);
        const correctOptionIndex = options.findIndex((option) => (
            normalizeOptionText(option) === normalizedCorrectAnswer
            || stripOptionLabel(option) === strippedCorrectAnswer
        ));
        if (correctOptionIndex < 0) {
            errors.push(`Question ${questionIndex + 1}: correct answer must match one of the five options.`);
        }

        return {
            questionNo: questionIndex + 1,
            question_no: questionIndex + 1,
            question: questionText,
            questionText,
            options,
            correctOptionIndex: Math.max(correctOptionIndex, 0),
            correctAnswer: correctOptionIndex >= 0 ? options[correctOptionIndex] : correctAnswer,
            correct_answer: correctOptionIndex >= 0 ? options[correctOptionIndex] : correctAnswer,
            subject,
            difficulty,
            chapter: topic,
            topic,
            subTopic,
            explanation,
            source: LIVE_EXAM_SOURCE,
            createdBy: userId
        };
    });

    return {
        payload: {
            title,
            startTime,
            endTime,
            duration: Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())
                ? 1
                : calculateDurationMinutes(startTime, endTime),
            questions: normalizedQuestions
        },
        errors
    };
}

function serializeExamSummary(exam, submissionByExamId = new Map()) {
    const plainExam = exam.toObject ? exam.toObject() : exam;
    const examId = plainExam._id?.toString();
    const submission = examId ? submissionByExamId.get(examId) : null;

    return {
        ...plainExam,
        status: getLiveExamStatus(plainExam),
        questionCount: plainExam.questions?.length || 0,
        negativeMarksPerQuestion: getEffectiveNegativeMarksPerQuestion(plainExam.negativeMarksPerQuestion),
        hasSubmitted: Boolean(submission),
        submission: submission
            ? {
                score: submission.score,
                submittedAt: submission.submittedAt
            }
            : null
    };
}

function logExamError(action, error) {
    console.error(`[examController:${action}]`, error);
}

function buildQuestionReview(question, answer) {
    const normalizedQuestion = normalizeQuestionForClient(question);
    const selectedOption = answer === undefined || answer === null || answer === -1
        ? null
        : normalizedQuestion.options?.[answer] || null;
    const correctOption = normalizedQuestion.options?.[normalizedQuestion.correctOptionIndex] || normalizedQuestion.correctAnswer || null;

    return {
        questionId: normalizedQuestion._id,
        selectedOptionIndex: answer,
        selectedOption,
        correctOptionIndex: normalizedQuestion.correctOptionIndex,
        correctAnswer: correctOption,
        isCorrect: answer === normalizedQuestion.correctOptionIndex,
        explanation: normalizedQuestion.explanation || ''
    };
}

// @desc    List all exams for the dashboard
// @route   GET /api/exams
// @access  Private
exports.getAllExams = async (req, res) => {
    try {
        const exams = await Exam.find(buildOfficialExamFilter())
            .sort({ createdAt: -1 })
            .select('title duration totalMarks negativeMarksPerQuestion examType allowRetakes isLiveExam startTime endTime questions createdAt');

        const data = exams.map((exam) => ({
            ...exam.toObject(),
            questionCount: exam.questions.length
        }));

        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        logExamError('getAllExams', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get selectable subjects, topics, and question counts
// @route   GET /api/exams/practice/meta
// @access  Private
exports.getPracticeMeta = async (req, res) => {
    try {
        const topicRows = await QuestionBank.aggregate([
            {
                $addFields: {
                    effectiveTopic: { $ifNull: ['$topic', '$chapter'] }
                }
            },
            {
                $group: {
                    _id: {
                        subject: '$subject',
                        topic: '$effectiveTopic'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.subject': 1, '_id.topic': 1 } }
        ]);

        const data = SUBJECTS.map((subject) => ({
            name: subject,
            topics: topicRows
                .filter((row) => normalizeSubject(row._id.subject) === subject && row._id.topic)
                .map((row) => ({
                    name: row._id.topic,
                    questionCount: row.count
                }))
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        logExamError('getPracticeMeta', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Create a custom untimed practice exam from subject/topic/count
// @route   POST /api/exams/practice/start
// @access  Private
exports.startPracticeExam = async (req, res) => {
    try {
        const subject = normalizeSubject(req.body.subject);
        const topic = req.body.topic?.toString().trim();
        const questionCount = Number(req.body.questionCount);

        if (!SUBJECTS.includes(subject)) {
            return res.status(400).json({ success: false, message: 'Please choose Math, English, or Analytical.' });
        }

        if (!topic) {
            return res.status(400).json({ success: false, message: 'Please choose a topic before starting the exam.' });
        }

        if (!Number.isInteger(questionCount) || questionCount < 1) {
            return res.status(400).json({ success: false, message: 'Please choose a valid number of questions.' });
        }

        const subjectRegex = buildSubjectRegex(subject);
        const topicRegex = new RegExp(`^${escapedRegex(topic)}$`, 'i');
        const questionFilter = {
            subject: subjectRegex,
            $or: [
                { topic: topicRegex },
                { chapter: topicRegex }
            ]
        };
        const availableQuestionCount = await QuestionBank.countDocuments(questionFilter);

        if (availableQuestionCount === 0) {
            return res.status(404).json({ success: false, message: 'No questions were found for this topic.' });
        }

        if (questionCount > availableQuestionCount) {
            return res.status(400).json({
                success: false,
                message: `Only ${availableQuestionCount} question${availableQuestionCount === 1 ? '' : 's'} are available for this topic.`
            });
        }

        const questions = await QuestionBank.aggregate([
            {
                $match: questionFilter
            },
            { $sample: { size: questionCount } }
        ]);

        if (questions.length === 0) {
            return res.status(404).json({ success: false, message: 'No questions were found for this topic.' });
        }

        const exam = await Exam.create({
            title: `${subject} - ${topic} Practice (${questions.length} Questions)`,
            questions: questions.map((question) => question._id),
            duration: 0,
            totalMarks: questions.length,
            negativeMarksPerQuestion: 0.25,
            examType: 'generatedPractice',
            allowRetakes: true,
            isLiveExam: false
        });

        const normalizedQuestions = questions
            .map(normalizeQuestionForClient)
            .filter((question) => question?.questionText && Array.isArray(question.options) && question.options.length);

        const responseExam = {
            ...exam.toObject(),
            questions: normalizedQuestions
        };

        res.status(201).json({ success: true, data: responseExam });
    } catch (error) {
        logExamError('startPracticeExam', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Create a timed real-exam style quiz from count, duration, and difficulty
// @route   POST /api/exams/quiz/start
// @access  Private
exports.startQuizExam = async (req, res) => {
    try {
        const questionCount = Number(req.body.questionCount);
        const duration = Number(req.body.duration);
        const difficulty = req.body.difficulty?.toString().trim();

        if (!Number.isInteger(questionCount) || questionCount < 20) {
            return res.status(400).json({ success: false, message: 'Please choose at least 20 questions for a quiz.' });
        }

        if (!Number.isInteger(duration) || duration < 1) {
            return res.status(400).json({ success: false, message: 'Please choose a valid quiz duration in minutes.' });
        }

        if (!difficulty) {
            return res.status(400).json({ success: false, message: 'Please choose a difficulty level before starting the quiz.' });
        }

        const difficultyRegex = buildDifficultyRegex(difficulty);
        const quizBaseFilter = {
            difficulty: difficultyRegex,
            ...buildRecognizedSubjectFilter()
        };
        const totalAvailableQuestionCount = await QuestionBank.countDocuments(quizBaseFilter);

        if (totalAvailableQuestionCount < questionCount) {
            return res.status(400).json({
                success: false,
                message: `Only ${totalAvailableQuestionCount} ${difficulty} question${totalAvailableQuestionCount === 1 ? '' : 's'} are available for quiz generation.`
            });
        }

        const subjectTargets = calculateQuizSubjectTargets(questionCount);
        const selectedQuestions = [];
        const selectedQuestionIds = [];

        for (const target of subjectTargets) {
            if (target.count < 1) continue;

            const subjectQuestions = await QuestionBank.aggregate([
                {
                    $match: {
                        difficulty: difficultyRegex,
                        subject: buildSubjectRegex(target.subject)
                    }
                },
                { $sample: { size: target.count } }
            ]);

            selectedQuestions.push(...subjectQuestions);
            selectedQuestionIds.push(...subjectQuestions.map((question) => question._id));
        }

        const remainingQuestionCount = questionCount - selectedQuestions.length;
        if (remainingQuestionCount > 0) {
            const fillerQuestions = await QuestionBank.aggregate([
                {
                    $match: {
                        difficulty: difficultyRegex,
                        _id: { $nin: selectedQuestionIds },
                        ...buildRecognizedSubjectFilter()
                    }
                },
                { $sample: { size: remainingQuestionCount } }
            ]);

            selectedQuestions.push(...fillerQuestions);
            selectedQuestionIds.push(...fillerQuestions.map((question) => question._id));
        }

        if (selectedQuestions.length < questionCount) {
            return res.status(400).json({
                success: false,
                message: `Not enough ${difficulty} questions are available to build this quiz right now.`
            });
        }

        const shuffledQuestions = shuffleQuestions(selectedQuestions).slice(0, questionCount);
        const exam = await Exam.create({
            title: `${difficulty} Quiz (${shuffledQuestions.length} Questions)`,
            questions: shuffledQuestions.map((question) => question._id),
            duration,
            totalMarks: shuffledQuestions.length,
            negativeMarksPerQuestion: 0.25,
            examType: 'generatedQuiz',
            allowRetakes: true,
            isLiveExam: false
        });

        const normalizedQuestions = shuffledQuestions
            .map(normalizeQuestionForClient)
            .filter((question) => question?.questionText && Array.isArray(question.options) && question.options.length);

        const responseExam = {
            ...exam.toObject(),
            questions: normalizedQuestions
        };

        res.status(201).json({ success: true, data: responseExam });
    } catch (error) {
        logExamError('startQuizExam', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    List live exams for students
// @route   GET /api/exams/live
// @access  Private
exports.getLiveExams = async (req, res) => {
    try {
        const exams = await Exam.find({ isLiveExam: true })
            .sort({ startTime: -1 })
            .select('title duration totalMarks negativeMarksPerQuestion examType allowRetakes isLiveExam startTime endTime questions createdAt createdBy')
            .lean();

        const examIds = exams.map((exam) => exam._id);
        const submissions = await Submission.find({
            student: req.user.id,
            exam: { $in: examIds }
        })
            .select('exam score submittedAt')
            .lean();
        const submissionByExamId = new Map(submissions.map((submission) => [submission.exam.toString(), submission]));
        const data = exams.map((exam) => serializeExamSummary(exam, submissionByExamId));

        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        logExamError('getLiveExams', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    List live exams with questions for admins
// @route   GET /api/exams/live/admin
// @access  Private/Admin
exports.getAdminLiveExams = async (req, res) => {
    try {
        const exams = await Exam.find({ isLiveExam: true })
            .sort({ startTime: -1 })
            .populate({
                path: 'questions',
                select: buildQuestionSelect(true)
            })
            .populate('createdBy', 'name email');

        const data = exams.map((exam) => ({
            ...normalizeExamForClient(exam),
            status: getLiveExamStatus(exam),
            questionCount: exam.questions?.length || 0
        }));

        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        logExamError('getAdminLiveExams', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Create a scheduled live exam and its authored questions
// @route   POST /api/exams/live/admin
// @access  Private/Admin
exports.createLiveExam = async (req, res) => {
    try {
        const { payload, errors } = parseLiveExamPayload(req.body, req.user._id);

        if (errors.length) {
            return res.status(400).json({ success: false, message: errors[0], errors });
        }

        const questions = await QuestionBank.insertMany(payload.questions, { ordered: true });
        const exam = await Exam.create({
            title: payload.title,
            questions: questions.map((question) => question._id),
            duration: payload.duration,
            totalMarks: questions.length,
            negativeMarksPerQuestion: 0.25,
            examType: 'official',
            allowRetakes: false,
            isLiveExam: true,
            startTime: payload.startTime,
            endTime: payload.endTime,
            createdBy: req.user._id
        });

        const populated = await Exam.findById(exam._id)
            .populate({
                path: 'questions',
                select: buildQuestionSelect(true)
            })
            .populate('createdBy', 'name email');

        res.status(201).json({ success: true, data: await normalizePopulatedExam(populated) });
    } catch (error) {
        logExamError('createLiveExam', error);
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

// @desc    Update a scheduled live exam and replace its authored questions
// @route   PATCH /api/exams/live/admin/:id
// @access  Private/Admin
exports.updateLiveExam = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Live exam was not found.' });
        }

        const existingExam = await Exam.findOne({ _id: req.params.id, isLiveExam: true });
        if (!existingExam) {
            return res.status(404).json({ success: false, message: 'Live exam was not found.' });
        }

        const { payload, errors } = parseLiveExamPayload(req.body, req.user._id);
        if (errors.length) {
            return res.status(400).json({ success: false, message: errors[0], errors });
        }

        const oldQuestionIds = existingExam.questions || [];
        const questions = await QuestionBank.insertMany(payload.questions, { ordered: true });
        const updatedExam = await Exam.findByIdAndUpdate(
            existingExam._id,
            {
                title: payload.title,
                questions: questions.map((question) => question._id),
                duration: payload.duration,
                totalMarks: questions.length,
                negativeMarksPerQuestion: 0.25,
                examType: 'official',
                allowRetakes: false,
                isLiveExam: true,
                startTime: payload.startTime,
                endTime: payload.endTime
            },
            { new: true, runValidators: true }
        )
            .populate({
                path: 'questions',
                select: buildQuestionSelect(true)
            })
            .populate('createdBy', 'name email');

        await QuestionBank.deleteMany({
            _id: { $in: oldQuestionIds },
            source: LIVE_EXAM_SOURCE
        });

        res.status(200).json({ success: true, data: await normalizePopulatedExam(updatedExam) });
    } catch (error) {
        logExamError('updateLiveExam', error);
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

// @desc    Create a new exam setup
// @route   POST /api/exams
// @access  Private/Admin
exports.createExam = async (req, res) => {
    try {
        const { title, questions, duration, totalMarks } = req.body;
        const exam = await Exam.create({ title, questions, duration, totalMarks });
        res.status(201).json({ success: true, data: exam });
    } catch (error) {
        logExamError('createExam', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get an individual exam with its full questions (without exposing answer keys if preferred)
// @route   GET /api/exams/:id
// @access  Private
exports.getExam = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Exam configuration not found' });
        }

        // Populate the exam with actual question text and option arrays
        const exam = await Exam.findById(req.params.id).populate({
            path: 'questions',
            select: buildQuestionSelect(true)
        });

        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam configuration not found' });
        }

        if (exam.isLiveExam) {
            const currentTime = new Date();
            if (currentTime < exam.startTime) {
                return res.status(403).json({
                    success: false,
                    message: `This live exam hasn't started yet. It will unlock at ${exam.startTime.toLocaleString()}`
                });
            }

            const includeAnswers = currentTime > exam.endTime;
            return res.status(200).json({ success: true, data: await normalizePopulatedExam(exam, { includeAnswers }) });
        }

        res.status(200).json({ success: true, data: await normalizePopulatedExam(exam) });
    } catch (error) {
        logExamError('getExam', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Submit answers and grade the test instantly
// @route   POST /api/exams/:id/submit
// @access  Private
exports.submitExam = async (req, res) => {
    try {
        const studentId = req.user?._id || req.user?.id;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'Not authorized, please log in again before submitting.' });
        }

        const { answers } = req.body; // e.g. [0, 2, 1, 3]
        if (!Array.isArray(answers)) {
            return res.status(400).json({ success: false, message: 'Please submit answers as an array of selected option indexes.' });
        }

        const exam = await Exam.findById(req.params.id).populate('questions');

        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        // DOUBLE-SUBMISSION GUARD
        if (!exam.allowRetakes) {
            const existingSubmission = await Submission.findOne({
                student: studentId,
                exam: exam._id
            });

            if (existingSubmission) {
                return res.status(400).json({
                    success: false,
                    message: 'You have already submitted this exam. Retakes are restricted.'
                });
            }
        }

        // NEW LIVE EXAM DEADLINE GATE
        if (exam.isLiveExam) {
            const currentTime = new Date();
            if (currentTime < exam.startTime) {
                return res.status(403).json({
                    success: false,
                    message: 'This live exam has not started yet.'
                });
            }

            if (currentTime > exam.endTime) {
                return res.status(403).json({
                    success: false,
                    message: 'The submission portal has closed! You missed the official live exam deadline.'
                });
            }
        }

        let dynamicScore = 0;
        const normalizedExam = await normalizePopulatedExam(exam);
        const questions = normalizedExam.questions || [];
        const totalQuestions = questions.length;
        if (totalQuestions === 0) {
            return res.status(400).json({ success: false, message: 'This exam has no available questions to grade.' });
        }

        const marksPerQuestion = exam.totalMarks / totalQuestions;

        const penalty = getEffectiveNegativeMarksPerQuestion(exam.negativeMarksPerQuestion);
        const review = [];

        // Loop through questions to evaluate correct values
        questions.forEach((question, index) => {
            const studentAnswer = answers[index];

            // Case 1: Student skipped the question (represented as null or -1)
            if (studentAnswer === undefined || studentAnswer === null || studentAnswer === -1) {
                review.push(buildQuestionReview(question, studentAnswer));
                return; // No points added, no penalty applied
            }

            // Case 2: Correct Answer
            if (studentAnswer === question.correctOptionIndex) {
                dynamicScore += marksPerQuestion;
            }
            // Case 3: Wrong Answer (Apply Penalty)
            else {
                dynamicScore -= penalty;
            }

            review.push(buildQuestionReview(question, studentAnswer));
        });

        // Save student attempt profile to database
        const submission = await Submission.create({
            student: studentId,
            exam: exam._id,
            answers,
            score: parseFloat(dynamicScore.toFixed(2))
        });

        res.status(201).json({
            success: true,
            message: 'Exam graded successfully!',
            score: dynamicScore,
            totalMarks: exam.totalMarks,
            negativeMarksPerQuestion: penalty,
            review,
            submissionId: submission._id
        });

    } catch (error) {
        logExamError('submitExam', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
