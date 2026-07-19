const Submission = require('../models/Submission');
const Exam = require('../models/Exam');
const QuestionBank = require('../models/QuestionBank');
const mongoose = require('mongoose');

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

// @desc    Get global leaderboard rankings sorted by total marks earned across all exams
// @route   GET /api/analytics/leaderboard
// @access  Private
exports.getGlobalLeaderboard = async (req, res) => {
    try {
        // Aggregation pipeline to group, sum, populate, and sort player ranks
        const leaderboard = await Submission.aggregate([
            {
                // Group by student ID, summing up all scores and counting total completed tests
                $group: {
                    _id: '$student',
                    totalScore: { $sum: '$score' },
                    examsTaken: { $sum: 1 },
                    bestScore: { $max: '$score' },
                    lastSubmittedAt: { $max: '$submittedAt' }
                }
            },
            {
                $addFields: {
                    averageScore: { $round: [{ $divide: ['$totalScore', '$examsTaken'] }, 2] }
                }
            },
            {
                // Sort from highest total points accumulated to lowest
                $sort: { totalScore: -1, averageScore: -1, lastSubmittedAt: 1 }
            },
            {
                // Limit response to top 100 students for performance efficiency
                $limit: 100
            },
            {
                // Lookup user details (name, email) from the users collection based on grouped _id
                $lookup: {
                    from: 'users', // Name of the collection in MongoDB (usually lowercase plural)
                    localField: '_id',
                    foreignField: '_id',
                    as: 'studentInfo'
                }
            },
            {
                // Flatten the studentInfo array returned by the $lookup stage
                $unwind: '$studentInfo'
            },
            {
                // Project only the clean public fields we want to expose to the leaderboard client
                $project: {
                    _id: 0,
                    studentId: '$_id',
                    name: '$studentInfo.name',
                    totalScore: 1,
                    examsTaken: 1,
                    averageScore: 1,
                    bestScore: 1,
                    lastSubmittedAt: 1
                }
            }
        ]);

        const rankedLeaderboard = leaderboard.map((entry, index) => ({
            ...entry,
            rank: index + 1
        }));

        res.status(200).json({ success: true, count: rankedLeaderboard.length, data: rankedLeaderboard });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get individual student stats dashboard (Personal Performance Tracking)
// @route   GET /api/analytics/my-stats
// @access  Private
exports.getStudentStats = async (req, res) => {
    try {
        const [questionBankCount, availableExamCount] = await Promise.all([
            QuestionBank.countDocuments(),
            Exam.countDocuments(buildOfficialExamFilter())
        ]);

        // Fetch all submissions tied directly to the logged-in student's token ID
        const history = await Submission.find({ student: req.user.id })
            .populate('exam', 'title totalMarks duration examType')
            .sort({ submittedAt: -1 }); // Show newest submissions first

        if (history.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No exam history found yet. Take your first test to initialize analytics!",
                stats: {
                    totalExams: 0,
                    averageScore: 0,
                    totalPointsEarned: 0,
                    totalPossibleMarks: 0,
                    accuracyPercentage: 0,
                    questionBankCount,
                    availableExamCount
                },
                history: []
            });
        }

        // Run dynamic client performance reductions 
        const totalExams = history.length;
        const totalPointsEarned = history.reduce((sum, item) => sum + item.score, 0);
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
                availableExamCount
            },
            history
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get leaderboard rankings for one specific exam (Only highest score per unique student)
// @route   GET /api/analytics/leaderboard/:examId
// @access  Private
exports.getExamLeaderboard = async (req, res) => {
    try {
        const { examId } = req.params;

        const leaderboard = await Submission.aggregate([
            {
                // 1. Filter submissions to only match this specific Exam ID
                $match: { exam: new mongoose.Types.ObjectId(examId) }
            },
            {
                // 2. Group by student ID and find their single maximum score
                $group: {
                    _id: '$student', // Groups identical student IDs together
                    highestScore: { $max: '$score' }, // Isolates their top attempt score
                    lastSubmittedAt: { $min: '$submittedAt' } // Keeps the earliest timestamp if scores tie
                }
            },
            {
                // 3. Sort from highest maximum score to lowest
                $sort: { highestScore: -1, lastSubmittedAt: 1 }
            },
            {
                // 4. Limit to top 100 entries for performance scaling
                $limit: 100
            },
            {
                // 5. Lookup user data (name) from the users collection
                $lookup: {
                    from: 'users',
                    localField: '_id', // The grouped student ID is now sitting in _id
                    foreignField: '_id',
                    as: 'studentInfo'
                }
            },
            {
                // 6. Flatten the array structure returned by $lookup
                $unwind: '$studentInfo'
            },
            {
                // 7. Select only the necessary clean fields to expose to the frontend client
                $project: {
                    _id: 0,
                    studentId: '$_id',
                    studentName: '$studentInfo.name',
                    score: '$highestScore',
                    submittedAt: '$lastSubmittedAt'
                }
            }
        ]);

        res.status(200).json({
            success: true,
            count: leaderboard.length,
            data: leaderboard
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
