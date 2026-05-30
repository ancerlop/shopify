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
          <s-table>
            <s-table-header>
              <s-table-row>
                <s-table-cell>Campo</s-table-cell>
                <s-table-cell>Tipo</s-table-cell>
                <s-table-cell>Obligatorio</s-table-cell>
                <s-table-cell>Orden</s-table-cell>
                <s-table-cell>Acción</s-table-cell>
              </s-table-row>
            </s-table-header>
            {data.product.fields.map((f: any) => (
              <s-table-row key={f.id}>
                <s-table-cell>{f.label}</s-table-cell>
                <s-table-cell>{FIELD_TYPES.find((t) => t.value === f.type)?.label || f.type}</s-table-cell>
                <s-table-cell>{f.required ? "Sí" : "No"}</s-table-cell>
                <s-table-cell>{f.sortOrder}</s-table-cell>
                <s-table-cell>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="remove-field" />
                    <input type="hidden" name="fieldId" value={f.id} />
                    <s-button variant="tertiary" tone="critical">
                      Eliminar
                    </s-button>
                  </fetcher.Form>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table>
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
            <s-select label="Tipo de campo" name="type" required>
              {FIELD_TYPES.map((t: any) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </s-select>
            <s-checkbox label="Campo obligatorio" name="required" value="true" />
            <s-text-field
              label="Orden"
              name="sortOrder"
              value={String(data.product.fields.length)}
            />
            <s-button>Añadir campo</s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}
