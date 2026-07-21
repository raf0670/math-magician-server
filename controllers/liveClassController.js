const LiveClass = require('../models/LiveClass');
const Payment = require('../models/Payment');
const User = require('../models/User');

const APPROVED_ACCESS_STATUSES = ['approved', 'paid'];

function clean(value) {
    return value?.toString().trim() || '';
}

function isValidZoomUrl(value) {
    try {
        const parsed = new URL(value);
        const hostname = parsed.hostname.toLowerCase();
        const isHttps = parsed.protocol === 'https:';
        const isZoomHost = hostname === 'zoom.us'
            || hostname.endsWith('.zoom.us')
            || hostname === 'zoom.com'
            || hostname.endsWith('.zoom.com');

        return isHttps && isZoomHost;
    } catch {
        return false;
    }
}

function parseClassPayload(body = {}) {
    const title = clean(body.title);
    const zoomUrl = clean(body.zoomUrl);
    const note = clean(body.note);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    const errors = [];

    if (!title) errors.push('Class title is required.');
    if (!zoomUrl || !isValidZoomUrl(zoomUrl)) errors.push('Please add a valid Zoom URL.');
    if (Number.isNaN(startsAt.getTime())) errors.push('Please add a valid start time.');
    if (Number.isNaN(endsAt.getTime())) errors.push('Please add a valid end time.');
    if (!Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime()) && endsAt <= startsAt) {
        errors.push('Class end time must be after the start time.');
    }

    return {
        payload: { title, zoomUrl, startsAt, endsAt, note },
        errors
    };
}

async function userHasClassAccess(user) {
    if (user.role === 'admin' || user.hasClassAccess) return true;

    const hasApprovedPayment = await Payment.exists({
        user: user._id,
        status: { $in: APPROVED_ACCESS_STATUSES }
    });

    if (hasApprovedPayment) {
        await User.findByIdAndUpdate(user._id, { hasClassAccess: true });
    }

    return Boolean(hasApprovedPayment);
}

exports.getCurrentLiveClass = async (req, res) => {
    try {
        const hasAccess = await userHasClassAccess(req.user);

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Classes unlock after admin approval.'
            });
        }

        const now = new Date();
        const liveClass = await LiveClass.findOne({ endsAt: { $gte: now } })
            .sort({ startsAt: 1 })
            .populate('createdBy', 'name email')
            .lean();

        res.status(200).json({ success: true, data: liveClass || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAdminLiveClasses = async (req, res) => {
    try {
        const liveClasses = await LiveClass.find()
            .sort({ startsAt: -1 })
            .limit(60)
            .populate('createdBy', 'name email')
            .lean();

        res.status(200).json({
            success: true,
            count: liveClasses.length,
            data: liveClasses
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createLiveClass = async (req, res) => {
    try {
        const { payload, errors } = parseClassPayload(req.body);

        if (errors.length) {
            return res.status(400).json({ success: false, message: errors[0], errors });
        }

        const liveClass = await LiveClass.create({
            ...payload,
            createdBy: req.user._id
        });

        const populated = await LiveClass.findById(liveClass._id)
            .populate('createdBy', 'name email')
            .lean();

        res.status(201).json({ success: true, data: populated });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports.updateLiveClass = async (req, res) => {
    try {
        const { payload, errors } = parseClassPayload(req.body);

        if (errors.length) {
            return res.status(400).json({ success: false, message: errors[0], errors });
        }

        const liveClass = await LiveClass.findByIdAndUpdate(
            req.params.id,
            payload,
            { new: true, runValidators: true }
        )
            .populate('createdBy', 'name email')
            .lean();

        if (!liveClass) {
            return res.status(404).json({ success: false, message: 'Live class was not found.' });
        }

        res.status(200).json({ success: true, data: liveClass });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};
