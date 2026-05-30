import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generatePDF } from "../utils/pdf.server";
import { sendPDFEmail } from "../utils/email.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

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

  const customerEmail = order.email || order.customer?.email;
  if (!customerEmail) {
    return new Response("No customer email", { status: 200 });
  }

  const store = await db.store.findUnique({ where: { myshopifyDomain: shop } });
  if (!store) {
    return new Response("Store not found", { status: 200 });
  }

  const settings = await db.storeSettings.findUnique({ where: { storeId: store.id } });

  for (const item of order.line_items || []) {
    if (!item.properties || item.properties.length === 0) continue;

    const product = await db.product.findFirst({
      where: { storeId: store.id, shopifyId: String(item.product_id) },
      include: { fields: true },
    });

    if (!product) continue;

    const fields = item.properties.map((p) => ({
      label: p.name,
      value: p.value,
    }));

    const imageField = fields.find((f) => f.value.startsWith("data:") || f.value.startsWith("http"));
    const pdfBuffer = await generatePDF(
      { fields, imageUrl: imageField?.value },
      settings?.pdfTemplate || undefined
    );

    let emailSent = false;
    try {
      await sendPDFEmail({
        to: customerEmail,
        subject: settings?.emailSubject || "Tu escape room personalizado está listo",
        html: settings?.emailBody || "<p>Gracias por tu compra. Adjunto encontrarás tu escape room personalizado.</p>",
        pdfBuffer,
        pdfFilename: `escape-room-${order.id}.pdf`,
      });
      emailSent = true;
    } catch (err) {
      console.error(`[webhook] Failed to send email for order ${order.id}:`, err);
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
  }

  return new Response();
};
