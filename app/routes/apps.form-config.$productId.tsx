import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return { fields: [] };
  }

  const product = await db.product.findUnique({
    where: { id: params.productId },
    include: {
      store: true,
      fields: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!product) {
    return { fields: [] };
  }

  return {
    fields: product.fields.map((f) => ({
      label: f.label,
      type: f.type,
      required: f.required,
      sortOrder: f.sortOrder,
    })),
  };
};
