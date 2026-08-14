const mongoose = require('mongoose');

const AssessmentTestSchema = new mongoose.Schema({
    questionNo: {
        type: Number
    },
    question_no: {
        type: Number,
        index: true
    },
    instruction: {
        type: String,
        trim: true
    },
    question: {
        type: String,
        trim: true
    },
    questionText: {
        type: String,
        trim: true
    },
    options: {
        type: [String],
        default: []
    },
    correctOptionIndex: {
        type: Number,
        min: 0,
        max: 4
    },
    correctAnswer: {
        type: String,
        trim: true
    },
    correct_answer: {
        type: String,
        trim: true
    },
    subject: {
        type: String,
        trim: true
    },
    topic: {
        type: String,
        trim: true
    },
    chapter: {
        type: String,
        trim: true
    },
    subTopic: {
        type: String,
        trim: true
    },
    difficulty: {
        type: String,
        trim: true
    },
    explanation: {
        type: String,
        trim: true
    }
}, {
    collection: 'AssessmentTest',
    strict: false,
    timestamps: false
});

module.exports = mongoose.model('AssessmentTest', AssessmentTestSchema, 'AssessmentTest');
