const crypto = require('crypto');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const { HOUSES, normalizeHouse } = require('../config/competition');
const User = require('../models/User');
const RankPointAdjustment = require('../models/RankPointAdjustment');
const RankPointAdjustmentBatch = require('../models/RankPointAdjustmentBatch');

const MAX_ROWS = 500;
const MAX_ABSOLUTE_POINTS = 1000;
const EMAIL_HEADERS = new Set(['email', 'name']);
const POINT_HEADERS = new Set(['bonus rp', 'sum bonus', 'bonus', 'points', 'rp']);

class RankPointAdjustmentError extends Error {
    constructor(message, statusCode = 400, details = []) {
        super(message);
        this.name = 'RankPointAdjustmentError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

function roundPoints(value) {
    return Number(Number(value).toFixed(2));
}

function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDateInput(value) {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        throw new RankPointAdjustmentError('Class date must use YYYY-MM-DD format.');
    }

    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
        throw new RankPointAdjustmentError('Class date is invalid.');
    }

    return { value: normalized, date };
}

function normalizeMetadata(input = {}) {
    const label = String(input.label || '').trim();
    const reason = String(input.reason || '').trim();
    const program = String(input.program || 'general').trim().toLowerCase();
    const expectedHouse = normalizeHouse(input.expectedHouse);
    const effectiveDate = normalizeDateInput(input.effectiveDate);

    if (!label || label.length > 120) {
        throw new RankPointAdjustmentError('Batch label is required and must be 120 characters or fewer.');
    }
    if (!reason || reason.length > 240) {
        throw new RankPointAdjustmentError('Reason is required and must be 240 characters or fewer.');
    }
    if (program !== 'general') {
        throw new RankPointAdjustmentError('House bonus imports currently support the general program only.');
    }
    if (!expectedHouse || !HOUSES.includes(expectedHouse)) {
        throw new RankPointAdjustmentError('Choose a valid expected house.');
    }

    return {
        label,
        reason,
        program,
        expectedHouse,
        effectiveDate: effectiveDate.date,
        effectiveDateKey: effectiveDate.value
    };
}

function parsePointValue(value, rowNumber) {
    const normalized = String(value ?? '').trim();
    if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) {
        throw new RankPointAdjustmentError(`Row ${rowNumber} has an invalid RP value. Use a number with at most two decimals.`);
    }

    const points = Number(normalized);
    if (!Number.isFinite(points) || Math.abs(points) > MAX_ABSOLUTE_POINTS) {
        throw new RankPointAdjustmentError(`Row ${rowNumber} RP must be between -${MAX_ABSOLUTE_POINTS} and ${MAX_ABSOLUTE_POINTS}.`);
    }
    return roundPoints(points);
}

function parseRankPointCsv(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw new RankPointAdjustmentError('Choose a non-empty CSV file.');
    }

    let records;
    try {
        records = parse(buffer, {
            bom: true,
            relax_column_count: false,
            skip_empty_lines: true,
            trim: true
        });
    } catch (error) {
        throw new RankPointAdjustmentError(`CSV could not be parsed: ${error.message}`);
    }

    if (records.length < 2) {
        throw new RankPointAdjustmentError('CSV must contain a header and at least one student row.');
    }
    if (!Array.isArray(records[0]) || records[0].length !== 2) {
        throw new RankPointAdjustmentError('CSV must contain exactly two columns.');
    }

    const headers = records[0].map(normalizeHeader);
    const emailIndex = headers.findIndex((header) => EMAIL_HEADERS.has(header));
    const pointsIndex = headers.findIndex((header) => POINT_HEADERS.has(header));
    if (emailIndex < 0 || pointsIndex < 0 || emailIndex === pointsIndex) {
        throw new RankPointAdjustmentError('Use Email,Bonus RP or Name,Sum Bonus as the two CSV headers.');
    }

    const dataRows = records.slice(1);
    if (dataRows.length > MAX_ROWS) {
        throw new RankPointAdjustmentError(`CSV can contain at most ${MAX_ROWS} student rows.`);
    }

    const seenEmails = new Set();
    const rows = dataRows.map((record, index) => {
        const rowNumber = index + 2;
        if (!Array.isArray(record) || record.length !== 2) {
            throw new RankPointAdjustmentError(`Row ${rowNumber} must contain exactly two columns.`);
        }

        const email = String(record[emailIndex] || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new RankPointAdjustmentError(`Row ${rowNumber} has an invalid email address.`);
        }
        if (seenEmails.has(email)) {
            throw new RankPointAdjustmentError(`Email ${email} appears more than once in the CSV.`);
        }
        seenEmails.add(email);

        return {
            rowNumber,
            email,
            points: parsePointValue(record[pointsIndex], rowNumber)
        };
    });

    return rows;
}

function buildStats(rows) {
    return {
        rowCount: rows.length,
        positiveCount: rows.filter((row) => row.points > 0).length,
        zeroCount: rows.filter((row) => row.points === 0).length,
        negativeCount: rows.filter((row) => row.points < 0).length,
        totalPoints: roundPoints(rows.reduce((sum, row) => sum + row.points, 0))
    };
}

