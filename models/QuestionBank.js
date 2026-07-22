const mongoose = require('mongoose');

const QuestionBankSchema = new mongoose.Schema({
    questionNo: {
        type: Number
    },
    question_no: {
        type: Number
    },
    question: {
        type: String,
        trim: true
    },
    questionText: {
        type: String,
        required: [true, 'Please add the question content'],
        trim: true
    },
    options: {
        type: [String],
        required: [true, 'Please add multiple choice options'],
        validate: [arrayLimit, 'A question must have between 2 and 5 options']
    },
    correctOptionIndex: {
        type: Number,
        required: [true, 'Please specify the correct answer or correct option index'],
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
        required: [true, 'Please add a subject (e.g., Math, English, Analytical)'],
        trim: true
    },
    difficulty: {
        type: String,
        trim: true,
        index: true
    },
    chapter: {
        type: String,
        required: [true, 'Please add a chapter or topic name'],
        trim: true
    },
    topic: {
        type: String,
        trim: true
    },
    subTopic: {
        type: String,
        trim: true
    },
    explanation: {
        type: String,
        trim: true
    },
    source: {
        type: String,
        trim: true,
        index: true
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

// Custom validator to support standard 4-option and IBA-style 5-option MCQs
function arrayLimit(val) {
    return val.length >= 2 && val.length <= 5;
}

QuestionBankSchema.pre('validate', function normalizeQuestionShape() {
    if (!this.questionNo && this.question_no) {
        this.questionNo = this.question_no;
    }

    if (!this.questionText && this.question) {
        this.questionText = this.question;
    }

    if (!this.correctAnswer && this.correct_answer) {
        this.correctAnswer = this.correct_answer;
    }

    if (!this.chapter && this.topic) {
        this.chapter = this.topic;
    }

    if (!this.topic && this.chapter) {
        this.topic = this.chapter;
    }

    if (!this.correctAnswer && Array.isArray(this.options) && this.correctOptionIndex >= 0) {
        this.correctAnswer = this.options[this.correctOptionIndex];
    }

    if ((this.correctOptionIndex === undefined || this.correctOptionIndex === null) && this.correctAnswer && Array.isArray(this.options)) {
        const normalizedCorrectAnswer = this.correctAnswer.toString().trim().toLowerCase();
        const matchedIndex = this.options.findIndex((option) => option.toString().trim().toLowerCase() === normalizedCorrectAnswer);

        if (matchedIndex >= 0) {
            this.correctOptionIndex = matchedIndex;
        }
    }
});

module.exports = mongoose.model('QuestionBank', QuestionBankSchema);
