import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
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

  return { settings: store?.settings || null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const store = await db.store.findUnique({ where: { myshopifyDomain: session.shop } });
  if (!store) return { error: "Store not found" };

  await db.storeSettings.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      pdfTemplate: (form.get("pdfTemplate") as string) || "",
      emailFrom: (form.get("emailFrom") as string) || "",
      emailSubject: (form.get("emailSubject") as string) || "",
      emailBody: (form.get("emailBody") as string) || "",
    },
    update: {
      pdfTemplate: form.get("pdfTemplate") as string,
      emailFrom: form.get("emailFrom") as string,
      emailSubject: form.get("emailSubject") as string,
      emailBody: form.get("emailBody") as string,
    },
  });

  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data && !("error" in fetcher.data)) {
      shopify.toast.show("Configuración guardada");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Configuración">
      <fetcher.Form method="post">
        <s-stack direction="block" gap="base">
          <s-section heading="Correo electrónico">
            <s-paragraph>
              Configura cómo se enviará el PDF al cliente tras la compra.
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
              Usa {"{{Nombre}}"}, {"{{Mascota}}"}, etc. para inyectar los valores de los campos.
              Si está vacío, se usará la plantilla por defecto.
            </s-paragraph>
            <s-text-area
              label="Plantilla HTML"
              name="pdfTemplate"
              placeholder="<h1>Escape Room</h1><p>Víctima: {{Nombre de la víctima}}</p>"
              value={data.settings?.pdfTemplate || ""}
            />
          </s-section>

          <s-button>Guardar configuración</s-button>
        </s-stack>
      </fetcher.Form>
    </s-page>
  );
}
