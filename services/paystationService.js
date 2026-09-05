const axios = require('axios');

const ENVIRONMENTS = {
    sandbox: {
        baseUrlKey: 'PAYSTATION_SANDBOX_BASE_URL',
        storeIdKey: 'PAYSTATION_SANDBOX_STORE_ID',
        passwordKey: 'PAYSTATION_SANDBOX_PASSWORD'
    },
    live: {
        baseUrlKey: 'PAYSTATION_LIVE_BASE_URL',
        storeIdKey: 'PAYSTATION_LIVE_STORE_ID',
        passwordKey: 'PAYSTATION_LIVE_PASSWORD'
    }
};

function clean(value) {
    return value?.toString().trim() || '';
}

function getBooleanFlag(value) {
    return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase()) ? 1 : 0;
}

function getPaystationEnvironment() {
    const env = clean(process.env.PAYSTATION_ENV).toLowerCase();
    return env === 'live' || env === 'production' ? 'live' : 'sandbox';
}

function getPaystationConfig() {
    const environment = getPaystationEnvironment();
    const envConfig = ENVIRONMENTS[environment];
    const requiredKeys = [
        envConfig.baseUrlKey,
        envConfig.storeIdKey,
        envConfig.passwordKey,
        'PAYSTATION_CALLBACK_URL'
    ];
    const missing = requiredKeys.filter((key) => !clean(process.env[key]));

    if (missing.length) {
        throw new Error(`Missing PayStation environment values: ${missing.join(', ')}`);
    }

    return {
        environment,
        baseURL: clean(process.env[envConfig.baseUrlKey]).replace(/\/$/, ''),
        storeId: clean(process.env[envConfig.storeIdKey]),
        password: clean(process.env[envConfig.passwordKey]),
        callbackURL: clean(process.env.PAYSTATION_CALLBACK_URL),
        payWithCharge: getBooleanFlag(process.env.PAYSTATION_PAY_WITH_CHARGE),
        emi: getBooleanFlag(process.env.PAYSTATION_EMI)
    };
}

function buildFormBody(payload) {
    const form = new URLSearchParams();

    Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        form.set(key, value.toString());
    });

    return form;
}

function normalizeCheckoutItems(checkoutItems) {
    if (!checkoutItems) return '';
    return typeof checkoutItems === 'string' ? checkoutItems : JSON.stringify(checkoutItems);
}

function getPaystationStatusKind(payload = {}) {
    const transactionPayload = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? { ...payload, ...payload.data }
        : payload;
    const statusText = clean(
        transactionPayload.trx_status
        || transactionPayload.payment_status
        || transactionPayload.transaction_status
        || transactionPayload.status_name
        || transactionPayload.status
    ).toLowerCase();

    if (['success', 'successful', 'paid', 'completed', 'complete'].includes(statusText)) return 'success';
    if (['processing', 'pending', 'initiated'].includes(statusText)) return 'processing';
    if (['cancel', 'cancelled', 'canceled'].includes(statusText)) return 'cancelled';
    if (['refund', 'refunded'].includes(statusText)) return 'refund';
    if (['failed', 'fail', 'failure', 'declined', 'invalid'].includes(statusText)) return 'failed';

    return 'unknown';
}

function getTransactionId(payload = {}) {
    const transactionPayload = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? { ...payload, ...payload.data }
        : payload;

    return clean(
        transactionPayload.trxId
        || transactionPayload.trx_id
        || transactionPayload.transaction_id
        || transactionPayload.transactionId
        || transactionPayload.paystation_trx_id
        || transactionPayload.payment_reference
        || transactionPayload.reference_id
    );
}

async function initiatePayment({
    invoiceNumber,
    amount,
    customer,
    reference = '',
    checkoutItems = ''
}, httpClient = axios) {
    const config = getPaystationConfig();
    const body = buildFormBody({
        merchantId: config.storeId,
        password: config.password,
        invoice_number: invoiceNumber,
        currency: 'BDT',
        payment_amount: Math.round(Number(amount || 0)),
        pay_with_charge: config.payWithCharge,
        reference,
        cust_name: customer.name,
        cust_phone: customer.phone,
        cust_email: customer.email,
        cust_address: customer.address,
        callback_url: config.callbackURL,
        checkout_items: normalizeCheckoutItems(checkoutItems),
        ...(config.emi ? { emi: config.emi } : {})
    });

    const response = await httpClient.post(`${config.baseURL}/initiate-payment`, body, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    return response.data;
}

async function queryTransactionStatus({ invoiceNumber, trxId }, httpClient = axios) {
    const config = getPaystationConfig();
    const transactionId = clean(trxId);

    if (transactionId) {
        const response = await httpClient.post(`${config.baseURL}/v2/transaction-status`, {
            trxId: transactionId
        }, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                merchantId: config.storeId
            }
        });

        return response.data;
    }

    const body = buildFormBody({
        invoice_number: invoiceNumber
    });
    const response = await httpClient.post(`${config.baseURL}/transaction-status`, body, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            merchantId: config.storeId
        }
    });

    return response.data;
}

module.exports = {
    getPaystationConfig,
    getPaystationStatusKind,
    getTransactionId,
    initiatePayment,
    queryTransactionStatus,
    _private: {
        buildFormBody,
        getBooleanFlag,
        getPaystationEnvironment,
        normalizeCheckoutItems
    }
};
