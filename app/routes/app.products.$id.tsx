import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useEffect } from "react";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const product = await db.product.findUnique({
    where: { id: params.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product) throw new Response("Not found", { status: 404 });

  const store = await db.store.findUnique({ where: { id: product.storeId } });
  if (!store || store.myshopifyDomain !== session.shop) {
    throw new Response("Forbidden", { status: 403 });
  }

  const shopifyRes = await admin.graphql(`{
    product(id: "${product.shopifyId}") {
      id title handle
    }
  }`);
  const { data } = await shopifyRes.json();

  return { product, shopifyProduct: data?.product };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  const product = await db.product.findUnique({ where: { id: params.id } });
  if (!product) return { ok: false, error: "Product not found" };

  const store = await db.store.findUnique({ where: { id: product.storeId } });
  if (!store || store.myshopifyDomain !== session.shop) {
    return { ok: false, error: "Forbidden" };
  }

  if (intent === "add-field") {
    const label = String(form.get("label") || "").trim();
    if (!label) return { ok: false, error: "Label is required" };
    const type = String(form.get("type") || "").trim();
    if (!["text", "textarea", "image"].includes(type)) return { ok: false, error: "Invalid type" };

    await db.formField.create({
      data: {
        productId: params.id!,
        label,
        type,
        required: form.get("required") === "true",
        sortOrder: parseInt(String(form.get("sortOrder"))) || 0,
      },
    });
  }

  if (intent === "remove-field") {
    const fieldId = String(form.get("fieldId") || "");
    if (!fieldId) return { ok: false, error: "fieldId required" };

    const field = await db.formField.findUnique({ where: { id: fieldId } });
    if (!field || field.productId !== params.id) return { ok: false, error: "Field not found" };

    await db.formField.delete({ where: { id: fieldId } });
  }

  return { ok: true };
};

const FIELD_TYPES = [
  { value: "text", label: "Texto corto" },
  { value: "textarea", label: "Texto largo" },
  { value: "image", label: "Imagen / Foto" },
];

export default function ProductConfig() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data && !("error" in fetcher.data)) {
      shopify.toast.show("Campo actualizado");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading={data.shopifyProduct?.title || "Configurar producto"}>
      <s-section heading="Campos del formulario">
        <s-paragraph>
          Estos campos aparecerán en la página del producto para que el cliente los personalice.
        </s-paragraph>

        {data.product.fields.length === 0 ? (
          <s-paragraph>No hay campos configurados. Añade el primero.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Campo</th>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Tipo</th>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Obligatorio</th>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Orden</th>
                <th style={{ padding: "12px", color: "#202223", fontWeight: "600", fontSize: "13px" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {data.product.fields.map((f: any) => (
                <tr key={f.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <td style={{ padding: "12px", fontSize: "14px" }}>{f.label}</td>
                  <td style={{ padding: "12px", fontSize: "14px", color: "#6d7175" }}>
                    {FIELD_TYPES.find((t) => t.value === f.type)?.label || f.type}
                  </td>
                  <td style={{ padding: "12px", fontSize: "14px" }}>{f.required ? "Sí" : "No"}</td>
                  <td style={{ padding: "12px", fontSize: "14px" }}>{f.sortOrder}</td>
                  <td style={{ padding: "12px" }}>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove-field" />
                      <input type="hidden" name="fieldId" value={f.id} />
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
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Añadir campo">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="add-field" />
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Nombre del campo"
              name="label"
              placeholder="Ej: Nombre de la víctima"
              required
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: "500", color: "#202223" }}>
                Tipo de campo
              </label>
              <select
                name="type"
                required
                style={{
                  padding: "6px 12px",
                  fontSize: "14px",
                  borderRadius: "6px",
                  border: "1px solid #babfc3",
                  backgroundColor: "#ffffff",
                  height: "36px",
                  color: "#202223",
                  boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                  width: "100%",
                }}
              >
                {FIELD_TYPES.map((t: any) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <s-checkbox label="Campo obligatorio" name="required" value="true" />
            <s-text-field
              label="Orden"
              name="sortOrder"
              value={String(data.product.fields.length)}
            />
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: "500",
                borderRadius: "6px",
                border: "1px solid #babfc3",
                backgroundColor: "#008060",
                color: "#ffffff",
                cursor: "pointer",
                boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                width: "fit-content",
              }}
            >
              Añadir campo
            </button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}
