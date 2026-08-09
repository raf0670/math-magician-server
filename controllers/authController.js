const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../services/emailService');

const PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 15;
const PASSWORD_RESET_SUCCESS_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';

function formatAuthUser(user) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        house: user.house || '',
        bio: user.bio || '',
        hasClassAccess: Boolean(user.hasClassAccess),
        hasBooked: Boolean(user.hasBooked),
        bookedPlanId: user.bookedPlanId || '',
        bookedAt: user.bookedAt || null,
        paymentStatus: user.paymentStatus || 'unpaid'
    };
}

function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getFrontendResetUrl(token) {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    return `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // 1. Check if user already exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        // 2. Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Create user in database
        user = await User.create({
            name,
            email,
            password: hashedPassword // Save the secure hashed version
        });

        // 4. Generate JWT Token
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
            expiresIn: '30d' // Token remains valid for 30 days
        });

        res.status(201).json({
            success: true,
            token,
            user: formatAuthUser(user)
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Login existing user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Check if user exists (explicitly select password field since it's hidden by default)
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // 2. Check if password matches
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // 3. Generate JWT Token
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
            expiresIn: '30d'
        });

        res.status(200).json({
            success: true,
            token,
            user: formatAuthUser(user)
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Email a password reset link when the account exists
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
    try {
        const email = req.body?.email?.toString().trim().toLowerCase();

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(200).json({ success: true, message: PASSWORD_RESET_SUCCESS_MESSAGE });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        await User.findByIdAndUpdate(user._id, {
            resetPasswordToken: hashResetToken(rawToken),
            resetPasswordExpires: new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000),
            resetPasswordRequestedAt: new Date()
        });

        try {
            await sendPasswordResetEmail({
                to: user.email,
                name: user.name,
                resetUrl: getFrontendResetUrl(rawToken),
                expiresInMinutes: PASSWORD_RESET_TOKEN_EXPIRY_MINUTES
            });
        } catch (emailError) {
            await User.findByIdAndUpdate(user._id, {
                $unset: {
                    resetPasswordToken: '',
                    resetPasswordExpires: '',
                    resetPasswordRequestedAt: ''
                }
            });
            console.error('Password reset email failed:', emailError.message);
            return res.status(500).json({ success: false, message: 'Unable to send reset email right now.' });
        }

        return res.status(200).json({ success: true, message: PASSWORD_RESET_SUCCESS_MESSAGE });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reset password using an emailed token
// @route   PUT /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
    try {
        const token = req.params.token?.toString().trim();
        const password = req.body?.password?.toString();

        if (!token) {
            return res.status(400).json({ success: false, message: 'Reset token is required.' });
        }

        if (!password || password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
        }

        const user = await User.findOne({
            resetPasswordToken: hashResetToken(token),
            resetPasswordExpires: { $gt: new Date() }
        }).select('+password +resetPasswordToken');

        if (!user) {
            return res.status(400).json({ success: false, message: 'Password reset link is invalid or has expired.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        user.resetPasswordRequestedAt = undefined;
        await user.save();

        return res.status(200).json({ success: true, message: 'Password reset successfully. Please sign in with your new password.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Return the authenticated user's profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('name email role house bio hasClassAccess hasBooked bookedPlanId bookedAt paymentStatus')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'User account was not found' });
        }

        res.status(200).json({
            success: true,
            data: formatAuthUser(user)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update profile information
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
    try {
        const { name, bio } = req.body;
        const updates = {};

        if (name) updates.name = name;
        if (typeof bio !== 'undefined') updates.bio = bio;

        const user = await User.findByIdAndUpdate(req.user._id, updates, {
            new: true,
            runValidators: true
        }).select('-password');

        res.status(200).json({
            success: true,
            data: formatAuthUser(user)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Change the current user's password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both current and new password are required.' });
        }

        const user = await User.findById(req.user._id).select('+password');
        const isMatch = await bcrypt.compare(currentPassword, user.password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.status(200).json({ success: true, message: 'Password updated successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
