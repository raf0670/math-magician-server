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
    submissionReason: {
        type: String,
        enum: ['manual', 'timer_expired', 'tab_switch'],
        default: 'manual',
        index: true
    },
    isRetake: {
        type: Boolean,
        default: false,
        index: true
    },
    attemptNumber: {
        type: Number,
        default: 1,
        min: 1,
        index: true
    },
    clientAttemptId: {
        type: String,
        trim: true
    },
    isDisqualified: {
        type: Boolean,
        default: false,
        index: true
    },
    originalScore: {
        type: Number
    },
    disqualificationReason: {
        type: String,
        trim: true,
        default: ''
    },
    disqualifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    disqualifiedAt: {
        type: Date
    },
    reinstatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reinstatedAt: {
        type: Date
    },
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

SubmissionSchema.index(
    { student: 1, exam: 1 },
    {
        unique: true,
        partialFilterExpression: { isRetake: false },
        name: 'unique_official_submission_per_student_exam'
    }
);
SubmissionSchema.index(
    { student: 1, exam: 1, clientAttemptId: 1 },
    {
        unique: true,
        partialFilterExpression: { clientAttemptId: { $type: 'string' } },
        name: 'unique_client_attempt_submission'
    }
);

// Optimize leaderboard-style queries for a specific exam.
SubmissionSchema.index({ exam: 1, isRetake: 1, score: -1 });

module.exports = mongoose.model('Submission', SubmissionSchema);
