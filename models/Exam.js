const mongoose = require('mongoose');
const { COMPETITION_CATEGORIES } = require('../config/competition');

const ExamSchema = new mongoose.Schema({
    program: { type: String, enum: ['general', 'math'], default: 'general', index: true },
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
    passingMarks: {
        type: Number,
        validate: [
            {
                validator(value) {
                    return value === undefined || value === null || Number.isInteger(value);
                },
                message: 'Passing marks must be a whole number'
            },
            {
                validator(value) {
                    return value === undefined || value === null || value >= 0;
                },
                message: 'Passing marks cannot be negative'
            },
            {
                validator(value) {
                    if (value === undefined || value === null) return true;
                    const update = this.getUpdate?.() || {};
                    const totalMarks = this.totalMarks ?? this.get?.('totalMarks') ?? update.totalMarks ?? update.$set?.totalMarks;
                    return value <= Number(totalMarks);
                },
                message: 'Passing marks cannot exceed total marks'
            }
        ]
    },
    negativeMarksPerQuestion: {
        type: Number,
        default: 0.25 // Defaults to 0.25 if not explicitly provided by admin
    },
    examType: {
        type: String,
        enum: ['official', 'assessment', 'assignment', 'generatedPractice', 'generatedQuiz'],
        default: 'official',
        index: true
    },
    examCode: {
        type: String,
        trim: true,
        index: true,
        unique: true,
        sparse: true
    },
    questionSource: {
        type: String,
        enum: ['QuestionBank', 'AssessmentTest'],
        default: 'QuestionBank',
        index: true
    },
    competitionCategory: {
        type: String,
        enum: COMPETITION_CATEGORIES,
        default: 'daily',
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
    assignmentDate: {
        type: String,
        trim: true
    },
    examDate: {
        type: String,
        trim: true
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
