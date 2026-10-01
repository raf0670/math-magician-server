const RankPointAdjustment = require('../models/RankPointAdjustment');
const RankPointAdjustmentBatch = require('../models/RankPointAdjustmentBatch');
const {
    RankPointAdjustmentError,
    applyAdjustmentBatch,
    previewAdjustmentBatch,
    reverseAdjustmentBatch
} = require('../services/rankPointAdjustmentService');

function getMetadata(req) {
    return {
        label: req.body.label,
        reason: req.body.reason,
        program: req.body.program || 'general',
        expectedHouse: req.body.expectedHouse,
        effectiveDate: req.body.effectiveDate
    };
}

function sendError(res, error) {
    if (error instanceof RankPointAdjustmentError) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            ...(error.details?.length ? { details: error.details } : {})
        });
    }

    console.error('Rank point adjustment error:', error);
    return res.status(500).json({ success: false, message: 'Unable to process the RP adjustment request.' });
}

function getPagination(req) {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    return { page, limit, skip: (page - 1) * limit };
}

exports.previewRankPointAdjustmentBatch = async (req, res) => {
    try {
        const preview = await previewAdjustmentBatch({ file: req.file, metadata: getMetadata(req) });
        return res.status(200).json({ success: true, data: preview });
    } catch (error) {
        return sendError(res, error);
    }
};

exports.applyRankPointAdjustmentBatch = async (req, res) => {
    try {
        const batch = await applyAdjustmentBatch({
            file: req.file,
            metadata: getMetadata(req),
            importedBy: req.user._id || req.user.id
        });
        return res.status(201).json({
            success: true,
            message: `Applied ${batch.rowCount} RP adjustments totaling ${batch.totalPoints}.`,
            data: batch
        });
    } catch (error) {
        return sendError(res, error);
    }
};

exports.listRankPointAdjustmentBatches = async (req, res) => {
    try {
        const { page, limit, skip } = getPagination(req);
        const filter = { program: 'general' };
        const [batches, totalCount] = await Promise.all([
            RankPointAdjustmentBatch.find(filter)
                .populate('importedBy', 'name email')
                .populate('reversedBy', 'name email')
                .populate('reversalBatch', 'label kind totalPoints createdAt')
                .populate('reversesBatch', 'label status totalPoints createdAt')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            RankPointAdjustmentBatch.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            count: batches.length,
            totalCount,
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / limit)),
            data: batches
        });
    } catch (error) {
        return sendError(res, error);
    }
};

exports.reverseRankPointAdjustmentBatch = async (req, res) => {
    try {
        const batch = await reverseAdjustmentBatch(req.params.batchId, req.user._id || req.user.id);
        return res.status(201).json({
            success: true,
            message: 'The batch was reversed with an equal and opposite audit entry.',
            data: batch
        });
    } catch (error) {
        return sendError(res, error);
    }
};

exports.getMyRankPointAdjustments = async (req, res) => {
    try {
        const program = String(req.query.program || 'general').toLowerCase();
        if (program !== 'general') {
            return res.status(400).json({ success: false, message: 'Bonus RP history is available for the general program only.' });
        }

        const { page, limit, skip } = getPagination(req);
        const now = new Date();
        const filter = {
            student: req.user._id || req.user.id,
            program,
            effectiveDate: { $lte: now }
        };
        const [adjustments, totalCount, totals] = await Promise.all([
            RankPointAdjustment.find(filter)
                .populate('batch', 'label status kind reversesBatch reversalBatch originalFilename')
                .sort({ effectiveDate: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            RankPointAdjustment.countDocuments(filter),
            RankPointAdjustment.aggregate([
                { $match: filter },
                { $group: { _id: null, totalPoints: { $sum: '$points' }, entryCount: { $sum: 1 } } }
            ])
        ]);
        const summary = totals[0] || { totalPoints: 0, entryCount: 0 };

        return res.status(200).json({
            success: true,
            count: adjustments.length,
            totalCount,
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / limit)),
            summary: {
                totalPoints: Number(Number(summary.totalPoints || 0).toFixed(2)),
                entryCount: summary.entryCount || 0
            },
            data: adjustments
        });
    } catch (error) {
        return sendError(res, error);
    }
};

exports._private = {
    getMetadata,
    getPagination
};
