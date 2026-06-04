const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true
    },
    answers: [
        {
            type: Number // Array of choice indices selected by student, e.g., [0, 2, 1, 3]
        }
    ],
    score: {
        type: Number,
        required: true
    },
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Submission', SubmissionSchema);