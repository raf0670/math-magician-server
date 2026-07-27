const express = require('express');
const router = express.Router();
const {
    createExam,
    createLiveExam,
    getAdminLiveExams,
    getAllExams,
    getExam,
    getLiveExams,
    getPracticeMeta,
    startPracticeExam,
    startQuizExam,
    submitExam,
    updateLiveExam
} = require('../controllers/examController');
const { protect, authorizeAdmin, authorizeApprovedAccess } = require('../middleware/auth');

router.get('/', protect, authorizeApprovedAccess, getAllExams);
router.get('/practice/meta', protect, authorizeApprovedAccess, getPracticeMeta);
router.post('/practice/start', protect, authorizeApprovedAccess, startPracticeExam);
router.post('/quiz/start', protect, authorizeApprovedAccess, startQuizExam);
router.get('/live', protect, authorizeApprovedAccess, getLiveExams);
router.get('/live/admin', protect, authorizeAdmin, getAdminLiveExams);
router.post('/live/admin', protect, authorizeAdmin, createLiveExam);
router.patch('/live/admin/:id', protect, authorizeAdmin, updateLiveExam);
router.post('/', protect, authorizeAdmin, createExam);
router.get('/:id', protect, authorizeApprovedAccess, getExam);
router.post('/:id/submit', protect, authorizeApprovedAccess, submitExam);

module.exports = router;
