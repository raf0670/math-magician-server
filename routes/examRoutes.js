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
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/', protect, getAllExams);
router.get('/practice/meta', protect, getPracticeMeta);
router.post('/practice/start', protect, startPracticeExam);
router.post('/quiz/start', protect, startQuizExam);
router.get('/live', protect, getLiveExams);
router.get('/live/admin', protect, authorizeAdmin, getAdminLiveExams);
router.post('/live/admin', protect, authorizeAdmin, createLiveExam);
router.patch('/live/admin/:id', protect, authorizeAdmin, updateLiveExam);
router.post('/', protect, authorizeAdmin, createExam);
router.get('/:id', protect, getExam);
router.post('/:id/submit', protect, submitExam);

module.exports = router;
