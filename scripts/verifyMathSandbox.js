// Creates one sandbox checkout link; never charges money or writes local database records.
require('dotenv').config({ quiet: true });
process.env.PAYSTATION_ENV = 'sandbox';
const { initiatePayment, getPaystationConfig } = require('../services/paystationService');

async function main() {
    const config = getPaystationConfig();
    if (new URL(config.baseURL).hostname !== 'sandbox.paystation.com.bd') throw new Error('Refusing a non-sandbox endpoint');
    const result = await initiatePayment({
        invoiceNumber: `MATH-DECIMAL-TEST-${Date.now()}`, amount: 59.99,
        customer: { name: 'Math integration test', phone: '01700000000', email: 'math-test@example.com', address: 'Test' },
        reference: 'Sandbox decimal verification', checkoutItems: { test: true }
    });
    console.log(JSON.stringify({ status: result.status, code: result.status_code, returnedAmount: result.payment_amount, message: result.message }));
    if (result.status !== 'success' || Number(result.payment_amount) !== 59.99) process.exitCode = 1;
}
main().catch(error => { console.error(error.code || error.message || 'Sandbox request failed'); process.exitCode = 1; });
