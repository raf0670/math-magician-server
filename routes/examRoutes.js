const express = require('express');
const router = express.Router();
const { createExam, getAllExams, getExam, submitExam } = require('../controllers/examController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.get('/', protect, getAllExams);
router.post('/', protect, authorizeAdmin, createExam);
router.get('/:id', protect, getExam);
router.post('/:id/submit', protect, submitExam);

module.exports = router;