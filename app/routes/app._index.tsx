import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useEffect, useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let store = await db.store.findUnique({ where: { myshopifyDomain: shop } });
  if (!store) {
    store = await db.store.create({
      data: { myshopifyDomain: shop, accessToken: session.accessToken || "" },
    });
  }

  const products = await db.product.findMany({
    where: { storeId: store.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });

  const { admin } = await authenticate.admin(request);
  const shopifyRes = await admin.graphql(`{
    products(first: 50) {
      nodes { id title handle }
    }
  }`);
  const { data } = await shopifyRes.json();
  const shopifyProducts = data?.products?.nodes || [];

  return { store, products, shopifyProducts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add-product") {
    const shopifyId = form.get("shopifyId") as string;
    const store = await db.store.findUnique({ where: { myshopifyDomain: session.shop } });
    if (!store) return { error: "Store not found" };

    await db.product.create({
      data: { storeId: store.id, shopifyId },
    });
  }

  if (intent === "remove-product") {
    const productId = form.get("productId") as string;
    await db.formField.deleteMany({ where: { productId } });
    await db.product.delete({ where: { id: productId } });
  }

  return { ok: true };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [selected, setSelected] = useState("");

  const configuredIds = new Set(data.products.map((p) => p.shopifyId));

  useEffect(() => {
    if (fetcher.data && !("error" in fetcher.data)) {
      shopify.toast.show("Producto actualizado");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Escape Room Personalizador">
      <s-section heading="Productos configurados">
        {data.products.length === 0 ? (
          <s-paragraph>Aún no has configurado ningún producto.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header>
              <s-table-row>
                <s-table-cell>Producto</s-table-cell>
                <s-table-cell>Campos</s-table-cell>
                <s-table-cell>Acción</s-table-cell>
              </s-table-row>
            </s-table-header>
            {data.products.map((p: any) => {
              const sp = data.shopifyProducts.find((sp: any) => sp.id === p.shopifyId);
              return (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-link href={`/app/products/${p.id}`}>
                      {sp?.title || `Producto #${p.shopifyId}`}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{p.fields.length} campos</s-table-cell>
                  <s-table-cell>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove-product" />
                      <input type="hidden" name="productId" value={p.id} />
                      <s-button variant="tertiary" tone="critical">
                        Eliminar
                      </s-button>
                    </fetcher.Form>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table>
        )}
      </s-section>

      <s-section heading="Añadir producto">
        <s-stack direction="inline" gap="base">
          <s-select
            label="Seleccionar producto"
            value={selected}
            onChange={(e: any) => setSelected(e.target.value)}
          >
            <option value="">-- Seleccionar --</option>
            {data.shopifyProducts
              .filter((sp: any) => !configuredIds.has(sp.id))
              .map((sp: any) => (
                <option key={sp.id} value={sp.id}>
                  {sp.title}
                </option>
              ))}
          </s-select>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="add-product" />
            <input type="hidden" name="shopifyId" value={selected} />
            <s-button disabled={!selected}>Añadir</s-button>
          </fetcher.Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}
