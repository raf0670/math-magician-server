const nodemailer = require('nodemailer');

function getBooleanEnv(value) {
    if (typeof value === 'undefined') return undefined;
    return ['1', 'true', 'yes'].includes(value.toString().trim().toLowerCase());
}

function createTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        throw new Error('SMTP email settings are not configured.');
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: getBooleanEnv(process.env.SMTP_SECURE) ?? port === 465,
        auth: {
            user,
            pass
        }
    });
}

function escapeHtml(value) {
    return value
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresInMinutes }) {
    const transporter = createTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const displayName = name || 'there';
    const safeDisplayName = escapeHtml(displayName);
    const safeResetUrl = escapeHtml(resetUrl);

    await transporter.sendMail({
        from,
        to,
        subject: 'Reset your Exam Archive password',
        text: [
            `Hi ${displayName},`,
            '',
            'We received a request to reset your Exam Archive password.',
            `Open this secure link within ${expiresInMinutes} minutes to set a new password:`,
            resetUrl,
            '',
            'If you did not request this, you can ignore this email.'
        ].join('\n'),
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16131f;">
                <p>Hi ${safeDisplayName},</p>
                <p>We received a request to reset your Exam Archive password.</p>
                <p>
                    <a href="${safeResetUrl}" style="display:inline-block;background:#DFB15B;color:#000;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;">
                        Reset password
                    </a>
                </p>
                <p>This link expires in ${expiresInMinutes} minutes.</p>
                <p>If you did not request this, you can ignore this email.</p>
            </div>
        `
    });
}

async function sendPaymentConfirmedEmail({ to, name, planTitle }) {
    const transporter = createTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const displayName = name || 'there';
    const safeDisplayName = escapeHtml(displayName);
    const safePlanTitle = escapeHtml(planTitle || 'your enrollment');

    await transporter.sendMail({
        from,
        to,
        subject: 'Payment confirmed - Exam Archive access unlocked',
        text: [
            `Hi ${displayName},`,
            '',
            'Your payment has been confirmed.',
            `You now have full access to everything included in ${planTitle || 'your Exam Archive enrollment'}.`,
            '',
            'Thank you for enrolling with Exam Archive.'
        ].join('\n'),
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16131f;">
                <p>Hi ${safeDisplayName},</p>
                <p>Your payment has been confirmed.</p>
                <p>You now have full access to everything included in <strong>${safePlanTitle}</strong>.</p>
                <p>Thank you for enrolling with Exam Archive.</p>
            </div>
        `
    });
}

module.exports = {
    sendPasswordResetEmail,
    sendPaymentConfirmedEmail
};
