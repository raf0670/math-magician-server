const mongoose = require('mongoose');
const { HOUSES } = require('../config/competition');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please add a name'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Please add an email'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email']
    },
    password: {
        type: String,
        required: [true, 'Please add a password'],
        minlength: [6, 'Password must be at least 6 characters long'],
        select: false // This prevents the password from being returned in API responses by default (for security)
    },
    resetPasswordToken: {
        type: String,
        select: false
    },
    resetPasswordExpires: {
        type: Date,
        index: true
    },
    resetPasswordRequestedAt: {
        type: Date
    },
    role: {
        type: String,
        enum: ['student', 'admin'],
        default: 'student'
    },
    house: {
        type: String,
        enum: [...HOUSES, ''],
        default: '',
        index: true
    },
    bio: {
        type: String,
        trim: true,
        maxlength: [160, 'Bio must be 160 characters or fewer'],
        default: ''
    },
    enrolledCourses: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course' // This links the user to their purchased courses later
        }
    ],
    hasClassAccess: {
        type: Boolean,
        default: false
    },
    hasMathAccess: { type: Boolean, default: false, index: true },
    mathPaymentStatus: { type: String, enum: ['unpaid', 'fullyPaid'], default: 'unpaid' },
    mathAccessStartsAt: { type: Date, default: null },
    generalAccessStartsAt: { type: Date, default: null },
    mathCheckoutLockUntil: { type: Date, select: false },
    hasBooked: {
        type: Boolean,
        default: false,
        index: true
    },
    bookedPlanId: {
        type: String,
        trim: true,
        default: ''
    },
    bookedAt: {
        type: Date
    },
    paymentStatus: {
        type: String,
        enum: ['unpaid', 'partiallyPaid', 'fullyPaid'],
        default: 'unpaid',
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', UserSchema);
