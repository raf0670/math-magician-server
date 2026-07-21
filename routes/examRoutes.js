const express = require('express');
const router = express.Router();
const { createExam, getAllExams, getExam, getPracticeMeta, startPracticeExam, startQuizExam, submitExam } = require('../controllers/examController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/', protect, getAllExams);
router.get('/practice/meta', protect, getPracticeMeta);
router.post('/practice/start', protect, startPracticeExam);
router.post('/quiz/start', protect, startQuizExam);
router.post('/', protect, authorizeAdmin, createExam);
router.get('/:id', protect, getExam);
router.post('/:id/submit', protect, submitExam);

module.exports = router;
