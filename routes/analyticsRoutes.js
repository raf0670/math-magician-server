const express = require('express');
const router = express.Router();
const { getGlobalLeaderboard, getStudentStats } = require('../controllers/analyticsController');
const { protect } = require('../middleware/auth');

// Both analytics dashboard pathways are private; you must be a logged-in user to view stats
router.get('/leaderboard', protect, getGlobalLeaderboard);
router.get('/my-stats', protect, getStudentStats);

module.exports = router;