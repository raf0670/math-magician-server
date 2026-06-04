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
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Exam', ExamSchema);