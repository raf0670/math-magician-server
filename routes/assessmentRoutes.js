const express = require('express');
const router = express.Router();
const {
    getAssessmentExam,
    getAssessmentSummary,
    submitAssessmentExam
} = require('../controllers/assessmentController');
const { protect } = require('../middleware/auth');

router.get('/', protect, getAssessmentSummary);
router.get('/exam', protect, getAssessmentExam);
router.post('/submit', protect, submitAssessmentExam);

module.exports = router;
