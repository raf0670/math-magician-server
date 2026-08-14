const Exam = require('../models/Exam');
const Submission = require('../models/Submission');
const QuestionBank = require('../models/QuestionBank');
const mongoose = require('mongoose');
const { normalizeCompetitionCategory } = require('../config/competition');

const SUBJECTS = ['Math', 'English', 'Analytical'];
const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];
const GROUP_KEY_SEPARATOR = '::';
const GROUPED_TOPIC_RULES = [
    { key: 'analytical-puzzle', subject: 'Analytical', topicRegex: /^puzzle$/i },
    { key: 'english-reading-comprehension', subject: 'English', topicRegex: /^reading comprehension$/i }
];
const LEGACY_GENERATED_EXAM_TITLE = /Random Questions/i;
const LIVE_EXAM_SOURCE = 'liveExam';
const LIVE_EXAM_CACHE_TTL_MS = Number(process.env.LIVE_EXAM_CACHE_TTL_MS) || 5 * 60 * 1000;
const LIVE_EXAM_CACHE_GRACE_MS = Number(process.env.LIVE_EXAM_CACHE_GRACE_MS) || 10 * 60 * 1000;
const liveExamCache = new Map();
const QUIZ_SUBJECT_WEIGHTS = [
    { subject: 'English', weight: 45 },
    { subject: 'Math', weight: 35 },
    { subject: 'Analytical', weight: 20 }
];
const SUBMISSION_REASONS = new Set(['manual', 'timer_expired', 'tab_switch']);

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
    const baseFields = 'questionNo question_no set_number question questionText options subject difficulty chapter topic subTopic explanation source createdBy';
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

