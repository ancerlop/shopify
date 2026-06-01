import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
      console.error("[form-config] No session found");
      return { fields: [] };
    }

    const numericId = params.productId?.replace(/^gid:\/\/shopify\/Product\//, "");
    const shopifyId = `gid://shopify/Product/${numericId}`;

    console.log(`[form-config] Looking for product: shop=${session.shop} shopifyId=${shopifyId}`);

    const store = await db.store.findUnique({ where: { myshopifyDomain: session.shop } });

    if (!store) {
      console.error(`[form-config] No store found for ${session.shop}`);
      return { fields: [] };
    }

    const product = await db.product.findFirst({
      where: {
        storeId: store.id,
        shopifyId,
      },
      include: {
        fields: { orderBy: { sortOrder: "asc" } },
        pdfConfig: {
          include: { fieldMappings: true },
        },
      },
    });

    if (!product) {
      console.error(`[form-config] No product found for shopifyId=${shopifyId} storeId=${store.id}`);
      return { fields: [] };
    }

    console.log(`[form-config] Found product with ${product.fields.length} fields`);

    const mappings = product.pdfConfig?.fieldMappings || [];

    return {
      fields: product.fields.map((f) => {
        const mapping = mappings.find((m) => m.fieldLabel === f.label);
        
        // Calculate max characters based on maxWidth and fontSize for text fields
        // A rough estimate: average character width is ~0.6 * fontSize
        // If imageHeight is defined, we can calculate lines too, but for simplicity
        // we'll pass the raw limits to the frontend to handle or display.
        
        return {
          label: f.label,
          type: f.type,
          required: f.required,
          sortOrder: f.sortOrder,
          limits: mapping ? {
            maxWidth: mapping.maxWidth,
            imageHeight: mapping.imageHeight,
            fontSize: mapping.fontSize,
          } : null,
        };
      }),
    };
  } catch (err) {
    console.error("[form-config] Error:", err);
    return { fields: [], error: String(err) };
  }
};
