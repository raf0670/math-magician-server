const express = require('express');
const router = express.Router();
const { createCourse, getAllCourses, enrollInCourse, updateCourse } = require('../controllers/courseController');
const { protect, authorizeAdmin } = require('../middleware/auth');

// Public route for any student to browse courses
router.get('/', getAllCourses);

// Protected admin-only route to create courses
router.post('/', protect, authorizeAdmin, createCourse);
router.put('/:id', protect, authorizeAdmin, updateCourse);
router.post('/:id/enroll', protect, enrollInCourse);

module.exports = router;