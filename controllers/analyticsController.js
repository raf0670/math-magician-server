const Submission = require('../models/Submission');
const mongoose = require('mongoose');

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
                    examsTaken: { $sum: 1 }
                }
            },
            {
                // Sort from highest total points accumulated to lowest
                $sort: { totalScore: -1 }
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
                    examsTaken: 1
                }
            }
        ]);

        res.status(200).json({ success: true, count: leaderboard.length, data: leaderboard });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get individual student stats dashboard (Personal Performance Tracking)
// @route   GET /api/analytics/my-stats
// @access  Private
exports.getStudentStats = async (req, res) => {
    try {
        // Fetch all submissions tied directly to the logged-in student's token ID
        const history = await Submission.find({ student: req.user.id })
            .populate('exam', 'title totalMarks')
            .sort({ submittedAt: -1 }); // Show newest submissions first

        if (history.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No exam history found yet. Take your first test to initialize analytics!",
                stats: { totalExams: 0, averageScore: 0, totalPointsEarned: 0 },
                history: []
            });
        }

        // Run dynamic client performance reductions 
        const totalExams = history.length;
        const totalPointsEarned = history.reduce((sum, item) => sum + item.score, 0);
        const averageScore = parseFloat((totalPointsEarned / totalExams).toFixed(2));

        res.status(200).json({
            success: true,
            stats: {
                totalExams,
                totalPointsEarned,
                averageScore
            },
            history
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};