function normalizeSubmissionReason(value) {
    const reason = clean(value);
    return SUBMISSION_REASONS.has(reason) ? reason : 'manual';
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

function buildPracticeQuestionSourceFilter() {
    return {
        source: { $ne: LIVE_EXAM_SOURCE }
    };
}

function buildGroupedTopicFieldFilter(groupedTopicRule) {
    return {
        $or: [
            { topic: groupedTopicRule.topicRegex },
            { chapter: groupedTopicRule.topicRegex }
        ]
    };
}

function buildNotGroupedTopicFieldFilter(subject) {
    const groupedTopicRules = getGroupedTopicRulesForSubject(subject);
    if (!groupedTopicRules.length) return null;

    return {
        $nor: groupedTopicRules.flatMap((groupedTopicRule) => [
            { topic: groupedTopicRule.topicRegex },
            { chapter: groupedTopicRule.topicRegex }
        ])
    };
}

function withExcludedQuestionIds(filter, excludedQuestionIds = []) {
    const ids = excludedQuestionIds.filter(Boolean);
    if (!ids.length) return filter;

    return {
        $and: [
            filter,
            { _id: { $nin: ids } }
        ]
    };
}

function buildFilter(...filters) {
    const activeFilters = filters.filter(Boolean);
    if (activeFilters.length === 1) return activeFilters[0];
    return { $and: activeFilters };
}

function getGroupedTopicRulesForSubject(subject) {
    const normalizedSubject = normalizeSubject(subject);
    return GROUPED_TOPIC_RULES.filter((groupedTopicRule) => groupedTopicRule.subject === normalizedSubject);
}

function getGroupedTopicRuleForRequest(subject, topic) {
    const normalizedSubject = normalizeSubject(subject);
    return GROUPED_TOPIC_RULES.find((groupedTopicRule) => (
        groupedTopicRule.subject === normalizedSubject && groupedTopicRule.topicRegex.test(topic || '')
    )) || null;
}

function normalizePracticeTopics(body = {}) {
    const rawTopics = Array.isArray(body.topics) ? body.topics : [body.topic];
    const topicMap = new Map();

    for (const rawTopic of rawTopics) {
        const topic = clean(rawTopic);
        if (!topic) continue;

        const topicKey = topic.toLowerCase();
        if (!topicMap.has(topicKey)) {
            topicMap.set(topicKey, topic);
        }
    }

    return [...topicMap.values()];
}

function buildTopicQuestionFilter(subjectRegex, topic) {
    const topicRegex = new RegExp(`^${escapedRegex(topic)}$`, 'i');

    return {
        ...buildPracticeQuestionSourceFilter(),
        subject: subjectRegex,
        $or: [
            { topic: topicRegex },
            { chapter: topicRegex }
        ]
    };
}

function calculatePracticeTopicTargets(topicRows, questionCount) {
    if (!topicRows.length || questionCount < 1) return [];

    const targets = topicRows.map((topicRow) => ({
        ...topicRow,
        targetCount: Math.floor(questionCount / topicRows.length)
    }));
    const remainder = questionCount - targets.reduce((sum, topicRow) => sum + topicRow.targetCount, 0);
    const remainderTargets = shuffleQuestions(targets).slice(0, remainder);

    for (const topicRow of remainderTargets) {
        topicRow.targetCount += 1;
    }

    let deficit = 0;
    for (const topicRow of targets) {
        if (topicRow.targetCount > topicRow.availableQuestionCount) {
            deficit += topicRow.targetCount - topicRow.availableQuestionCount;
            topicRow.targetCount = topicRow.availableQuestionCount;
        }
    }

    while (deficit > 0) {
        const topicsWithCapacity = shuffleQuestions(
            targets.filter((topicRow) => topicRow.targetCount < topicRow.availableQuestionCount)
        );
        if (!topicsWithCapacity.length) break;

        for (const topicRow of topicsWithCapacity) {
            if (deficit <= 0) break;

            topicRow.targetCount += 1;
            deficit -= 1;
        }
    }

    return targets;
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

function getGroupedTopicRuleForQuestion(question) {
    if (!question || question.set_number === undefined || question.set_number === null) return null;
    const normalizedSubject = normalizeSubject(question.subject);

    return GROUPED_TOPIC_RULES.find((groupedTopicRule) => (
        groupedTopicRule.subject === normalizedSubject
        && (groupedTopicRule.topicRegex.test(question.topic || '') || groupedTopicRule.topicRegex.test(question.chapter || ''))
    )) || null;
}

function buildGroupKey(groupedTopicRule, setNumber) {
    return `${groupedTopicRule.key}${GROUP_KEY_SEPARATOR}${setNumber}`;
}

function getQuestionGroupKey(question) {
    const groupedTopicRule = getGroupedTopicRuleForQuestion(question);
    return groupedTopicRule ? buildGroupKey(groupedTopicRule, question.set_number) : '';
}

function getQuestionGroupKeys(questions = []) {
    return [...new Set(
        questions
            .map(getQuestionGroupKey)
            .filter(Boolean)
    )];
}

function shuffleQuestionGroups(questions) {
    const groups = [];

    for (const question of questions) {
        const previousGroup = groups[groups.length - 1];
        const previousQuestion = previousGroup?.[previousGroup.length - 1];
        const questionGroupKey = getQuestionGroupKey(question);

        if (questionGroupKey && questionGroupKey === getQuestionGroupKey(previousQuestion)) {
            previousGroup.push(question);
        } else {
            groups.push([question]);
        }
    }

    return shuffleQuestions(groups).flat();
}

function getQuestionSortPipeline() {
    return [
        {
            $addFields: {
                effectiveQuestionNo: { $ifNull: ['$question_no', '$questionNo'] }
            }
        },
        {
            $sort: {
                effectiveQuestionNo: 1,
                question_no: 1,
                questionNo: 1,
                _id: 1
            }
        },
        {
            $project: {
                effectiveQuestionNo: 0
            }
        }
    ];
}

async function getRandomGroupedSetRows(questionFilter, groupedTopicRule, excludedQuestionIds = [], excludedGroupKeys = []) {
    const setFilter = withExcludedQuestionIds(
        buildFilter(
            questionFilter,
            buildGroupedTopicFieldFilter(groupedTopicRule),
            { set_number: { $exists: true, $ne: null } }
        ),
        excludedQuestionIds
    );
    const setRows = await QuestionBank.aggregate([
        { $match: setFilter },
        {
            $group: {
                _id: '$set_number',
                count: { $sum: 1 }
            }
        }
    ]);

    return shuffleQuestions(
        setRows.filter((setRow) => !excludedGroupKeys.includes(buildGroupKey(groupedTopicRule, setRow._id)))
    );
}

async function getOrderedGroupedSetQuestions(questionFilter, groupedTopicRule, setNumber, excludedQuestionIds = []) {
    const setQuestionFilter = withExcludedQuestionIds(
        buildFilter(
            questionFilter,
            buildGroupedTopicFieldFilter(groupedTopicRule),
            { set_number: setNumber }
        ),
        excludedQuestionIds
    );

    return QuestionBank.aggregate([
        { $match: setQuestionFilter },
        ...getQuestionSortPipeline()
    ]);
}

async function selectGroupedSetQuestions(questionFilter, groupedTopicRule, limit, excludedQuestionIds = [], excludedGroupKeys = []) {
    if (limit < 1) return [];

    const selectedQuestions = [];
    const selectedQuestionIds = [...excludedQuestionIds];
    const selectedGroupKeys = [...excludedGroupKeys];
    const groupedSetRows = await getRandomGroupedSetRows(questionFilter, groupedTopicRule, selectedQuestionIds, selectedGroupKeys);

    for (const setRow of groupedSetRows) {
        if (selectedQuestions.length >= limit) break;

        selectedGroupKeys.push(buildGroupKey(groupedTopicRule, setRow._id));
        const setQuestions = await getOrderedGroupedSetQuestions(questionFilter, groupedTopicRule, setRow._id, selectedQuestionIds);
        for (const question of setQuestions) {
            if (selectedQuestions.length >= limit) break;

            selectedQuestions.push(question);
            selectedQuestionIds.push(question._id);
        }
    }

    return selectedQuestions;
}

async function selectRandomQuestions(questionFilter, limit, excludedQuestionIds = []) {
    if (limit < 1) return [];

    return QuestionBank.aggregate([
        { $match: withExcludedQuestionIds(questionFilter, excludedQuestionIds) },
        { $sample: { size: limit } }
    ]);
}

async function selectSubjectQuizQuestions(subject, questionFilter, limit, excludedQuestionIds = [], excludedGroupKeys = []) {
    if (limit < 1) return [];

    const selectedQuestions = [];
    const selectedQuestionIds = [...excludedQuestionIds];
    const selectedGroupKeys = [...excludedGroupKeys];
    const groupedTopicRules = getGroupedTopicRulesForSubject(subject);

    if (!groupedTopicRules.length) {
        return selectRandomQuestions(questionFilter, limit, selectedQuestionIds);
    }

    const nonGroupedQuestions = await selectRandomQuestions(
        buildFilter(questionFilter, buildNotGroupedTopicFieldFilter(subject)),
        limit,
        selectedQuestionIds
    );
    const groupedSetUnits = [];

    for (const groupedTopicRule of groupedTopicRules) {
        const groupedSetRows = await getRandomGroupedSetRows(questionFilter, groupedTopicRule, selectedQuestionIds, selectedGroupKeys);
        groupedSetUnits.push(...groupedSetRows.map((setRow) => ({
            type: 'groupedSet',
            groupedTopicRule,
            setNumber: setRow._id,
            groupKey: buildGroupKey(groupedTopicRule, setRow._id)
        })));
    }

    const candidateUnits = shuffleQuestions([
        ...nonGroupedQuestions.map((question) => ({ type: 'question', question })),
        ...groupedSetUnits
    ]);

    for (const unit of candidateUnits) {
        if (selectedQuestions.length >= limit) break;

        if (unit.type === 'question') {
            selectedQuestions.push(unit.question);
            selectedQuestionIds.push(unit.question._id);
            continue;
        }

        selectedGroupKeys.push(unit.groupKey);
        const setQuestions = await getOrderedGroupedSetQuestions(questionFilter, unit.groupedTopicRule, unit.setNumber, selectedQuestionIds);
        for (const question of setQuestions) {
            if (selectedQuestions.length >= limit) break;

            selectedQuestions.push(question);
            selectedQuestionIds.push(question._id);
        }
    }

    if (selectedQuestions.length < limit) {
        const fallbackQuestions = await selectRandomQuestions(
            buildFilter(questionFilter, buildNotGroupedTopicFieldFilter(subject)),
            limit - selectedQuestions.length,
            selectedQuestionIds
        );
        selectedQuestions.push(...fallbackQuestions);
        selectedQuestionIds.push(...fallbackQuestions.map((question) => question._id));
    }

    for (const groupedTopicRule of groupedTopicRules) {
        if (selectedQuestions.length >= limit) break;

        const fallbackGroupedQuestions = await selectGroupedSetQuestions(
            questionFilter,
            groupedTopicRule,
            limit - selectedQuestions.length,
            selectedQuestionIds,
            selectedGroupKeys
        );
        selectedQuestions.push(...fallbackGroupedQuestions);
        selectedQuestionIds.push(...fallbackGroupedQuestions.map((question) => question._id));
        selectedGroupKeys.push(...getQuestionGroupKeys(fallbackGroupedQuestions));
    }

    return selectedQuestions.slice(0, limit);
}

async function selectQuizFillerQuestions(difficultyRegex, limit, excludedQuestionIds = [], excludedGroupKeys = []) {
    if (limit < 1) return [];

    const subjectSelections = [];
    const selectedQuestionIds = [...excludedQuestionIds];
    const selectedGroupKeys = [...excludedGroupKeys];

    for (const subject of SUBJECTS) {
        const subjectFilter = {
            ...buildPracticeQuestionSourceFilter(),
            difficulty: difficultyRegex,
            subject: buildSubjectRegex(subject)
        };
        const subjectQuestions = await selectSubjectQuizQuestions(subject, subjectFilter, limit, selectedQuestionIds, selectedGroupKeys);

        subjectSelections.push(...subjectQuestions);
        selectedQuestionIds.push(...subjectQuestions.map((question) => question._id));
        selectedGroupKeys.push(...getQuestionGroupKeys(subjectQuestions));
    }

    return shuffleQuestionGroups(subjectSelections).slice(0, limit);
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
        set_number: plainQuestion.set_number,
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
        competitionCategory: normalizeCompetitionCategory(plainExam.competitionCategory),
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
        competitionCategory: normalizeCompetitionCategory(plainExam.competitionCategory),
        negativeMarksPerQuestion: getEffectiveNegativeMarksPerQuestion(plainExam.negativeMarksPerQuestion),
        questions: includeAnswers ? normalizedQuestions : normalizedQuestions.map(redactQuestionAnswers)
    };
}

function getIdString(value) {
    return value?._id?.toString?.() || value?.toString?.() || '';
}

function redactExamForStudent(exam) {
    return {
        ...exam,
        questions: (exam.questions || []).map(redactQuestionAnswers)
    };
}

function getLiveExamCacheExpiry(exam) {
    const endTime = exam?.endTime ? new Date(exam.endTime).getTime() : 0;
    const ttlExpiry = Date.now() + LIVE_EXAM_CACHE_TTL_MS;
    if (!endTime || Number.isNaN(endTime)) return ttlExpiry;

    return Math.min(ttlExpiry, endTime + LIVE_EXAM_CACHE_GRACE_MS);
}

function invalidateLiveExamCache(examId) {
    const key = getIdString(examId);
    if (key) liveExamCache.delete(key);
}

function getCachedLiveExam(examId) {
    const key = getIdString(examId);
    const cached = liveExamCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
        return cached.exam;
    }

    if (cached) liveExamCache.delete(key);
    return null;
}

