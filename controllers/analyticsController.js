const Submission = require('../models/Submission');
const Exam = require('../models/Exam');
const QuestionBank = require('../models/QuestionBank');
const mongoose = require('mongoose');
const { HOUSES, HOUSE_META, normalizeCompetitionCategory, normalizeHouse } = require('../config/competition');
const { getDefaultRankInfo, getRankInfoByStudentId, getRankInfoByStudentIds, buildRankInfoMapFromSubmissions } = require('../services/rankService');

const LEGACY_GENERATED_EXAM_TITLE = /Random Questions/i;

function buildOfficialExamFilter() {
    return {
        $and: [
            {
                $or: [
                    { examType: 'official' },
                    { examType: { $exists: false } }
                ]
            },
            { title: { $not: LEGACY_GENERATED_EXAM_TITLE } }
        ]
    };
}

function getEffectiveScore(submission) {
    return submission?.isDisqualified ? 0 : Number(submission?.score || 0);
}

function getStudentId(value) {
    return value?._id?.toString?.() || value?.toString?.() || '';
}

function formatStudent(student) {
    if (!student) return null;

    return {
        studentId: getStudentId(student),
        name: student.name || 'Student',
        email: student.email || '',
        house: normalizeHouse(student.house) || ''
    };
}

function sortCompetitionEntries(first, second) {
    if (second.totalScore !== first.totalScore) return second.totalScore - first.totalScore;
    if (second.bestScore !== first.bestScore) return second.bestScore - first.bestScore;
    return new Date(first.lastSubmittedAt || 0) - new Date(second.lastSubmittedAt || 0);
}

async function getCompetitionData() {
    const exams = await Exam.find({ isLiveExam: true })
        .select('title totalMarks duration competitionCategory examType isLiveExam startTime endTime createdAt')
        .sort({ startTime: 1, createdAt: 1 })
        .lean();
    const examIds = exams.map((exam) => exam._id);
    const submissions = examIds.length
        ? await Submission.find({ exam: { $in: examIds } })
            .populate('student', 'name email house')
            .populate('exam', 'title totalMarks competitionCategory examType isLiveExam startTime endTime')
            .sort({ submittedAt: 1 })
            .lean()
        : [];

    const leaderboardByStudentId = new Map();
    const badgeCountByStudentId = new Map();
    const badges = [];
    const houseResultsByHouse = new Map(HOUSES.map((house) => [house, []]));

    for (const submission of submissions) {
        const student = formatStudent(submission.student);
        if (!student?.studentId) continue;

        const effectiveScore = getEffectiveScore(submission);
        const existing = leaderboardByStudentId.get(student.studentId) || {
            ...student,
            totalScore: 0,
            examsTaken: 0,
            bestScore: 0,
            lastSubmittedAt: null,
            disqualifiedCount: 0
        };

        existing.totalScore += effectiveScore;
        existing.examsTaken += 1;
        existing.bestScore = Math.max(existing.bestScore, effectiveScore);
        existing.lastSubmittedAt = !existing.lastSubmittedAt || new Date(submission.submittedAt) > new Date(existing.lastSubmittedAt)
            ? submission.submittedAt
            : existing.lastSubmittedAt;
        existing.disqualifiedCount += submission.isDisqualified ? 1 : 0;
        leaderboardByStudentId.set(student.studentId, existing);
    }

    for (const exam of exams) {
        const examId = exam._id.toString();
        const examSubmissions = submissions.filter((submission) => (
            submission.exam?._id?.toString() === examId || submission.exam?.toString?.() === examId
        ));
        const validSubmissions = examSubmissions.filter((submission) => !submission.isDisqualified);
        const highestScore = validSubmissions.length
            ? Math.max(...validSubmissions.map((submission) => Number(submission.score || 0)))
            : null;
        const winners = highestScore === null
            ? []
            : validSubmissions
                .filter((submission) => Number(submission.score || 0) === highestScore)
                .map((submission) => formatStudent(submission.student))
                .filter(Boolean);

        if (winners.length) {
            badges.push({
                examId,
                examTitle: exam.title,
                competitionCategory: normalizeCompetitionCategory(exam.competitionCategory),
                score: highestScore,
                winners
            });

            for (const winner of winners) {
                badgeCountByStudentId.set(winner.studentId, (badgeCountByStudentId.get(winner.studentId) || 0) + 1);
            }
        }

        for (const house of HOUSES) {
            const houseSubmissions = examSubmissions.filter((submission) => normalizeHouse(submission.student?.house) === house);
            const totalScore = houseSubmissions.reduce((sum, submission) => sum + getEffectiveScore(submission), 0);
            const participantCount = houseSubmissions.length;
            const points = participantCount ? Number((totalScore / participantCount).toFixed(2)) : 0;

            houseResultsByHouse.get(house).push({
                examId,
                examTitle: exam.title,
                competitionCategory: normalizeCompetitionCategory(exam.competitionCategory),
                participantCount,
                totalScore: Number(totalScore.toFixed(2)),
                points
            });
        }
    }

    const rankInfoByStudentId = buildRankInfoMapFromSubmissions(
        submissions,
        [...leaderboardByStudentId.keys()]
    );

    const leaderboard = [...leaderboardByStudentId.values()]
        .map((entry) => ({
            ...entry,
            totalScore: Number(entry.totalScore.toFixed(2)),
            averageScore: entry.examsTaken ? Number((entry.totalScore / entry.examsTaken).toFixed(2)) : 0,
            badgeCount: badgeCountByStudentId.get(entry.studentId) || 0,
            rankInfo: rankInfoByStudentId.get(entry.studentId) || getDefaultRankInfo()
        }))
        .sort(sortCompetitionEntries)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

    const houseStandings = HOUSES.map((house) => {
        const examResults = houseResultsByHouse.get(house) || [];
        const totalPoints = examResults.reduce((sum, item) => sum + item.points, 0);

        return {
            ...HOUSE_META[house],
            totalPoints: Number(totalPoints.toFixed(2)),
            examsCounted: examResults.filter((item) => item.participantCount > 0).length,
            examResults,
            champion: leaderboard.find((entry) => entry.house === house) || null
        };
    }).sort((first, second) => second.totalPoints - first.totalPoints);

    return {
        exams: exams.map((exam) => ({
            ...exam,
            competitionCategory: normalizeCompetitionCategory(exam.competitionCategory)
        })),
        submissions,
        leaderboard,
        houseStandings,
        badges,
        champions: {
            houses: HOUSES.map((house) => ({
                house,
                champion: leaderboard.find((entry) => entry.house === house) || null
            })),
            championOfChampions: leaderboard[0] || null
        }
    };
}

