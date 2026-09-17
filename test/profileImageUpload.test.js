const test = require('node:test');
const assert = require('node:assert/strict');
const { detectImageMimeType } = require('../middleware/profileImageUpload');
const { sanitizeImageName } = require('../services/imgbbService');

test('detectImageMimeType recognizes supported image signatures', () => {
    assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
    assert.equal(detectImageMimeType(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
});

test('detectImageMimeType rejects files without a supported signature', () => {
    assert.equal(detectImageMimeType(Buffer.from('<script>alert(1)</script>')), null);
    assert.equal(detectImageMimeType(null), null);
});

test('sanitizeImageName creates an ImgBB-safe base name', () => {
    assert.equal(sanitizeImageName('My profile photo (final).png'), 'My-profile-photo-final');
    assert.equal(sanitizeImageName('***.jpg'), 'profile-image');
});