async function getLiveExamWithQuestions(examId) {
    const cachedExam = getCachedLiveExam(examId);
    if (cachedExam) return cachedExam;

    const key = getIdString(examId);
    const exam = await Exam.findById(examId).populate({
        path: 'questions',
        select: buildQuestionSelect(true)
    });

    if (!exam) return null;

    const normalizedExam = await normalizePopulatedExam(exam);
    if (normalizedExam?.isLiveExam) {
        liveExamCache.set(key, {
            exam: normalizedExam,
            expiresAt: getLiveExamCacheExpiry(normalizedExam)
        });
    }

    return normalizedExam;
}

function gradeAnswers(normalizedExam, answers) {
    const questions = normalizedExam.questions || [];
    const totalQuestions = questions.length;
    const penalty = getEffectiveNegativeMarksPerQuestion(normalizedExam.negativeMarksPerQuestion);
    const review = [];
    let dynamicScore = 0;

    if (totalQuestions === 0) {
        return {
            score: 0,
            totalMarks: normalizedExam.totalMarks || 0,
            negativeMarksPerQuestion: penalty,
            review
        };
    }

    const marksPerQuestion = normalizedExam.totalMarks / totalQuestions;

    questions.forEach((question, index) => {
        const studentAnswer = answers[index];

        if (studentAnswer === undefined || studentAnswer === null || studentAnswer === -1) {
            review.push(buildQuestionReview(question, studentAnswer));
            return;
        }

        if (studentAnswer === question.correctOptionIndex) {
            dynamicScore += marksPerQuestion;
        } else {
            dynamicScore -= penalty;
        }

        review.push(buildQuestionReview(question, studentAnswer));
    });

    return {
        score: parseFloat(dynamicScore.toFixed(2)),
        totalMarks: normalizedExam.totalMarks,
        negativeMarksPerQuestion: penalty,
        review
    };
}

