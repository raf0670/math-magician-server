const Exam = require('../models/Exam');
const Submission = require('../models/Submission');
const QuestionBank = require('../models/QuestionBank');

// @desc    Create a new exam setup
// @route   POST /api/exams
// @access  Private/Admin
exports.createExam = async (req, res) => {
    try {
        const { title, questions, duration, totalMarks } = req.body;
        const exam = await Exam.create({ title, questions, duration, totalMarks });
        res.status(201).json({ success: true, data: exam });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get an individual exam with its full questions (without exposing answer keys if preferred)
// @route   GET /api/exams/:id
// @access  Private
exports.getExam = async (req, res) => {
    try {
        // Populate the exam with actual question text and option arrays
        const exam = await Exam.findById(req.params.id).populate({
            path: 'questions',
            select: 'questionText options subject chapter' // Explicitly leaves out correctOptionIndex for security!
        });

        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam configuration not found' });
        }

        res.status(200).json({ success: true, data: exam });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Submit answers and grade the test instantly
// @route   POST /api/exams/:id/submit
// @access  Private
exports.submitExam = async (req, res) => {
    try {
        const { answers } = req.body; // e.g. [0, 2, 1, 3]
        const exam = await Exam.findById(req.params.id).populate('questions');

        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        let dynamicScore = 0;
        const totalQuestions = exam.questions.length;
        const marksPerQuestion = exam.totalMarks / totalQuestions;

        // Loop through questions to evaluate correct values
        exam.questions.forEach((question, index) => {
            // Compare user choice with stored correct index
            if (answers[index] !== undefined && answers[index] === question.correctOptionIndex) {
                dynamicScore += marksPerQuestion;
            }
        });

        // Save student attempt profile to database
        const submission = await Submission.create({
            student: req.user.id,
            exam: exam._id,
            answers,
            score: dynamicScore
        });

        res.status(201).json({
            success: true,
            message: 'Exam graded successfully!',
            score: dynamicScore,
            totalMarks: exam.totalMarks,
            submissionId: submission._id
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};