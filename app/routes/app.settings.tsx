import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({
    where: { myshopifyDomain: session.shop },
    include: { settings: true },
  });

  return {
    settings: store?.settings
      ? {
          emailFrom: store.settings.emailFrom,
          emailSubject: store.settings.emailSubject,
          emailBody: store.settings.emailBody,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const store = await db.store.findUnique({
    where: { myshopifyDomain: session.shop },
  });
  if (!store) return { error: "Store not found" };

  const emailFrom = (form.get("emailFrom") as string) || "";
  const emailSubject = (form.get("emailSubject") as string) || "";
  const emailBody = (form.get("emailBody") as string) || "";

  await db.storeSettings.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, emailFrom, emailSubject, emailBody },
    update: { emailFrom, emailSubject, emailBody },
  });

  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData && typeof actionData === "object") {
      if ("error" in actionData) {
        shopify.toast.show(String(actionData.error), { isError: true });
      } else if ("ok" in actionData && actionData.ok) {
        shopify.toast.show("Configuración guardada");
      }
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Configuración">
      <Form method="post">
        <s-stack direction="block" gap="base">
          <s-section heading="Correo electrónico">
            <s-paragraph>
              Configura cómo se enviará el PDF al cliente tras la compra. Esta configuración
              se aplica a todos los productos.
            </s-paragraph>
            <s-text-field
              label="Email remitente"
              name="emailFrom"
              placeholder="escape@tutienda.com"
              value={data.settings?.emailFrom || ""}
            />
            <s-text-field
              label="Asunto del email"
              name="emailSubject"
              placeholder="¡Tu escape room personalizado está listo!"
              value={data.settings?.emailSubject || ""}
            />
            <s-text-area
              label="Cuerpo del email (HTML)"
              name="emailBody"
              placeholder="<p>Gracias por tu compra. Adjunto encontrarás tu escape room.</p>"
              value={data.settings?.emailBody || ""}
            />
          </s-section>

          <s-section heading="Plantilla PDF">
            <s-paragraph>
              La plantilla PDF se configura de forma individual por cada producto.
              Ve a un producto desde el panel principal para subir su plantilla y posicionar los campos.
            </s-paragraph>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "12px 16px",
              backgroundColor: "#f6f6f7",
              border: "1px solid #e1e3e5",
              borderRadius: "8px",
              fontSize: "13px",
              color: "#6d7175",
            }}>
              <span style={{ fontSize: "20px" }}>📄</span>
              <span>
                Accede a <strong>Inicio → [Nombre del producto]</strong> para configurar la plantilla PDF de cada escape room.
              </span>
            </div>
          </s-section>

          <button
            type="submit"
            style={{
              padding: "8px 20px",
              fontSize: "14px",
              fontWeight: "500",
              borderRadius: "6px",
              border: "1px solid #babfc3",
              backgroundColor: "#008060",
              color: "#ffffff",
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            Guardar configuración
          </button>
        </s-stack>
      </Form>
    </s-page>
  );
}
