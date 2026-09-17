const path = require('path');
const axios = require('axios');

const DEFAULT_UPLOAD_URL = 'https://api.imgbb.com/1/upload';
const UPLOAD_TIMEOUT_MS = 30000;

function sanitizeImageName(filename = 'profile-image') {
    const extension = path.extname(filename);
    const baseName = path.basename(filename, extension);
    return baseName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'profile-image';
}

async function uploadImageToImgBB({ buffer, filename }) {
    const apiKey = process.env.IMGBB_API_KEY?.trim();
    if (!apiKey) {
        const error = new Error('Profile image uploads are not configured.');
        error.statusCode = 503;
        throw error;
    }

    const uploadUrl = process.env.IMGBB_UPLOAD_URL?.trim() || DEFAULT_UPLOAD_URL;
    const body = new URLSearchParams();
    body.set('image', buffer.toString('base64'));
    body.set('name', sanitizeImageName(filename));

    try {
        const response = await axios.post(uploadUrl, body, {
            params: { key: apiKey },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            maxBodyLength: Infinity,
            timeout: UPLOAD_TIMEOUT_MS
        });
        const image = response.data?.data;
        const imageUrl = image?.display_url || image?.url;

        if (!response.data?.success || !imageUrl) {
            throw new Error('ImgBB returned an invalid upload response.');
        }

        return {
            url: imageUrl,
            thumbUrl: image.thumb?.url || image.medium?.url || imageUrl,
            provider: 'imgbb',
            providerId: image.id || '',
            deleteUrl: image.delete_url || '',
            uploadedAt: new Date()
        };
    } catch (error) {
        if (error.statusCode) throw error;

        const uploadError = new Error('Unable to upload the profile image right now.');
        uploadError.statusCode = 502;
        uploadError.cause = error;
        throw uploadError;
    }
}

module.exports = { sanitizeImageName, uploadImageToImgBB };
