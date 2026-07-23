const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
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

SubmissionSchema.index({ student: 1, exam: 1 }, { unique: true });

// Optimize leaderboard-style queries for a specific exam.
SubmissionSchema.index({ exam: 1, score: -1 });

module.exports = mongoose.model('Submission', SubmissionSchema);
