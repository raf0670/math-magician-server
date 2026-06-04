const mongoose = require('mongoose');

const QuestionBankSchema = new mongoose.Schema({
    questionText: {
        type: String,
        required: [true, 'Please add the question content'],
        trim: true
    },
    options: {
        type: [String],
        required: [true, 'Please add multiple choice options'],
        validate: [arrayLimit, 'A question must have exactly 4 options']
    },
    correctOptionIndex: {
        type: Number,
        required: [true, 'Please specify the index of the correct answer (0-3)'],
        min: 0,
        max: 3
    },
    subject: {
        type: String,
        required: [true, 'Please add a subject (e.g., Physics, Chemistry)'],
        trim: true
    },
    chapter: {
        type: String,
        required: [true, 'Please add a chapter name'],
        trim: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Custom validator to make sure we always get exactly 4 choices
function arrayLimit(val) {
    return val.length === 4;
}

module.exports = mongoose.model('QuestionBank', QuestionBankSchema);