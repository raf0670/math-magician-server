const Submission = require('../models/Submission');
const Exam = require('../models/Exam');
const User = require('../models/User');
const { normalizeCompetitionCategory } = require('../config/competition');

const RANK_TIERS = ['Silver', 'Gold', 'Platinum', 'Master', 'Challenger', 'Legendary'];
const RANK_LEVELS = ['III', 'II', 'I'];
const POINTS_PER_LEVEL = 20;
const CATEGORY_MAX_POINTS = {
    daily: 10,
    weekly: 20
};
const ASSIGNMENT_COMPLETE_POINTS = 2;
const ASSIGNMENT_MISSING_POINTS = -2;

const RANK_LADDER = RANK_TIERS.flatMap((tier) => (
    RANK_LEVELS.map((level) => ({ tier, level, rankName: `${tier} ${level}` }))
));
const MAX_RANK_INDEX = RANK_LADDER.length - 1;

function roundPoints(value) {
    return Number((Number(value) || 0).toFixed(2));
}

function clampRankIndex(value) {
    return Math.max(0, Math.min(value, MAX_RANK_INDEX));
}

function getDefaultRankInfo() {
    return buildRankInfoFromPoints(0, 0);
}

function buildRankInfoFromPoints(points, countedExamCount = 0) {
    const rankPoints = roundPoints(points);
    const rawRankIndex = Math.floor(rankPoints / POINTS_PER_LEVEL);
    const rankIndex = clampRankIndex(rawRankIndex);
    const rank = RANK_LADDER[rankIndex];
    const isMaxRank = rankIndex === MAX_RANK_INDEX;
    const nextRank = isMaxRank ? null : RANK_LADDER[rankIndex + 1];
    const rawPointsIntoLevel = rankPoints - rankIndex * POINTS_PER_LEVEL;
    const pointsIntoLevel = isMaxRank
        ? POINTS_PER_LEVEL
        : roundPoints(Math.max(0, Math.min(rawPointsIntoLevel, POINTS_PER_LEVEL)));

    return {
        rankName: rank.rankName,
        tier: rank.tier,
        level: rank.level,
        rankIndex,
        rankPoints,
        countedExamCount,
        pointsIntoLevel,
        pointsToNextLevel: isMaxRank ? 0 : roundPoints(POINTS_PER_LEVEL - pointsIntoLevel),
        nextRankName: nextRank?.rankName || null
    };
}

function getStudentId(value) {
    return value?._id?.toString?.() || value?.toString?.() || '';
}

function getEffectiveScore(submission) {
    return submission?.isDisqualified ? 0 : Number(submission?.score || 0);
}

function shouldCountExam(exam, now = new Date()) {
    if (exam.examType === 'assignment') {
        const endTime = exam.endTime ? new Date(exam.endTime) : null;
        if (!endTime || Number.isNaN(endTime.getTime()) || endTime > now) return false;
        return Number(exam.totalMarks) > 0;
    }

    if (exam.examType === 'assessment') {
        const startTime = exam.startTime ? new Date(exam.startTime) : null;
        if (startTime && !Number.isNaN(startTime.getTime()) && startTime > now) return false;
        return Number(exam.totalMarks) > 0;
    }

    if (!exam?.isLiveExam) return false;
    if (exam.examType && exam.examType !== 'official') return false;

    const category = normalizeCompetitionCategory(exam.competitionCategory);
    if (!CATEGORY_MAX_POINTS[category]) return false;

    const endTime = exam.endTime ? new Date(exam.endTime) : null;
    if (!endTime || Number.isNaN(endTime.getTime()) || endTime > now) return false;

    return Number(exam.totalMarks) > 0;
}

function isCompleteAssignmentSubmission(submission) {
    const totalMarks = Number(submission?.exam?.totalMarks || 0);
    const answers = Array.isArray(submission?.answers) ? submission.answers : [];
    if (!totalMarks || answers.length < totalMarks) return false;

    return answers.slice(0, totalMarks).every((answer) => (
        answer !== undefined
        && answer !== null
        && answer !== -1
        && Number.isInteger(answer)
    ));
}

function getRankPointsForSubmission(submission, now = new Date()) {
    const exam = submission?.exam;
    if (!shouldCountExam(exam, now)) return null;

    if (exam.examType === 'assignment') {
        if (submission?.isDisqualified) return 0;
        return isCompleteAssignmentSubmission(submission) ? ASSIGNMENT_COMPLETE_POINTS : 0;
    }

    if (exam.examType === 'assessment') {
        const assessmentPoints = getEffectiveScore(submission);
        return Number.isFinite(assessmentPoints) ? assessmentPoints : null;
    }

    const category = normalizeCompetitionCategory(exam.competitionCategory);
    const maxPoints = CATEGORY_MAX_POINTS[category];
    const totalMarks = Number(exam.totalMarks);
    const scaledPoints = (getEffectiveScore(submission) / totalMarks) * maxPoints;

    return Number.isFinite(scaledPoints) ? scaledPoints : null;
}