function buildIdempotency(metadata, rows) {
    const canonicalRows = [...rows]
        .sort((first, second) => first.email.localeCompare(second.email))
        .map((row) => `${row.email}:${row.points.toFixed(2)}`);
    const content = JSON.stringify({
        program: metadata.program,
        expectedHouse: metadata.expectedHouse,
        effectiveDate: metadata.effectiveDateKey,
        rows: canonicalRows
    });
    return crypto.createHash('sha256').update(content).digest('hex');
}

function isEligibleOnDate(user, effectiveDate) {
    const endOfDate = new Date(effectiveDate);
    endOfDate.setUTCHours(23, 59, 59, 999);
    const startsAt = user.generalAccessStartsAt ? new Date(user.generalAccessStartsAt) : null;
    if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > endOfDate) return false;

    if (user.hasClassAccess && !user.generalAccessSuspended) return true;
    if (!user.generalAccessSuspended) return false;

    const suspendedAt = user.generalAccessSuspendedAt ? new Date(user.generalAccessSuspendedAt) : null;
    return Boolean(suspendedAt && !Number.isNaN(suspendedAt.getTime()) && suspendedAt >= effectiveDate);
}

async function prepareAdjustmentBatch({ file, metadata: rawMetadata, session = null }) {
    if (!file?.buffer) throw new RankPointAdjustmentError('Choose a CSV file.');
    const metadata = normalizeMetadata(rawMetadata);
    const rows = parseRankPointCsv(file.buffer);
    const stats = buildStats(rows);
    const idempotencyKey = buildIdempotency(metadata, rows);

    let usersQuery = User.find({ email: { $in: rows.map((row) => row.email) } })
        .select('_id name email role house hasClassAccess generalAccessStartsAt generalAccessSuspended generalAccessSuspendedAt')
        .lean();
    if (session) usersQuery = usersQuery.session(session);
    const users = await usersQuery;
    const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
    const details = [];

    const resolvedRows = rows.map((row) => {
        const user = userByEmail.get(row.email);
        if (!user) {
            details.push({ rowNumber: row.rowNumber, email: row.email, message: 'No account matches this email.' });
            return { ...row, student: null, studentName: '', house: '' };
        }
        if (user.role !== 'student') {
            details.push({ rowNumber: row.rowNumber, email: row.email, message: 'The matching account is not a student.' });
        }
        if (normalizeHouse(user.house) !== metadata.expectedHouse) {
            details.push({ rowNumber: row.rowNumber, email: row.email, message: `Student belongs to ${user.house || 'no house'}, not ${metadata.expectedHouse}.` });
        }
        if (!isEligibleOnDate(user, metadata.effectiveDate)) {
            details.push({ rowNumber: row.rowNumber, email: row.email, message: 'Student was not eligible for general access on the class date.' });
        }

        return {
            ...row,
            student: user._id,
            studentName: user.name,
            house: user.house
        };
    });

    if (details.length) {
        throw new RankPointAdjustmentError('The CSV contains rows that cannot be imported.', 400, details);
    }

    let duplicateQuery = RankPointAdjustmentBatch.findOne({ idempotencyKey }).select('_id label createdAt').lean();
    if (session) duplicateQuery = duplicateQuery.session(session);
    const duplicateBatch = await duplicateQuery;

    return {
        metadata,
        rows: resolvedRows,
        stats,
        contentHash: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        idempotencyKey,
        duplicateBatch,
        originalFilename: String(file.originalname || 'bonus-rp.csv').slice(0, 255)
    };
}

function serializePreview(prepared) {
    return {
        metadata: {
            label: prepared.metadata.label,
            reason: prepared.metadata.reason,
            program: prepared.metadata.program,
            expectedHouse: prepared.metadata.expectedHouse,
            effectiveDate: prepared.metadata.effectiveDateKey,
            originalFilename: prepared.originalFilename
        },
        summary: prepared.stats,
        duplicateBatch: prepared.duplicateBatch || null,
        rows: prepared.rows.map((row) => ({
            rowNumber: row.rowNumber,
            email: row.email,
            studentId: row.student,
            studentName: row.studentName,
            house: row.house,
            points: row.points
        }))
    };
}

async function previewAdjustmentBatch(input) {
    return serializePreview(await prepareAdjustmentBatch(input));
}

