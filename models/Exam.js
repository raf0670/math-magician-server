const mongoose = require('mongoose');

const ExamSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please add an exam title'],
        trim: true
    },
    questions: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'QuestionBank', // Pulls questions directly from your seeded collection
            required: true
        }
    ],
    duration: {
        type: Number,
        required: [true, 'Please specify exam duration in minutes']
    },
    totalMarks: {
        type: Number,
        required: true
    },
    negativeMarksPerQuestion: {
        type: Number,
        default: 0.25 // Defaults to 0.25 if not explicitly provided by admin
    },
    examType: {
        type: String,
        enum: ['official', 'generatedPractice', 'generatedQuiz'],
        default: 'official',
        index: true
    },
    allowRetakes: {
        type: Boolean,
        default: false // By default, strict formal exams block double submissions
    },
    isLiveExam: {
        type: Boolean,
        default: false // If false, it's a practice exam open anytime. If true, strict gates apply.
    },
    startTime: {
        type: Date // The exact moment the test paper becomes visible
    },
    endTime: {
        type: Date // The exact moment submissions freeze
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Exam', ExamSchema);
