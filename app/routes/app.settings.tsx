import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Form, useActionData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useEffect, useState } from "react";
import PdfEditor, { type FieldMapping } from "../components/PdfEditor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await db.store.findUnique({
    where: { myshopifyDomain: session.shop },
    include: {
      settings: {
        include: {
          fieldMappings: true,
        },
      },
    },
  });

  const fields = await db.formField.findMany({
    where: {
      product: {
        storeId: store?.id,
      },
    },
    select: {
      label: true,
    },
    distinct: ["label"],
  });

  const uniqueLabels = fields.map((f) => f.label);

  const settingsData = store?.settings
    ? {
        id: store.settings.id,
        storeId: store.settings.storeId,
        pdfTemplate: store.settings.pdfTemplate,
        pdfTemplateName: store.settings.pdfTemplateName,
        emailFrom: store.settings.emailFrom,
        emailSubject: store.settings.emailSubject,
        emailBody: store.settings.emailBody,
        fieldMappings: store.settings.fieldMappings.map((fm) => ({
          id: fm.id,
          settingsId: fm.settingsId,
          fieldLabel: fm.fieldLabel,
          page: fm.page,
          x: fm.x,
          y: fm.y,
          fontSize: fm.fontSize,
          fontColor: fm.fontColor,
          fontFamily: fm.fontFamily,
          maxWidth: fm.maxWidth,
        })),
        pdfTemplateFileBase64: store.settings.pdfTemplateFile
          ? store.settings.pdfTemplateFile.toString("base64")
          : null,
      }
    : null;

  return {
    settings: settingsData,
    uniqueLabels,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  const store = await db.store.findUnique({
    where: { myshopifyDomain: session.shop },
    include: { settings: true },
  });
  if (!store) return { error: "Store not found" };

  if (intent === "delete-template") {
    if (store.settings) {
      await db.storeSettings.update({
        where: { id: store.settings.id },
        data: {
          pdfTemplateFile: null,
          pdfTemplateName: null,
          fieldMappings: {
            deleteMany: {},
          },
        },
      });
    }
    return { ok: true };
  }

  const emailFrom = (form.get("emailFrom") as string) || "";
  const emailSubject = (form.get("emailSubject") as string) || "";
  const emailBody = (form.get("emailBody") as string) || "";
  const pdfTemplate = (form.get("pdfTemplate") as string) || "";

  const pdfBase64 = form.get("pdfFileBase64") as string;
  const pdfName = form.get("pdfFileName") as string;
  const mappingsJson = form.get("mappingsJson") as string;

  let mappings: FieldMapping[] = [];
  try {
    mappings = JSON.parse(mappingsJson || "[]");
  } catch (e) {}

  const settingsData: any = {
    emailFrom,
    emailSubject,
    emailBody,
    pdfTemplate,
  };

  if (pdfBase64) {
    settingsData.pdfTemplateFile = Buffer.from(
      pdfBase64.replace(/^data:application\/pdf;base64,/, ""),
      "base64"
    );
    settingsData.pdfTemplateName = pdfName || "template.pdf";
  }

  const settings = await db.storeSettings.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      ...settingsData,
    },
    update: settingsData,
  });

  if (pdfBase64 || store.settings?.pdfTemplateFile) {
    await db.pdfFieldMapping.deleteMany({
      where: { settingsId: settings.id },
    });

    if (mappings.length > 0) {
      await db.pdfFieldMapping.createMany({
        data: mappings.map((m) => ({
          settingsId: settings.id,
          fieldLabel: m.fieldLabel,
          x: Number(m.x) || 0,
          y: Number(m.y) || 0,
          fontSize: Number(m.fontSize) || 12,
          fontColor: m.fontColor || "#000000",
          fontFamily: m.fontFamily || "Helvetica",
          maxWidth: m.maxWidth ? Number(m.maxWidth) : null,
          page: Number(m.page) || 0,
        })),
      });
    }
  }

  return { ok: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  const [pdfBase64, setPdfBase64] = useState<string>("");
  const [pdfName, setPdfName] = useState<string>("");
  const [mappings, setMappings] = useState<FieldMapping[]>([]);

  useEffect(() => {
    if (data.settings) {
      setPdfName(data.settings.pdfTemplateName || "");
      setMappings((data.settings.fieldMappings as FieldMapping[]) || []);
    }
  }, [data.settings]);

  useEffect(() => {
    if (actionData && typeof actionData === "object") {
      if ("error" in actionData) {
        shopify.toast.show(actionData.error, { isError: true });
      } else if ("ok" in actionData && actionData.ok) {
        shopify.toast.show("Configuración guardada");
      }
    }
  }, [actionData, shopify]);

  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === "object") {
      if ("error" in fetcher.data) {
        shopify.toast.show(fetcher.data.error, { isError: true });
      } else if ("ok" in fetcher.data && fetcher.data.ok) {
        shopify.toast.show("Plantilla eliminada");
      }
    }
  }, [fetcher.data, shopify]);

  const [previewLoading, setPreviewLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      shopify.toast.show("Por favor, selecciona un archivo PDF válido.", { isError: true });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPdfBase64(reader.result as string);
      setPdfName(file.name);
      setMappings([]);
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteTemplate = () => {
    if (confirm("¿Estás seguro de que quieres eliminar la plantilla PDF y todos sus mapeos?")) {
      setPdfBase64("");
      setPdfName("");
      setMappings([]);
      fetcher.submit({ intent: "delete-template" }, { method: "post" });
    }
  };

  const handlePreview = async (e: React.MouseEvent) => {
    e.preventDefault();

    const currentPdfBase64 = pdfBase64 || (data.settings?.pdfTemplateFileBase64
      ? `data:application/pdf;base64,${data.settings.pdfTemplateFileBase64}`
      : "");

    if (!currentPdfBase64) {
      shopify.toast.show("Por favor, sube una plantilla PDF primero.", { isError: true });
      return;
    }

    setPreviewLoading(true);

    try {
      const formData = new FormData();
      formData.append("pdfFileBase64", currentPdfBase64);
      formData.append("pdfFileName", pdfName);
      formData.append("mappingsJson", JSON.stringify(mappings));

      const response = await fetch("/preview", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        shopify.toast.show("Error al previsualizar: " + errorText, { isError: true });
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `preview-${pdfName || "template"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      shopify.toast.show("PDF descargado correctamente");
    } catch (err: any) {
      shopify.toast.show("Error: " + err.message, { isError: true });
    } finally {
      setPreviewLoading(false);
    }
  };

  // Which PDF base64 to show in the editor
  const activePdfBase64 = pdfBase64 || (data.settings?.pdfTemplateFileBase64
    ? `data:application/pdf;base64,${data.settings.pdfTemplateFileBase64}`
    : "");

  const hasPdf = Boolean(pdfName || data.settings?.pdfTemplateName);

  return (
    <s-page heading="Configuración">
      <Form method="post">
        <input type="hidden" name="pdfFileBase64" value={pdfBase64} />
        <input type="hidden" name="pdfFileName" value={pdfName} />
        <input type="hidden" name="mappingsJson" value={JSON.stringify(mappings)} />

        <s-stack direction="block" gap="base">
          {/* Email settings */}
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

          {/* PDF Template */}
          <s-section heading="Plantilla PDF">
            {hasPdf ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* File header */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  border: "1px solid #babfc3",
                  borderRadius: "6px",
                  backgroundColor: "#f6f6f7",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg viewBox="0 0 20 20" width="18" height="18" style={{ fill: "#6d7175" }}>
                      <path d="M15.5 5h-3V1.5a.5.5 0 0 0-.5-.5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5.5a.5.5 0 0 0-.5-.5zM12 2.06c.8.23 1.5.93 1.73 1.73H12V2.06zM15 17H5V3h5v2.5a.5.5 0 0 0 .5.5H13v11z" />
                    </svg>
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "#202223" }}>
                      {pdfName || data.settings?.pdfTemplateName}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={handlePreview}
                      disabled={previewLoading}
                      style={{
                        padding: "6px 12px",
                        fontSize: "13px",
                        fontWeight: "500",
                        borderRadius: "4px",
                        border: "1px solid #babfc3",
                        backgroundColor: previewLoading ? "#f6f6f7" : "#ffffff",
                        color: previewLoading ? "#8c9196" : "#202223",
                        cursor: previewLoading ? "not-allowed" : "pointer",
                      }}
                    >
                      {previewLoading ? "Generando..." : "⬇ Previsualizar PDF"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteTemplate}
                      style={{
                        padding: "6px 12px",
                        fontSize: "13px",
                        fontWeight: "500",
                        borderRadius: "4px",
                        border: "1px solid #babfc3",
                        backgroundColor: "#ffffff",
                        color: "#d72c0d",
                        cursor: "pointer",
                      }}
                    >
                      Eliminar plantilla
                    </button>
                  </div>
                </div>

                {/* Visual editor */}
                <div>
                  <p style={{ fontSize: "13px", color: "#6d7175", margin: "0 0 12px 0" }}>
                    Arrastra los campos sobre el PDF para posicionarlos. Selecciona un campo para cambiar la fuente, tamaño y color.
                  </p>
                  {activePdfBase64 ? (
                    <PdfEditor
                      pdfBase64={activePdfBase64}
                      mappings={mappings}
                      availableFields={data.uniqueLabels || []}
                      onMappingsChange={setMappings}
                    />
                  ) : (
                    <div style={{ padding: "16px", textAlign: "center", color: "#6d7175", fontSize: "13px" }}>
                      Guardando configuración para cargar el editor...
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <s-paragraph>
                  Sube una plantilla PDF diseñada. Podrás arrastrar los campos dinámicos directamente sobre el PDF.
                </s-paragraph>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  style={{
                    padding: "8px",
                    border: "1px solid #babfc3",
                    borderRadius: "6px",
                    width: "100%",
                    maxWidth: "400px",
                  }}
                />

                <div style={{
                  margin: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#e1e3e5" }} />
                  <span style={{ fontSize: "12px", color: "#6d7175", fontWeight: "500" }}>O USA LA PLANTILLA DE TEXTO</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#e1e3e5" }} />
                </div>

                <s-paragraph>
                  Si no usas un PDF diseñado, puedes introducir un texto plano/HTML con {"{{Nombre}}"}, {"{{Mascota}}"}, etc.
                </s-paragraph>
                <s-text-area
                  label="Plantilla de texto"
                  name="pdfTemplate"
                  placeholder="Víctima: {{Nombre de la víctima}}&#10;Mascota: {{Mascota}}"
                  value={data.settings?.pdfTemplate || ""}
                />
              </div>
            )}
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
              boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
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
