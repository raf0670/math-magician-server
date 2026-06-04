const express = require('express');
const router = express.Router();
const { createExam, getExam, submitExam } = require('../controllers/examController');
const { protect, authorizeAdmin } = require('../middleware/auth');

router.post('/', protect, authorizeAdmin, createExam);
router.get('/:id', protect, getExam);
router.post('/:id/submit', protect, submitExam);

module.exports = router;