function getMissingAssignmentRankPoints() {
    return ASSIGNMENT_MISSING_POINTS;
}

function buildRankTotalsFromSubmissions(submissions = [], studentIds = [], options = {}) {
    const now = options.now || new Date();
    const totalsByStudentId = new Map();

    for (const studentId of studentIds.map((value) => value?.toString()).filter(Boolean)) {
        totalsByStudentId.set(studentId, { points: 0, countedExamCount: 0 });
    }

    for (const submission of submissions) {
        const studentId = getStudentId(submission.student);
        if (!studentId) continue;

        const rankPoints = getRankPointsForSubmission(submission, now);
        if (rankPoints === null) continue;

        const current = totalsByStudentId.get(studentId) || { points: 0, countedExamCount: 0 };
        current.points += rankPoints;
        current.countedExamCount += 1;
        totalsByStudentId.set(studentId, current);
    }

    return totalsByStudentId;
}

function buildRankInfoMapFromSubmissions(submissions = [], studentIds = [], options = {}) {
    const totalsByStudentId = buildRankTotalsFromSubmissions(submissions, studentIds, options);

    return new Map([...totalsByStudentId.entries()].map(([studentId, total]) => [
        studentId,
        buildRankInfoFromPoints(total.points, total.countedExamCount)
    ]));
}

async function applyMissingAssignmentPenalties(totalsByStudentId, submissions = [], studentIds = [], options = {}) {
    const now = options.now || new Date();
    const normalizedStudentIds = [...new Set(studentIds.map((value) => value?.toString()).filter(Boolean))];
    if (!normalizedStudentIds.length) return totalsByStudentId;

    const [eligibleUsers, assignments] = await Promise.all([
        User.find({
            _id: { $in: normalizedStudentIds },
            role: 'student',
            hasClassAccess: true
        }).select('_id').lean(),
        Exam.find({
            examType: 'assignment',
            isLiveExam: true,
            endTime: { $lte: now },
            totalMarks: { $gt: 0 }
        }).select('_id').lean()
    ]);

    const eligibleStudentIds = eligibleUsers.map((user) => user._id.toString());
    const assignmentIds = assignments.map((assignment) => assignment._id.toString());
    if (!eligibleStudentIds.length || !assignmentIds.length) return totalsByStudentId;

    const submittedKeys = new Set(
        submissions
            .filter((submission) => submission?.exam?.examType === 'assignment')
            .map((submission) => {
                const studentId = getStudentId(submission.student);
                const examId = submission.exam?._id?.toString?.() || submission.exam?.toString?.();
                return studentId && examId ? `${studentId}:${examId}` : '';
            })
            .filter(Boolean)
    );

    for (const studentId of eligibleStudentIds) {
        const total = totalsByStudentId.get(studentId) || { points: 0, countedExamCount: 0 };

        for (const assignmentId of assignmentIds) {
            if (submittedKeys.has(`${studentId}:${assignmentId}`)) continue;
            total.points += ASSIGNMENT_MISSING_POINTS;
            total.countedExamCount += 1;
        }

        totalsByStudentId.set(studentId, total);
    }

    return totalsByStudentId;
}

async function getRankInfoByStudentIds(studentIds = [], options = {}) {
    const normalizedStudentIds = [...new Set(studentIds.map((value) => value?.toString()).filter(Boolean))];
    if (!normalizedStudentIds.length) return new Map();

    const submissions = await Submission.find({ student: { $in: normalizedStudentIds } })
        .populate('exam', 'totalMarks competitionCategory isLiveExam examType startTime endTime')
        .lean();

    const totalsByStudentId = buildRankTotalsFromSubmissions(submissions, normalizedStudentIds, options);
    await applyMissingAssignmentPenalties(totalsByStudentId, submissions, normalizedStudentIds, options);

    return new Map([...totalsByStudentId.entries()].map(([studentId, total]) => [
        studentId,
        buildRankInfoFromPoints(total.points, total.countedExamCount)
    ]));
}

async function getRankInfoByStudentId(studentId, options = {}) {
    const rankInfoMap = await getRankInfoByStudentIds([studentId], options);
    return rankInfoMap.get(studentId?.toString()) || getDefaultRankInfo();
}

module.exports = {
    POINTS_PER_LEVEL,
    RANK_LADDER,
    buildRankInfoFromPoints,
    buildRankInfoMapFromSubmissions,
    getDefaultRankInfo,
    getRankInfoByStudentId,
    getRankInfoByStudentIds,
    getMissingAssignmentRankPoints,
    getRankPointsForSubmission,
    isCompleteAssignmentSubmission,
    shouldCountExam
};
