const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../middleware/auth');

test('any-paid-course access accepts admins and active general, partial, math, or dual students', () => {
    assert.equal(_private.canAccessAnyPaidCourse({ role: 'admin' }), true);
    assert.equal(_private.canAccessAnyPaidCourse({ role: 'student', hasClassAccess: true, paymentStatus: 'partiallyPaid' }), true);
    assert.equal(_private.canAccessAnyPaidCourse({ role: 'student', hasMathAccess: true }), true);
    assert.equal(_private.canAccessAnyPaidCourse({ role: 'student', hasClassAccess: true, hasMathAccess: true }), true);
});

test('any-paid-course access rejects unpaid and general-only suspended students', () => {
    assert.equal(_private.canAccessAnyPaidCourse({ role: 'student' }), false);
    assert.equal(_private.canAccessAnyPaidCourse({ role: 'student', hasClassAccess: true, generalAccessSuspended: true }), false);
});

test('active math access still allows a student whose general access is suspended', () => {
    assert.equal(_private.canAccessAnyPaidCourse({
        role: 'student',
        hasClassAccess: true,
        generalAccessSuspended: true,
        hasMathAccess: true
    }), true);
});
