const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { syncProgramAccess } = require('../services/programAccessService');
const { canAccessProgram, programOf } = require('../config/programs');
const Exam = require('../models/Exam');
const mongoose = require('mongoose');

const AUTH_USER_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS) || 30000;
const authUserCache = new Map();
exports.invalidateAuthUser = (userId) => authUserCache.delete(userId.toString());

function getCachedUser(userId) {
    const cached = authUserCache.get(userId);
    if (!cached || cached.expiresAt <= Date.now()) {
        authUserCache.delete(userId);
        return null;
    }

    return cached.user;
}

function setCachedUser(user) {
    const userId = user?._id?.toString();
    if (!userId) return;

    authUserCache.set(userId, {
        user: {
            ...user,
            id: userId
        },
        expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS
    });
}

// Middleware 1: Verify if the user is logged in via JWT
exports.protect = async (req, res, next) => {
    let token;

    // Check if token exists in the incoming Request Headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Split the header "Bearer <token_string>" to isolate just the token
            token = req.headers.authorization.split(' ')[1];

            // Verify the token using your unique JWT_SECRET string
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            req.user = getCachedUser(decoded.id);

            if (!req.user) {
                // Fetch only request-scoped auth fields to reduce DB work during live-exam bursts.
                const user = await User.findById(decoded.id)
                    .select('name email role house bio hasClassAccess hasMathAccess mathPaymentStatus mathAccessStartsAt generalAccessStartsAt hasBooked bookedPlanId bookedAt paymentStatus')
                    .lean();

                if (user) {
                    setCachedUser(user);
                    req.user = getCachedUser(decoded.id);
                }
            }

            if (!req.user) {
                return res.status(401).json({ success: false, message: 'Not authorized, user account was not found' });
            }

            next(); // Move on to the actual route handler function
        } catch (error) {
            return res.status(401).json({ success: false, message: 'Not authorized, invalid token' });
        }
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized, no token provided' });
    }
};

// Middleware 2: Guard system restricting access exclusively to Admin accounts
exports.authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
    }
};

async function ensureProgramAccess(req, res, next, program) {
    try {
        if (canAccessProgram(req.user, program)) return next();
        const access = await syncProgramAccess(req.user._id);
        req.user = { ...req.user, ...access };
        if (canAccessProgram(req.user, program)) return next();
        return res.status(403).json({ success: false, message: program === 'math' ? 'Enroll in the Math Course to open this section.' : 'This section requires full website access.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}
exports.authorizeApprovedAccess = (req, res, next) => ensureProgramAccess(req, res, next, 'general');
exports.authorizeProgramAccess = (req, res, next) => {
    const program = req.query.program || 'general';
    if (!['general', 'math'].includes(program)) return res.status(400).json({ success: false, message: 'Invalid program.' });
    req.program = program;
    return ensureProgramAccess(req, res, next, program);
};
exports.authorizeExamAccess = async (req, res, next) => {
    try {
        const id = req.params.id || req.params.examId;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'Exam not found.' });
        const exam = await Exam.findById(id).select('program').lean();
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found.' });
        req.program = programOf(exam.program);
        return ensureProgramAccess(req, res, next, req.program);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
