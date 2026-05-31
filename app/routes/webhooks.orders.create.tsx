import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generatePDF } from "../utils/pdf.server";
import { sendPDFEmail } from "../utils/email.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, payload } = await authenticate.webhook(request);
    console.log(`[orders-webhook] Received orders/create webhook for shop: ${shop}`);

    const order = payload as {
      id: number;
      email?: string;
      line_items?: {
        id: number;
        product_id: number;
        title: string;
        properties?: { name: string; value: string }[];
      }[];
      customer?: { email?: string };
    };

    console.log(`[orders-webhook] Order ID: ${order.id}, customer email: ${order.email || order.customer?.email}`);
    console.log(`[orders-webhook] Line items count: ${order.line_items?.length || 0}`);

    const customerEmail = order.email || order.customer?.email;
    if (!customerEmail) {
      console.warn(`[orders-webhook] No customer email found in order ${order.id}`);
      return new Response("No customer email", { status: 200 });
    }

    const store = await db.store.findUnique({ where: { myshopifyDomain: shop } });
    if (!store) {
      console.error(`[orders-webhook] Store not found in database for domain: ${shop}`);
      return new Response("Store not found", { status: 200 });
    }

    const settings = await db.storeSettings.findUnique({ where: { storeId: store.id } });
    console.log(`[orders-webhook] Settings found: ${!!settings}. From email: ${settings?.emailFrom || "default"}`);

    for (const item of order.line_items || []) {
      console.log(`[orders-webhook] Processing item: "${item.title}" (Product ID: ${item.product_id})`);
      console.log(`[orders-webhook] Item properties: ${JSON.stringify(item.properties || [])}`);

      if (!item.properties || item.properties.length === 0) {
        console.log(`[orders-webhook] Skip: Item has no line item properties`);
        continue;
      }

      const numericId = String(item.product_id).replace(/^gid:\/\/shopify\/Product\//, "");
      const shopifyId = `gid://shopify/Product/${numericId}`;

      const product = await db.product.findFirst({
        where: {
          storeId: store.id,
          shopifyId: {
            in: [shopifyId, numericId]
          }
        },
        include: { fields: true },
      });

      if (!product) {
        console.warn(`[orders-webhook] Skip: Product with shopifyId=${item.product_id} is not configured in PDForge`);
        continue;
      }

      console.log(`[orders-webhook] Match found! Configured product ID: ${product.id} (fields: ${product.fields.length})`);

      const fields = item.properties.map((p) => ({
        label: p.name,
        value: p.value,
      }));

      const imageField = fields.find((f) => f.value.startsWith("https://") || f.value.startsWith("/uploads/"));
      console.log(`[orders-webhook] Generating PDF. Custom image value: ${imageField?.value || "None"}`);

      const pdfBuffer = await generatePDF(
        { fields, imageUrl: imageField?.value },
        settings?.pdfTemplate || undefined
      );

      let emailSent = false;
      try {
        console.log(`[orders-webhook] Sending email to: ${customerEmail}`);
        await sendPDFEmail({
          to: customerEmail,
          from: settings?.emailFrom || undefined,
          subject: settings?.emailSubject || "Tu escape room personalizado está listo",
          html: settings?.emailBody || "<p>Gracias por tu compra. Adjunto encontrarás tu escape room personalizado.</p>",
          pdfBuffer,
          pdfFilename: `escape-room-${order.id}.pdf`,
        });
        emailSent = true;
        console.log(`[orders-webhook] Email sent successfully to ${customerEmail}`);
      } catch (err) {
        console.error(`[orders-webhook] Failed to send email for order ${order.id}:`, err);
      }

      await db.order.upsert({
        where: { shopifyOrderId: String(order.id) },
        update: { emailSent, pdfUrl: null },
        create: {
          shopifyOrderId: String(order.id),
          storeId: store.id,
          pdfUrl: null,
          emailSent,
        },
      });
      console.log(`[orders-webhook] Order status recorded in DB (emailSent: ${emailSent})`);
    }

    return new Response();
  } catch (err: any) {
    console.error("[orders-webhook] Error in webhook runner:", err);
    return new Response("Webhook processing error: " + err.message, { status: 500 });
  }
};