exports.getGlobalLeaderboard = async (req, res) => {
    try {
        const { leaderboard } = await getCompetitionData();
        const currentUserId = req.user._id?.toString() || req.user.id?.toString();
        const currentUserEntry = leaderboard.find((entry) => entry.studentId === currentUserId) || null;

        res.status(200).json({
            success: true,
            count: leaderboard.length,
            totalCount: leaderboard.length,
            data: leaderboard,
            currentUserEntry
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getCompetitionSummary = async (req, res) => {
    try {
        const data = await getCompetitionData();
        const currentUserId = req.user._id?.toString() || req.user.id?.toString();
        const currentUserEntry = data.leaderboard.find((entry) => entry.studentId === currentUserId) || null;

        res.status(200).json({
            success: true,
            data: {
                houses: data.houseStandings,
                leaderboard: data.leaderboard,
                badges: data.badges,
                champions: data.champions,
                currentUserEntry,
                examCount: data.exams.length
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getStudentStats = async (req, res) => {
    try {
        const [questionBankCount, availableExamCount, rankInfo] = await Promise.all([
            QuestionBank.countDocuments(),
            Exam.countDocuments(buildOfficialExamFilter()),
            getRankInfoByStudentId(req.user.id)
        ]);

        const history = await Submission.find({ student: req.user.id })
            .populate('exam', 'title totalMarks duration examType competitionCategory isLiveExam')
            .sort({ submittedAt: -1 });

        if (history.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No exam history found yet. Take your first test to initialize analytics!',
                stats: {
                    totalExams: 0,
                    averageScore: 0,
                    totalPointsEarned: 0,
                    totalPossibleMarks: 0,
                    accuracyPercentage: 0,
                    questionBankCount,
                    availableExamCount,
                    rankInfo
                },
                rankInfo,
                history: []
            });
        }

        const totalExams = history.length;
        const totalPointsEarned = history.reduce((sum, item) => sum + getEffectiveScore(item), 0);
        const totalPossibleMarks = history.reduce((sum, item) => sum + (item.exam?.totalMarks || 0), 0);
        const averageScore = parseFloat((totalPointsEarned / totalExams).toFixed(2));
        const accuracyPercentage = totalPossibleMarks
            ? parseFloat(((totalPointsEarned / totalPossibleMarks) * 100).toFixed(1))
            : 0;

        res.status(200).json({
            success: true,
            stats: {
                totalExams,
                totalPointsEarned,
                averageScore,
                totalPossibleMarks,
                accuracyPercentage,
                questionBankCount,
                availableExamCount,
                rankInfo
            },
            rankInfo,
            history
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getExamLeaderboard = async (req, res) => {
    try {
        const { examId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return res.status(404).json({ success: false, message: 'Exam was not found.' });
        }

        const submissions = await Submission.find({ exam: examId })
            .populate('student', 'name house')
            .sort({ score: -1, submittedAt: 1 })
            .lean();
        const leaderboard = submissions.map((submission, index) => ({
            rank: index + 1,
            studentId: getStudentId(submission.student),
            studentName: submission.student?.name || 'Student',
            house: normalizeHouse(submission.student?.house) || '',
            score: getEffectiveScore(submission),
            originalScore: submission.score,
            isDisqualified: Boolean(submission.isDisqualified),
            submittedAt: submission.submittedAt
        }));

        res.status(200).json({
            success: true,
            count: leaderboard.length,
            data: leaderboard
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAdminExamSubmissions = async (req, res) => {
    try {
        const { examId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return res.status(404).json({ success: false, message: 'Live exam was not found.' });
        }

        const exam = await Exam.findOne({ _id: examId, isLiveExam: true })
            .select('title competitionCategory startTime endTime')
            .lean();
        if (!exam) {
            return res.status(404).json({ success: false, message: 'Live exam was not found.' });
        }

        const submissions = await Submission.find({ exam: examId })
            .populate('student', 'name email house')
            .populate('disqualifiedBy', 'name email')
            .populate('reinstatedBy', 'name email')
            .sort({ score: -1, submittedAt: 1 })
            .lean();
        const rankInfoByStudentId = await getRankInfoByStudentIds(
            submissions.map((submission) => getStudentId(submission.student))
        );

        res.status(200).json({
            success: true,
            data: {
                exam: {
                    ...exam,
                    competitionCategory: normalizeCompetitionCategory(exam.competitionCategory)
                },
                submissions: submissions.map((submission) => ({
                    ...submission,
                    student: formatStudent(submission.student),
                    effectiveScore: getEffectiveScore(submission),
                    rankInfo: rankInfoByStudentId.get(getStudentId(submission.student)) || getDefaultRankInfo()
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateSubmissionModeration = async (req, res) => {
    try {
        const { submissionId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(404).json({ success: false, message: 'Submission was not found.' });
        }

        const shouldDisqualify = Boolean(req.body.isDisqualified);
        const reason = req.body.reason?.toString().trim() || '';
        if (shouldDisqualify && !reason) {
            return res.status(400).json({ success: false, message: 'A disqualification reason is required.' });
        }

        const submission = await Submission.findById(submissionId);
        if (!submission) {
            return res.status(404).json({ success: false, message: 'Submission was not found.' });
        }

        if (shouldDisqualify) {
            submission.isDisqualified = true;
            submission.originalScore = typeof submission.originalScore === 'number' ? submission.originalScore : submission.score;
            submission.disqualificationReason = reason;
            submission.disqualifiedBy = req.user._id;
            submission.disqualifiedAt = new Date();
            submission.reinstatedBy = undefined;
            submission.reinstatedAt = undefined;
        } else {
            submission.isDisqualified = false;
            submission.disqualificationReason = '';
            submission.reinstatedBy = req.user._id;
            submission.reinstatedAt = new Date();
        }

        await submission.save();
        const updatedSubmission = await Submission.findById(submission._id)
            .populate('student', 'name email house')
            .populate('disqualifiedBy', 'name email')
            .populate('reinstatedBy', 'name email')
            .lean();
        const rankInfo = await getRankInfoByStudentId(getStudentId(updatedSubmission.student));

        res.status(200).json({
            success: true,
            data: {
                ...updatedSubmission,
                student: formatStudent(updatedSubmission.student),
                effectiveScore: getEffectiveScore(updatedSubmission),
                rankInfo
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
