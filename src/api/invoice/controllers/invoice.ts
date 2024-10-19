/**
 * invoice controller
 */

import { factories, Strapi } from "@strapi/strapi";
import { Context } from "koa";
import { Invoice } from "xendit-node";
import puppeteer from "puppeteer";

const invoice = new Invoice({
  secretKey: process.env.XENDIT_SECRET_KEY,
});

async function generateInvoiceNumber(strapi: Strapi): Promise<string> {
  const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");

  // Find the last invoice created this month by checking if externalId starts with 'INV-YYYYMM'
  const lastInvoice = await strapi.db.query("api::invoice.invoice").findOne({
    where: {
      externalId: { $startsWith: `INV-${yearMonth}` }, // Use $startsWith to find invoices starting with 'INV-YYYYMM'
    },
    orderBy: { createdAt: "desc" }, // Order by creation date, descending
  });

  // Increment the invoice number or start from 1
  const newNumber = lastInvoice
    ? parseInt(lastInvoice.externalId.split("-")[2]) + 1
    : 1;

  return `INV-${yearMonth}-${newNumber.toString().padStart(5, "0")}`;
}

export default factories.createCoreController(
  "api::invoice.invoice",
  ({ strapi }) => ({
    async createCustomInvoice(ctx: Context) {
      try {
        const { amount, products } = ctx.request.body;
        const user = ctx.state.user;
        const externalId = await generateInvoiceNumber(strapi);
        const xenditInvoice = await invoice.createInvoice({
          data: {
            externalId: externalId,
            amount,
            payerEmail: user.email,
            successRedirectUrl:
              "https://www.youtube.com/watch?v=jCLjj0okGKY&t=1295s",
            shouldSendEmail: true,
          },
        });

        const strapiInvoice = await strapi
          .service("api::invoice.invoice")
          .create({
            data: {
              externalId,
              paymentAmount: amount,
              paymentStatus: "PENDING",
              user: user.id,
            },
          });

        if (products && Array.isArray(products)) {
          for (const product of products) {
            const { productId, quantity, price } = product; // Assuming the client sends productId, quantity, and price

            // Create InvoiceItem for each product
            await strapi.service("api::invoice-item.invoice-item").create({
              data: {
                quantity,
                price,
                subtotal: price * quantity,
                invoice: strapiInvoice.id,
                product: productId,
              },
            });
          }
        }

        ctx.send({
          message: "Invoice created successfully",
          strapiInvoice,
          xenditInvoice,
        });
      } catch (error) {
        console.error("Error creating invoice:", error);
        ctx.throw(500, "Internal Server Error");
      }
    },
    async xenditWebhook(ctx: Context) {
      try {
        // Check if the received token matches the callback verification token
        const receivedToken = ctx.request.headers["x-callback-token"];
        if (!receivedToken) {
          return ctx.send(
            {
              message: "Unauthorized! Missing callback token.",
            },
            401
          );
        }

        const callbackToken = process.env.XENDIT_CALLBACK_VERIFICATION_TOKEN;
        if (receivedToken !== callbackToken) {
          return ctx.send(
            {
              message: "Callback token doesn't match.",
            },
            400
          );
        }

        // Extract data from the request body
        const { external_id, status } = ctx.request.body;

        // Find the invoice by external_id
        const invoice = await strapi.service("api::invoice.invoice").find({
          filters: { externalId: external_id },
        });

        if (!invoice || invoice.results.length === 0) {
          return ctx.send(
            {
              message: "Invoice not found.",
            },
            404
          );
        }

        const invoiceId = invoice.results[0].id;

        // Update the invoice status
        const updatedInvoice = await strapi
          .service("api::invoice.invoice")
          .update(invoiceId, {
            data: {
              paymentStatus: status,
            },
          });

        // Return success response
        ctx.send({
          message: "Webhook received and invoice updated successfully",
          updatedInvoice,
        });
      } catch (error) {
        console.error("Error processing Xendit webhook:", error);
        ctx.throw(500, "Internal Server Error");
      }
    },
    async generateInvoicePDF(ctx) {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      const htmlContent = `
    <!DOCTYPE html>
  <html>
    <head>
      <title>PDF Example</title>
      <style>
        body { font-family: Arial, sans-serif; }
        h1 { color: blue; }
        p { font-size: 16px; }
      </style>
    </head>
    <body>
      <h1>Hello, PDF!</h1>
      <p>This PDF is generated from HTML using Puppeteer and Koa.</p>
    </body>
  </html>
`;
      try {
        await page.setContent(htmlContent);

        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
        });

        await browser.close();

        ctx.set("Content-Type", "application/pdf");
        ctx.set("Content-Disposition", 'attachment; filename="example.pdf"');
        ctx.set("Content-Length", pdfBuffer.length);

        // Send the PDF as the response body
        ctx.body = pdfBuffer;
      } catch (error) {
        console.error("Error generating invoice PDF:", error);
        ctx.throw(500, "Internal Server Error");
      } finally {
        await browser.close();
      }
    },
    async find(ctx: Context) {
      try {
        const user = ctx.state.user;
        const data = await strapi.db.query("api::invoice.invoice").findMany({
          where: {
            user: {
              id: user.id,
            },
          },
          orderBy: { createdAt: "desc" }, // Order by creation date, descending
        });

        ctx.send(data);
      } catch (error) {
        ctx.throw(500, "Internal Server Error");
      }
    },
    async findOne(ctx: Context) {
      try {
        const user = ctx.state.user;
        const { id } = ctx.params;
        const data = await strapi.service("api::invoice.invoice").findOne(id, {
          populate: ["user", "invoiceItems", "invoiceItems.product"], // Populate related invoiceItems
        });

        ctx.send(data);
      } catch (error) {
        ctx.throw(500, "Internal Server Error");
      }
    },
  })
);
