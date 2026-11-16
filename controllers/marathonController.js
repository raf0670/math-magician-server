const MarathonLink = require('../models/MarathonLink');
const { MARATHON_SECTIONS } = require('../config/programs');
const { loadProgramAccess } = require('../services/programAccessService');

function clean(value) {
    return value?.toString().trim() || '';
}

function isHttpsUrl(value) {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

function sectionLabel(section) {
    return section === 'english' ? 'English' : 'Maths';
}

function validateSection(value) {
    return MARATHON_SECTIONS.includes(value);
}

async function loadLinks() {
    const links = await MarathonLink.find({ section: { $in: MARATHON_SECTIONS } })
        .populate('updatedBy', 'name email')
        .lean();
    return new Map(links.map(link => [link.section, link]));
}

exports.getMarathonDashboard = async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const { access } = isAdmin ? { access: { marathonSections: MARATHON_SECTIONS } } : await loadProgramAccess(req.user._id);
        const entitled = new Set(access.marathonSections || []);
        const linkBySection = await loadLinks();
        const sections = MARATHON_SECTIONS.map(section => {
            const link = linkBySection.get(section);
            const hasAccess = isAdmin || entitled.has(section);
            const isPublished = Boolean(link?.isPublished);
            return {
                id: section,
                title: sectionLabel(section),
                entitled: hasAccess,
                published: isPublished,
                joinUrl: hasAccess && isPublished ? link.url : null,
                updatedAt: link?.updatedAt || null
            };
        });

        res.set('Cache-Control', 'private, no-store').json({ success: true, data: { sections } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAdminMarathonLinks = async (_req, res) => {
    try {
        const linkBySection = await loadLinks();
        const data = MARATHON_SECTIONS.map(section => {
            const link = linkBySection.get(section);
            return {
                id: link?._id || null,
                section,
                title: sectionLabel(section),
                url: link?.url || '',
                isPublished: Boolean(link?.isPublished),
                updatedBy: link?.updatedBy || null,
                updatedAt: link?.updatedAt || null
            };
        });
        res.set('Cache-Control', 'private, no-store').json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateAdminMarathonLink = async (req, res) => {
    try {
        const section = clean(req.params.section).toLowerCase();
        if (!validateSection(section)) return res.status(400).json({ success: false, message: 'Invalid Marathon section.' });

        const existing = await MarathonLink.findOne({ section }).lean();
        const url = clean(req.body.url) || existing?.url || '';
        const isPublished = Boolean(req.body.isPublished);
        if (url && !isHttpsUrl(url)) return res.status(400).json({ success: false, message: 'Please enter a valid HTTPS class link.' });
        if (isPublished && !url) return res.status(400).json({ success: false, message: 'Add a class link before publishing.' });

        const link = await MarathonLink.findOneAndUpdate(
            { section },
            { section, url, isPublished, updatedBy: req.user._id },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        ).populate('updatedBy', 'name email').lean();

        res.status(200).json({
            success: true,
            data: {
                id: link._id,
                section: link.section,
                title: sectionLabel(link.section),
                url: link.url,
                isPublished: link.isPublished,
                updatedBy: link.updatedBy,
                updatedAt: link.updatedAt
            }
        });
    } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};

exports._private = { isHttpsUrl, validateSection };
