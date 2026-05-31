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
  const jsonRes = await shopifyRes.json();
  console.log("shopifyProducts query response:", JSON.stringify(jsonRes));
  const shopifyProducts = jsonRes.data?.products?.nodes || [];

  return { store, products, shopifyProducts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = form.get("intent");
    console.log(`[index-action] Intent received: ${intent}, shop: ${session.shop}`);

    if (intent === "add-product") {
      const shopifyId = form.get("shopifyId") as string;
      console.log(`[index-action] Adding product shopifyId: ${shopifyId}`);
      if (!shopifyId) {
        console.warn("[index-action] shopifyId is empty!");
        return { error: "No product selected" };
      }

      const store = await db.store.findUnique({ where: { myshopifyDomain: session.shop } });
      if (!store) {
        console.error(`[index-action] Store not found for ${session.shop}`);
        return { error: "Store not found" };
      }

      const newProduct = await db.product.create({
        data: { storeId: store.id, shopifyId },
      });
      console.log(`[index-action] Product successfully created: ${JSON.stringify(newProduct)}`);
    }

    if (intent === "remove-product") {
      const productId = form.get("productId") as string;
      console.log(`[index-action] Removing product database ID: ${productId}`);
      await db.formField.deleteMany({ where: { productId } });
      await db.product.delete({ where: { id: productId } });
      console.log(`[index-action] Product successfully deleted`);
    }

    return { ok: true };
  } catch (error: any) {
    console.error("[index-action] Error in action:", error);
    return { error: error.message || String(error) };
  }
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

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
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Producto</th>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Campos</th>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p: any) => {
                const sp = data.shopifyProducts.find((sp: any) => sp.id === p.shopifyId);
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                    <td style={{ padding: "12px", fontSize: "14px" }}>
                      <s-link href={`/app/products/${p.id}`}>
                        {sp?.title || `Producto #${p.shopifyId}`}
                      </s-link>
                    </td>
                    <td style={{ padding: "12px", fontSize: "14px", color: "#6d7175" }}>
                      {p.fields.length} campos
                    </td>
                    <td style={{ padding: "12px" }}>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="remove-product" />
                        <input type="hidden" name="productId" value={p.id} />
                        <button
                          type="submit"
                          style={{
                            padding: "6px 12px",
                            fontSize: "13px",
                            fontWeight: "500",
                            borderRadius: "4px",
                            border: "1px solid #babfc3",
                            backgroundColor: "#ffffff",
                            color: "#d72c0d",
                            cursor: "pointer",
                            boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                          }}
                        >
                          Eliminar
                        </button>
                      </fetcher.Form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Añadir producto">
        {data.shopifyProducts.length === 0 ? (
          <s-paragraph>
            No se encontraron productos en tu tienda. Ve a{" "}
            <s-link href="https://ancerlop.myshopify.com/admin/products" target="_blank">
              Productos en tu panel de Shopify
            </s-link>{" "}
            para crear uno primero.
          </s-paragraph>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="add-product" />
            <s-stack direction="inline" alignment="end" gap="base">
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "13px", fontWeight: "500", color: "#202223" }}>
                  Seleccionar producto
                </label>
                <select
                  name="shopifyId"
                  required
                  style={{
                    padding: "6px 12px",
                    fontSize: "14px",
                    borderRadius: "6px",
                    border: "1px solid #babfc3",
                    backgroundColor: "#ffffff",
                    minWidth: "280px",
                    height: "36px",
                    color: "#202223",
                    boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                  }}
                >
                  <option value="">-- Seleccionar --</option>
                  {data.shopifyProducts
                    .filter((sp: any) => !configuredIds.has(sp.id))
                    .map((sp: any) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.title}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="submit"
                style={{
                  padding: "0 16px",
                  fontSize: "14px",
                  fontWeight: "500",
                  borderRadius: "6px",
                  border: "1px solid #babfc3",
                  backgroundColor: "#008060",
                  color: "#ffffff",
                  cursor: "pointer",
                  height: "36px",
                  boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                }}
              >
                Añadir
              </button>
            </s-stack>
          </fetcher.Form>
        )}
      </s-section>
    </s-page>
  );
}
