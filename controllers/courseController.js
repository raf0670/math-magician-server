const Course = require('../models/Course');
const User = require('../models/User');

// @desc    Create a new course
// @route   POST /api/courses
// @access  Private/Admin
exports.createCourse = async (req, res) => {
    try {
        const { title, description, modules } = req.body;

        const course = await Course.create({
            title,
            description,
            modules
        });

        res.status(201).json({ success: true, data: course });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all courses (for browsing)
// @route   GET /api/courses
// @access  Public
exports.getAllCourses = async (req, res) => {
    try {
        const courses = await Course.find();
        res.status(200).json({ success: true, count: courses.length, data: courses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update an existing course or add modules/lectures
// @route   PUT /api/courses/:id
// @access  Private/Admin
exports.updateCourse = async (req, res) => {
    try {
        // Find the course by the URL parameter ID and update it with the incoming request body
        const course = await Course.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true, // Returns the newly updated document back to us instead of the old one
                runValidators: true // Ensures any modifications still adhere to our original Mongoose schema rules
            }
        );

        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        res.status(200).json({ success: true, data: course });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Enroll a student in a course
// @route   POST /api/courses/:id/enroll
// @access  Private (Authenticated Students/Admins)
exports.enrollInCourse = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const course = await Course.findById(req.params.id);

        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        // Check if already enrolled to avoid duplicates
        if (user.enrolledCourses.includes(course._id)) {
            return res.status(400).json({ success: false, message: 'Already enrolled in this course' });
        }

        // Push course ID to user's enrollment array
        user.enrolledCourses.push(course._id);
        await user.save();

        res.status(200).json({ success: true, message: 'Successfully enrolled in course' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};