async function applyAdjustmentBatch({ file, metadata, importedBy }) {
    if (!mongoose.Types.ObjectId.isValid(importedBy)) {
        throw new RankPointAdjustmentError('Importing admin was not found.', 403);
    }

    const session = await mongoose.startSession();
    let batchId;
    try {
        await session.withTransaction(async () => {
            const prepared = await prepareAdjustmentBatch({ file, metadata, session });
            if (prepared.duplicateBatch) {
                throw new RankPointAdjustmentError('This class-date CSV batch has already been applied.', 409, [{
                    batchId: prepared.duplicateBatch._id,
                    label: prepared.duplicateBatch.label
                }]);
            }

            const [batch] = await RankPointAdjustmentBatch.create([{
                ...prepared.metadata,
                effectiveDate: prepared.metadata.effectiveDate,
                originalFilename: prepared.originalFilename,
                contentHash: prepared.contentHash,
                idempotencyKey: prepared.idempotencyKey,
                kind: 'import',
                status: 'applied',
                ...prepared.stats,
                importedBy
            }], { session });

            const adjustments = prepared.rows.map((row) => ({
                student: row.student,
                program: prepared.metadata.program,
                points: row.points,
                effectiveDate: prepared.metadata.effectiveDate,
                reason: prepared.metadata.reason,
                houseSnapshot: prepared.metadata.expectedHouse,
                emailSnapshot: row.email,
                sourceRow: row.rowNumber,
                batch: batch._id,
                kind: 'import',
                createdBy: importedBy
            }));
            await RankPointAdjustment.insertMany(adjustments, { session, ordered: true });
            batchId = batch._id;
        });
    } catch (error) {
        if (error?.code === 11000) {
            throw new RankPointAdjustmentError('This class-date CSV batch has already been applied.', 409);
        }
        throw error;
    } finally {
        await session.endSession();
    }

    return RankPointAdjustmentBatch.findById(batchId)
        .populate('importedBy', 'name email')
        .lean();
}

async function reverseAdjustmentBatch(batchId, adminId) {
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
        throw new RankPointAdjustmentError('Adjustment batch was not found.', 404);
    }

    const session = await mongoose.startSession();
    let reversalBatchId;
    try {
        await session.withTransaction(async () => {
            const batch = await RankPointAdjustmentBatch.findById(batchId).session(session).lean();
            if (!batch || batch.kind !== 'import') {
                throw new RankPointAdjustmentError('Adjustment batch was not found.', 404);
            }
            if (batch.status === 'reversed' || batch.reversalBatch) {
                throw new RankPointAdjustmentError('This adjustment batch has already been reversed.', 409);
            }

            const originalAdjustments = await RankPointAdjustment.find({ batch: batch._id }).session(session).lean();
            if (originalAdjustments.length !== batch.rowCount) {
                throw new RankPointAdjustmentError('The batch ledger is incomplete and cannot be reversed safely.', 409);
            }

            const now = new Date();
            const idempotencyKey = crypto.createHash('sha256').update(`reversal:${batch._id}`).digest('hex');
            const [reversalBatch] = await RankPointAdjustmentBatch.create([{
                label: `Reversal: ${batch.label}`.slice(0, 120),
                reason: `Reversal of ${batch.label}`.slice(0, 240),
                program: batch.program,
                expectedHouse: batch.expectedHouse,
                effectiveDate: now,
                originalFilename: `reversal-${batch.originalFilename}`.slice(0, 255),
                contentHash: batch.contentHash,
                idempotencyKey,
                kind: 'reversal',
                status: 'applied',
                reversesBatch: batch._id,
                rowCount: batch.rowCount,
                positiveCount: batch.negativeCount,
                zeroCount: batch.zeroCount,
                negativeCount: batch.positiveCount,
                totalPoints: roundPoints(-batch.totalPoints),
                importedBy: adminId
            }], { session });

            await RankPointAdjustment.insertMany(originalAdjustments.map((adjustment) => ({
                student: adjustment.student,
                program: adjustment.program,
                points: roundPoints(-adjustment.points),
                effectiveDate: now,
                reason: `Reversal of ${batch.label}`.slice(0, 240),
                houseSnapshot: adjustment.houseSnapshot,
                emailSnapshot: adjustment.emailSnapshot,
                sourceRow: adjustment.sourceRow,
                batch: reversalBatch._id,
                kind: 'reversal',
                reversesAdjustment: adjustment._id,
                createdBy: adminId
            })), { session, ordered: true });

            await RankPointAdjustmentBatch.updateOne(
                { _id: batch._id, status: 'applied' },
                { $set: { status: 'reversed', reversalBatch: reversalBatch._id, reversedBy: adminId, reversedAt: now } },
                { session }
            );
            reversalBatchId = reversalBatch._id;
        });
    } catch (error) {
        if (error?.code === 11000) {
            throw new RankPointAdjustmentError('This adjustment batch has already been reversed.', 409);
        }
        throw error;
    } finally {
        await session.endSession();
    }

    return RankPointAdjustmentBatch.findById(reversalBatchId)
        .populate('importedBy', 'name email')
        .populate('reversesBatch', 'label status')
        .lean();
}

module.exports = {
    MAX_ROWS,
    RankPointAdjustmentError,
    applyAdjustmentBatch,
    previewAdjustmentBatch,
    reverseAdjustmentBatch,
    _private: {
        buildIdempotency,
        buildStats,
        isEligibleOnDate,
        normalizeMetadata,
        parseRankPointCsv,
        roundPoints
    }
};
