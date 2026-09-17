const express = require('express');
const router = express.Router();
const { register, login, forgotPassword, resetPassword, getMe, updateProfile, updateProfilePicture, changePassword } = require('../controllers/authController');
const { protect, authorizeAdmin } = require('../middleware/auth');
const { handleProfileImageUpload } = require('../middleware/profileImageUpload');

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);

// Private/Protected Route Example (Accessible by logged-in users only)
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/profile-picture', protect, handleProfileImageUpload, updateProfilePicture);
router.put('/change-password', protect, changePassword);

// Admin Only Route Example (Accessible only if user.role === 'admin')
router.get('/admin-panel', protect, authorizeAdmin, (req, res) => {
    res.status(200).json({ success: true, message: 'Welcome to the Admin Command Center!' });
});

module.exports = router;
