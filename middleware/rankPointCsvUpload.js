const path = require('path');
const multer = require('multer');

const MAX_CSV_BYTES = 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/octet-stream'
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: MAX_CSV_BYTES
    },
    fileFilter(req, file, callback) {
        const extension = path.extname(file.originalname || '').toLowerCase();
        const mimeType = (file.mimetype || '').toLowerCase();
        if (extension !== '.csv' || !ALLOWED_MIME_TYPES.has(mimeType)) {
            return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
        }
        return callback(null, true);
    }
}).single('file');

function handleRankPointCsvUpload(req, res, next) {
    upload(req, res, (error) => {
        if (!error) return next();

        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'CSV files must be 1 MB or smaller.' });
        }

        return res.status(400).json({
            success: false,
            message: 'Upload one CSV file in the file field.'
        });
    });
}

module.exports = {
    MAX_CSV_BYTES,
    handleRankPointCsvUpload
};
