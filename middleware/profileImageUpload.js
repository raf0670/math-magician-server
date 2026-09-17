const multer = require('multer');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function getMaxBytes() {
    const configured = Number(process.env.PROFILE_IMAGE_MAX_BYTES);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

function getAllowedMimeTypes() {
    const configured = process.env.PROFILE_IMAGE_ALLOWED_MIME_TYPES
        ?.split(',')
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean);

    return new Set(configured?.length ? configured : DEFAULT_ALLOWED_MIME_TYPES);
}

function detectImageMimeType(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;

    if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer.subarray(1, 4).toString('ascii') === 'PNG'
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
    ) {
        return 'image/png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }

    if (
        buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }

    return null;
}

function createUploadMiddleware() {
    return multer({
        storage: multer.memoryStorage(),
        limits: {
            files: 1,
            fileSize: getMaxBytes()
        },
        fileFilter: (req, file, callback) => {
            if (!getAllowedMimeTypes().has(file.mimetype.toLowerCase())) {
                return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
            }

            return callback(null, true);
        }
    }).single('image');
}

function handleProfileImageUpload(req, res, next) {
    createUploadMiddleware()(req, res, (error) => {
        if (!error) return next();

        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                message: `Profile image must be ${Math.round(getMaxBytes() / (1024 * 1024))} MB or smaller.`
            });
        }

        return res.status(400).json({
            success: false,
            message: 'Upload one JPG, PNG, or WebP image in the image field.'
        });
    });
}

module.exports = {
    detectImageMimeType,
    getAllowedMimeTypes,
    getMaxBytes,
    handleProfileImageUpload
};
