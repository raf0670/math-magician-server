const axios = require('axios');

function getBkashConfig() {
    const requiredKeys = [
        'BKASH_BASE_URL',
        'BKASH_APP_KEY',
        'BKASH_APP_SECRET',
        'BKASH_USERNAME',
        'BKASH_PASSWORD',
        'BKASH_CALLBACK_URL'
    ];

    const missing = requiredKeys.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing bKash environment values: ${missing.join(', ')}`);
    }

    return {
        baseURL: process.env.BKASH_BASE_URL.replace(/\/$/, ''),
        appKey: process.env.BKASH_APP_KEY,
        appSecret: process.env.BKASH_APP_SECRET,
        username: process.env.BKASH_USERNAME,
        password: process.env.BKASH_PASSWORD,
        callbackURL: process.env.BKASH_CALLBACK_URL
    };
}

async function grantToken() {
    const config = getBkashConfig();
    const response = await axios.post(`${config.baseURL}/token/grant`, {
        app_key: config.appKey,
        app_secret: config.appSecret
    }, {
        headers: {
            username: config.username,
            password: config.password,
            'Content-Type': 'application/json'
        }
    });

    const token = response.data?.id_token;
    if (!token) {
        throw new Error('bKash did not return an id_token.');
    }

    return token;
}

function authHeaders(token) {
    const config = getBkashConfig();
    return {
        authorization: token,
        'x-app-key': config.appKey,
        'Content-Type': 'application/json'
    };
}

async function createPayment({ amount, merchantInvoiceNumber, payerReference }) {
    const config = getBkashConfig();
    const token = await grantToken();
    const response = await axios.post(`${config.baseURL}/create`, {
        mode: '0011',
        payerReference,
        callbackURL: config.callbackURL,
        amount: amount.toString(),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber
    }, {
        headers: authHeaders(token)
    });

    return response.data;
}

async function executePayment(paymentID) {
    const config = getBkashConfig();
    const token = await grantToken();
    const response = await axios.post(`${config.baseURL}/execute`, {
        paymentID
    }, {
        headers: authHeaders(token)
    });

    return response.data;
}

async function queryPayment(paymentID) {
    const config = getBkashConfig();
    const token = await grantToken();
    const response = await axios.post(`${config.baseURL}/payment/status`, {
        paymentID
    }, {
        headers: authHeaders(token)
    });

    return response.data;
}

module.exports = {
    createPayment,
    executePayment,
    queryPayment
};