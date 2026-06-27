const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

            // Fetch the user from DB based on decoded ID, excluding the password field, and attach to request
            req.user = await User.findById(decoded.id);

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
