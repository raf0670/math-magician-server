const express = require('express');
const router = express.Router();
const {
    getAssessmentExam,
    getAssessmentSummary,
    submitAssessmentExam
} = require('../controllers/assessmentController');
const { protect, authorizeApprovedAccess } = require('../middleware/auth');

router.get('/', protect, authorizeApprovedAccess, getAssessmentSummary);
router.get('/exam', protect, authorizeApprovedAccess, getAssessmentExam);
router.post('/submit', protect, authorizeApprovedAccess, submitAssessmentExam);

module.exports = router;
