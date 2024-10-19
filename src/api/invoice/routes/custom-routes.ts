export default {
    routes: [
      {
        method: 'POST',
        path: '/invoices/create-invoice',
        handler: 'api::invoice.invoice.createCustomInvoice',
      },
      {
        method: 'POST',
        path: '/invoices/webhook',
        handler: 'api::invoice.invoice.xenditWebhook',
      },
      {
        method: 'GET',
        path: '/invoices/pdf',
        handler: 'api::invoice.invoice.generateInvoicePDF',
      }      
    ],
  };
  