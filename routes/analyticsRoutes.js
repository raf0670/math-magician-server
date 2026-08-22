const express = require('express');
const router = express.Router();
const {
    getAdminExamSubmissions,
    getCompetitionSummary,
    getGlobalLeaderboard,
    getStudentStats,
    getExamLeaderboard,
    updateSubmissionModeration
} = require('../controllers/analyticsController');
const { protect, authorizeAdmin } = require('../middleware/auth');

// Both analytics dashboard pathways are private; you must be a logged-in user to view stats
router.get('/leaderboard', protect, getGlobalLeaderboard);
router.get('/competition', protect, getCompetitionSummary);
router.get('/my-stats', protect, getStudentStats);
router.get('/admin/live-exams/:examId/submissions', protect, authorizeAdmin, getAdminExamSubmissions);
router.get('/admin/assignments/:examId/submissions', protect, authorizeAdmin, getAdminExamSubmissions);
router.patch('/admin/submissions/:submissionId/moderation', protect, authorizeAdmin, updateSubmissionModeration);
router.get('/leaderboard/:examId', protect, getExamLeaderboard);

module.exports = router;