function buildSubmissionResponse(submission, normalizedExam, options = {}) {
    const graded = gradeAnswers(normalizedExam, submission.answers || []);

    return {
        success: true,
        message: options.alreadySubmitted
            ? 'Your answer sheet was already submitted. Showing the saved result.'
            : 'Exam graded successfully!',
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

function normalizeLabeledOption(option, index) {
    const text = clean(option);
    const label = OPTION_LABELS[index];
    const labelPattern = new RegExp(`^${label}\\s*[).:-]\\s*`, 'i');
    return labelPattern.test(text) ? text : `${label}) ${text}`;
}

function parseLiveExamPayload(body = {}, userId) {
    const title = clean(body.title);
    const competitionCategory = normalizeCompetitionCategory(body.competitionCategory);
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
        const difficulty = clean(item.difficulty) || 'Medium';
        const questionText = clean(item.question || item.questionText);
        const explanation = clean(item.explanation);
        const rawOptions = Array.isArray(item.options) ? item.options.map(clean) : [];
        const options = rawOptions.map(normalizeLabeledOption);
        const correctAnswer = clean(item.correct_answer || item.correctAnswer);

        if (!subject) errors.push(`Question ${questionIndex + 1}: subject is required.`);
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
            competitionCategory,
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

function serializeExamSummary(exam, submissionByExamId = new Map(), existingQuestionIdSet = null) {
    const plainExam = exam.toObject ? exam.toObject() : exam;
    const examId = plainExam._id?.toString();
    const submission = examId ? submissionByExamId.get(examId) : null;
    const questionIds = (plainExam.questions || []).map(getIdString).filter(Boolean);
    const questionCount = existingQuestionIdSet
        ? questionIds.filter((questionId) => existingQuestionIdSet.has(questionId)).length
        : questionIds.length;

    return {
        ...plainExam,
        competitionCategory: normalizeCompetitionCategory(plainExam.competitionCategory),
        status: getLiveExamStatus(plainExam),
        questionCount,
        missingQuestionCount: Math.max(0, questionIds.length - questionCount),
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
                $match: buildPracticeQuestionSourceFilter()
            },
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

// @desc    Create a custom untimed practice exam from subject/topics/count
// @route   POST /api/exams/practice/start
// @access  Private
exports.startPracticeExam = async (req, res) => {
    try {
        const subject = normalizeSubject(req.body.subject);
        const topics = normalizePracticeTopics(req.body);
        const questionCount = Number(req.body.questionCount);

        if (!SUBJECTS.includes(subject)) {
            return res.status(400).json({ success: false, message: 'Please choose Math, English, or Analytical.' });
        }

        if (!topics.length) {
            return res.status(400).json({ success: false, message: 'Please choose at least one topic before starting the exam.' });
        }

        if (!Number.isInteger(questionCount) || questionCount < 1) {
            return res.status(400).json({ success: false, message: 'Please choose a valid number of questions.' });
        }

        const subjectRegex = buildSubjectRegex(subject);
        const topicRows = await Promise.all(topics.map(async (topic) => {
            const questionFilter = buildTopicQuestionFilter(subjectRegex, topic);
            const availableQuestionCount = await QuestionBank.countDocuments(questionFilter);

            return {
                topic,
                questionFilter,
                availableQuestionCount
            };
        }));
        const availableTopicRows = topicRows.filter((topicRow) => topicRow.availableQuestionCount > 0);
        const totalAvailableQuestionCount = availableTopicRows.reduce((sum, topicRow) => sum + topicRow.availableQuestionCount, 0);

        if (totalAvailableQuestionCount === 0) {
            return res.status(404).json({ success: false, message: 'No questions were found for the selected topics.' });
        }

        if (questionCount > totalAvailableQuestionCount) {
            return res.status(400).json({
                success: false,
                message: `Only ${totalAvailableQuestionCount} question${totalAvailableQuestionCount === 1 ? '' : 's'} are available for the selected topics.`
            });
        }

        const topicTargets = calculatePracticeTopicTargets(availableTopicRows, questionCount);
        const selectedQuestions = [];
        const selectedQuestionIds = [];
        const selectedGroupKeys = [];

        for (const topicTarget of topicTargets) {
            if (topicTarget.targetCount < 1) continue;

            const groupedTopicRule = getGroupedTopicRuleForRequest(subject, topicTarget.topic);
            const topicQuestions = groupedTopicRule
                ? await selectGroupedSetQuestions(topicTarget.questionFilter, groupedTopicRule, topicTarget.targetCount, selectedQuestionIds, selectedGroupKeys)
                : await selectRandomQuestions(topicTarget.questionFilter, topicTarget.targetCount, selectedQuestionIds);

            selectedQuestions.push(...topicQuestions);
            selectedQuestionIds.push(...topicQuestions.map((question) => question._id));
            selectedGroupKeys.push(...getQuestionGroupKeys(topicQuestions));
        }

        if (selectedQuestions.length < questionCount) {
            const remainingQuestionCount = questionCount - selectedQuestions.length;
            const fillerTargets = calculatePracticeTopicTargets(
                topicTargets
                    .filter((topicTarget) => topicTarget.availableQuestionCount > topicTarget.targetCount)
                    .map((topicTarget) => ({
                        ...topicTarget,
                        availableQuestionCount: topicTarget.availableQuestionCount - topicTarget.targetCount
                    })),
                remainingQuestionCount
            );

            for (const fillerTarget of fillerTargets) {
                if (selectedQuestions.length >= questionCount || fillerTarget.targetCount < 1) continue;

                const groupedTopicRule = getGroupedTopicRuleForRequest(subject, fillerTarget.topic);
                const fillerQuestions = groupedTopicRule
                    ? await selectGroupedSetQuestions(fillerTarget.questionFilter, groupedTopicRule, fillerTarget.targetCount, selectedQuestionIds, selectedGroupKeys)
                    : await selectRandomQuestions(fillerTarget.questionFilter, fillerTarget.targetCount, selectedQuestionIds);

                selectedQuestions.push(...fillerQuestions);
                selectedQuestionIds.push(...fillerQuestions.map((question) => question._id));
                selectedGroupKeys.push(...getQuestionGroupKeys(fillerQuestions));
            }
        }

        if (selectedQuestions.length < questionCount) {
            return res.status(400).json({
                success: false,
                message: 'Not enough questions are available to build this practice exam right now.'
            });
        }

        const questions = shuffleQuestionGroups(selectedQuestions).slice(0, questionCount);
        const topicTitle = topics.length === 1 ? topics[0] : `${topics.length} Topics`;
        const exam = await Exam.create({
            title: `${subject} - ${topicTitle} Practice (${questions.length} Questions)`,
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
            ...buildPracticeQuestionSourceFilter(),
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
        const selectedGroupKeys = [];

        for (const target of subjectTargets) {
            if (target.count < 1) continue;

            const subjectFilter = {
                ...buildPracticeQuestionSourceFilter(),
                difficulty: difficultyRegex,
                subject: buildSubjectRegex(target.subject)
            };
            const subjectQuestions = getGroupedTopicRulesForSubject(target.subject).length
                ? await selectSubjectQuizQuestions(target.subject, subjectFilter, target.count, selectedQuestionIds, selectedGroupKeys)
                : await selectRandomQuestions(subjectFilter, target.count, selectedQuestionIds);

            selectedQuestions.push(...subjectQuestions);
            selectedQuestionIds.push(...subjectQuestions.map((question) => question._id));
            selectedGroupKeys.push(...getQuestionGroupKeys(subjectQuestions));
        }

        const remainingQuestionCount = questionCount - selectedQuestions.length;
        if (remainingQuestionCount > 0) {
            const fillerQuestions = await selectQuizFillerQuestions(difficultyRegex, remainingQuestionCount, selectedQuestionIds, selectedGroupKeys);

            selectedQuestions.push(...fillerQuestions);
            selectedQuestionIds.push(...fillerQuestions.map((question) => question._id));
            selectedGroupKeys.push(...getQuestionGroupKeys(fillerQuestions));
        }

        if (selectedQuestions.length < questionCount) {
            return res.status(400).json({
                success: false,
                message: `Not enough ${difficulty} questions are available to build this quiz right now.`
            });
        }

        const shuffledQuestions = shuffleQuestionGroups(selectedQuestions).slice(0, questionCount);
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
            .select('title duration totalMarks negativeMarksPerQuestion examType competitionCategory allowRetakes isLiveExam startTime endTime questions createdAt createdBy')
            .lean();

        const examIds = exams.map((exam) => exam._id);
        const submissions = await Submission.find({
            student: req.user.id,
            exam: { $in: examIds }
        })
            .select('exam score submittedAt')
            .lean();
        const submissionByExamId = new Map(submissions.map((submission) => [submission.exam.toString(), submission]));
        const questionIds = [...new Set(exams.flatMap((exam) => (
            (exam.questions || []).map(getIdString).filter(Boolean)
        )))];
        const existingQuestions = questionIds.length
            ? await QuestionBank.find({ _id: { $in: questionIds } }).select('_id').lean()
            : [];
        const existingQuestionIdSet = new Set(existingQuestions.map((question) => question._id.toString()));
        const data = exams.map((exam) => serializeExamSummary(exam, submissionByExamId, existingQuestionIdSet));

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
            competitionCategory: payload.competitionCategory,
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

        invalidateLiveExamCache(exam._id);
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
                competitionCategory: payload.competitionCategory,
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

        invalidateLiveExamCache(updatedExam._id);
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

        const cachedLiveExam = getCachedLiveExam(req.params.id);
        const examMeta = cachedLiveExam || await Exam.findById(req.params.id)
            .select('isLiveExam startTime endTime')
            .lean();

        if (!examMeta) {
            return res.status(404).json({ success: false, message: 'Exam configuration not found' });
        }

        if (examMeta.isLiveExam) {
            const liveExam = cachedLiveExam || await getLiveExamWithQuestions(req.params.id);
            const currentTime = new Date();
            const startTime = new Date(liveExam.startTime);
            const endTime = new Date(liveExam.endTime);

            if (currentTime < startTime) {
                return res.status(403).json({
                    success: false,
                    message: `This live exam hasn't started yet. It will unlock at ${startTime.toLocaleString()}`
                });
            }

            const includeAnswers = currentTime > endTime;
            return res.status(200).json({
                success: true,
                data: includeAnswers ? liveExam : redactExamForStudent(liveExam)
            });
        }

        // Populate the exam with actual question text and option arrays
        const exam = await Exam.findById(req.params.id).populate({
            path: 'questions',
            select: buildQuestionSelect(true)
        });

        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam configuration not found' });
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
        const submissionReason = normalizeSubmissionReason(req.body.submissionReason);
        if (!Array.isArray(answers)) {
            return res.status(400).json({ success: false, message: 'Please submit answers as an array of selected option indexes.' });
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        const examMeta = await Exam.findById(req.params.id)
            .select('allowRetakes isLiveExam startTime endTime')
            .lean();

        if (!examMeta) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        const normalizedExam = examMeta.isLiveExam
            ? await getLiveExamWithQuestions(req.params.id)
            : await normalizePopulatedExam(await Exam.findById(req.params.id).populate({
                path: 'questions',
                select: buildQuestionSelect(true)
            }));

        if (!normalizedExam) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        if (!normalizedExam.allowRetakes) {
            const existingSubmission = await Submission.findOne({
                student: studentId,
                exam: normalizedExam._id
            });

            if (existingSubmission) {
                return res.status(200).json(buildSubmissionResponse(existingSubmission, normalizedExam, { alreadySubmitted: true }));
            }
        }

        if (normalizedExam.isLiveExam) {
            const currentTime = new Date();
            const startTime = new Date(normalizedExam.startTime);
            const endTime = new Date(normalizedExam.endTime);

            if (currentTime < startTime) {
                return res.status(403).json({
                    success: false,
                    message: 'This live exam has not started yet.'
                });
            }

            if (currentTime > endTime) {
                return res.status(403).json({
                    success: false,
                    message: 'The submission portal has closed! You missed the official live exam deadline.'
                });
            }
        }

        const questions = normalizedExam.questions || [];
        const totalQuestions = questions.length;
        if (totalQuestions === 0) {
            return res.status(400).json({ success: false, message: 'This exam has no available questions to grade.' });
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

            const existingSubmission = await Submission.findOne({
                student: studentId,
                exam: normalizedExam._id
            });

            if (!existingSubmission) throw error;
            return res.status(200).json(buildSubmissionResponse(existingSubmission, normalizedExam, { alreadySubmitted: true }));
        }

    } catch (error) {
        logExamError('submitExam', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
