const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const EMAIL_PROVIDERS = {
    RESEND: 'resend',
    SMTP: 'smtp'
};

function getBooleanEnv(value) {
    if (typeof value === 'undefined') return undefined;
    return ['1', 'true', 'yes'].includes(value.toString().trim().toLowerCase());
}

function getEmailProvider() {
    const configuredProvider = process.env.EMAIL_PROVIDER?.toString().trim().toLowerCase();

    if (configuredProvider) {
        return configuredProvider;
    }

    if (process.env.RESEND_API_KEY || process.env.NODE_ENV === 'production') {
        return EMAIL_PROVIDERS.RESEND;
    }

    return EMAIL_PROVIDERS.SMTP;
}

function getFromAddress(provider) {
    const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;

    if (!from) {
        throw new Error(`${provider.toUpperCase()} email sender is not configured.`);
    }

    return from;
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
        connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 8000,
        greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 8000,
        socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 10000,
        auth: {
            user,
            pass
        }
    });
}

function createResendClient() {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
        throw new Error('Resend API key is not configured.');
    }

    return new Resend(apiKey);
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

function getEmailErrorMessage(error) {
    if (!error) return 'Unknown email error';
    if (typeof error === 'string') return error;
    return error.message || error.name || 'Unknown email error';
}

async function sendEmail({ to, subject, text, html }) {
    const provider = getEmailProvider();
    const from = getFromAddress(provider);

    try {
        if (provider === EMAIL_PROVIDERS.RESEND) {
            const resend = createResendClient();
            const result = await resend.emails.send({ from, to, subject, text, html });

            if (result.error) {
                throw new Error(getEmailErrorMessage(result.error));
            }

            return result.data;
        }

        if (provider === EMAIL_PROVIDERS.SMTP) {
            const transporter = createTransporter();
            return transporter.sendMail({ from, to, subject, text, html });
        }

        throw new Error(`Unsupported email provider: ${provider}`);
    } catch (error) {
        console.error(`Email send failed via ${provider}: ${getEmailErrorMessage(error)}`);
        throw error;
    }
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresInMinutes }) {
    const displayName = name || 'there';
    const safeDisplayName = escapeHtml(displayName);
    const safeResetUrl = escapeHtml(resetUrl);

    await sendEmail({
        to,
        subject: 'Reset your Magician\'s School password',
        text: [
            `Hi ${displayName},`,
            '',
            'We received a request to reset your Magician\'s School password.',
            `Open this secure link within ${expiresInMinutes} minutes to set a new password:`,
            resetUrl,
            '',
            'If you did not request this, you can ignore this email.'
        ].join('\n'),
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16131f;">
                <p>Hi ${safeDisplayName},</p>
                <p>We received a request to reset your Magician&#039;s School password.</p>
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
    const displayName = name || 'there';
    const safeDisplayName = escapeHtml(displayName);
    const safePlanTitle = escapeHtml(planTitle || 'your enrollment');

    await sendEmail({
        to,
        subject: 'Payment confirmed - Magician\'s School access unlocked',
        text: [
            `Hi ${displayName},`,
            '',
            'Your payment has been confirmed.',
            `You now have full access to everything included in ${planTitle || 'your Magician\'s School enrollment'}.`,
            '',
            'Thank you for enrolling with Magician\'s School.'
        ].join('\n'),
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#16131f;">
                <p>Hi ${safeDisplayName},</p>
                <p>Your payment has been confirmed.</p>
                <p>You now have full access to everything included in <strong>${safePlanTitle}</strong>.</p>
                <p>Thank you for enrolling with Magician&#039;s School.</p>
            </div>
        `
    });
}

module.exports = {
    sendPasswordResetEmail,
    sendPaymentConfirmedEmail
};
