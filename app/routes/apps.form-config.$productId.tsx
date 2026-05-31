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
      },
    });

    if (!product) {
      console.error(`[form-config] No product found for shopifyId=${shopifyId} storeId=${store.id}`);
      const allProducts = await db.product.findMany({ where: { storeId: store.id } });
      console.log(`[form-config] Products in DB: ${JSON.stringify(allProducts.map(p => p.shopifyId))}`);
      return { fields: [] };
    }

    console.log(`[form-config] Found product with ${product.fields.length} fields`);

    return {
      fields: product.fields.map((f) => ({
        label: f.label,
        type: f.type,
        required: f.required,
        sortOrder: f.sortOrder,
      })),
    };
  } catch (err) {
    console.error("[form-config] Error:", err);
    return { fields: [], error: String(err) };
  }
};
