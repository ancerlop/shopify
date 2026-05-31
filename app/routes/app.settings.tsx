import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Form, useActionData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useEffect, useState } from "react";

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
        fieldMappings: store.settings.fieldMappings,
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

  if (intent === "preview") {
    const pdfBase64 = form.get("pdfFileBase64") as string;
    const pdfName = form.get("pdfFileName") as string;
    const mappingsJson = form.get("mappingsJson") as string;

    let mappings = [];
    try {
      mappings = JSON.parse(mappingsJson || "[]");
    } catch (e) {}

    let pdfBytes: Buffer;
    if (pdfBase64) {
      pdfBytes = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ""), "base64");
    } else if (store.settings?.pdfTemplateFile) {
      pdfBytes = Buffer.from(store.settings.pdfTemplateFile);
    } else {
      return { error: "No hay plantilla PDF para previsualizar." };
    }

    const mockFields = mappings.map((m: any) => ({
      label: m.fieldLabel,
      value: `[${m.fieldLabel}]`,
    }));

    const prismaMappings = mappings.map((m: any) => ({
      id: m.id || "",
      settingsId: store.settings?.id || "",
      fieldLabel: m.fieldLabel,
      x: Number(m.x) || 0,
      y: Number(m.y) || 0,
      fontSize: Number(m.fontSize) || 12,
      fontColor: m.fontColor || "#000000",
      maxWidth: m.maxWidth ? Number(m.maxWidth) : null,
      page: Number(m.page) || 0,
    }));

    try {
      const { generatePDFFromTemplate } = await import("../utils/pdf.server");
      const previewBuffer = await generatePDFFromTemplate(pdfBytes, mockFields, prismaMappings);
      return new Response(previewBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="preview-${pdfName || "template"}.pdf"`,
        },
      });
    } catch (err: any) {
      console.error("[preview-action] Error:", err);
      return { error: "Error al generar la previsualización: " + err.message };
    }
  }

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

  let mappings = [];
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
        data: mappings.map((m: any) => ({
          settingsId: settings.id,
          fieldLabel: m.fieldLabel,
          x: Number(m.x) || 0,
          y: Number(m.y) || 0,
          fontSize: Number(m.fontSize) || 12,
          fontColor: m.fontColor || "#000000",
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
  const [mappings, setMappings] = useState<any[]>([]);

  useEffect(() => {
    if (data.settings) {
      setPdfName(data.settings.pdfTemplateName || "");
      setMappings(data.settings.fieldMappings || []);
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

  const handlePreview = (e: React.MouseEvent) => {
    e.preventDefault();

    const currentPdfBase64 = pdfBase64 || (data.settings?.pdfTemplateFileBase64 ? `data:application/pdf;base64,${data.settings.pdfTemplateFileBase64}` : "");

    if (!currentPdfBase64) {
      shopify.toast.show("Por favor, sube una plantilla PDF primero.", { isError: true });
      return;
    }

    const tempForm = document.createElement("form");
    tempForm.method = "POST";
    tempForm.action = "/preview";
    tempForm.target = "_blank";

    const inputs = {
      intent: "preview",
      pdfFileBase64: currentPdfBase64,
      pdfFileName: pdfName,
      mappingsJson: JSON.stringify(mappings),
    };

    for (const [key, value] of Object.entries(inputs)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      tempForm.appendChild(input);
    }

    document.body.appendChild(tempForm);
    tempForm.submit();
    document.body.removeChild(tempForm);
  };

  const addMapping = () => {
    setMappings([
      ...mappings,
      {
        fieldLabel: "",
        page: 0,
        x: 50,
        y: 750,
        fontSize: 12,
        fontColor: "#000000",
        maxWidth: null,
      },
    ]);
  };

  const removeMapping = (index: number) => {
    setMappings(mappings.filter((_, i) => i !== index));
  };

  const updateMapping = (index: number, key: string, val: any) => {
    setMappings(
      mappings.map((m, i) => {
        if (i === index) {
          return { ...m, [key]: val };
        }
        return m;
      })
    );
  };

  return (
    <s-page heading="Configuración">
      <datalist id="unique-fields">
        {data.uniqueLabels?.map((label: string) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      <Form method="post">
        <input type="hidden" name="pdfFileBase64" value={pdfBase64} />
        <input type="hidden" name="pdfFileName" value={pdfName} />
        <input type="hidden" name="mappingsJson" value={JSON.stringify(mappings)} />

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
            {pdfName ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px",
                  border: "1px solid #babfc3",
                  borderRadius: "6px",
                  backgroundColor: "#f6f6f7",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg viewBox="0 0 20 20" width="20" height="20" style={{ fill: "#6d7175" }}>
                      <path d="M15.5 5h-3V1.5a.5.5 0 0 0-.5-.5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5.5a.5.5 0 0 0-.5-.5zM12 2.06c.8.23 1.5.93 1.73 1.73H12V2.06zM15 17H5V3h5v2.5a.5.5 0 0 0 .5.5H13v11z" />
                    </svg>
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "#202223" }}>{pdfName}</span>
                  </div>
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

                <div style={{ marginTop: "8px" }}>
                  <s-paragraph>
                    <strong>Mapeo de Campos PDF:</strong> Vincula las variables del formulario con posiciones en el PDF. La posición (0, 0) corresponde a la esquina inferior izquierda.
                  </s-paragraph>

                  {mappings.length === 0 ? (
                    <div style={{
                      padding: "16px",
                      border: "1px dashed #babfc3",
                      borderRadius: "6px",
                      textAlign: "center",
                      color: "#6d7175",
                      marginTop: "12px",
                    }}>
                      No hay campos mapeados. Añade el primero para empezar a pintar sobre el PDF.
                    </div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "16px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "25%" }}>Campo</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "10%" }}>Pág</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "10%" }}>X</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "10%" }}>Y</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "10%" }}>Tamaño</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "10%" }}>Color</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "15%" }}>Ancho Máx</th>
                          <th style={{ padding: "8px", color: "#202223", fontWeight: "600", fontSize: "13px", width: "10%" }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((m, index) => (
                          <tr key={index} style={{ borderBottom: "1px solid #e1e3e5" }}>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="text"
                                list="unique-fields"
                                value={m.fieldLabel}
                                onChange={(e) => updateMapping(index, "fieldLabel", e.target.value)}
                                placeholder="Nombre del campo"
                                required
                                style={{ width: "90%", padding: "6px", fontSize: "13px", border: "1px solid #babfc3", borderRadius: "4px" }}
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="number"
                                min="1"
                                value={m.page + 1}
                                onChange={(e) => updateMapping(index, "page", Math.max(0, parseInt(e.target.value) - 1))}
                                style={{ width: "50px", padding: "6px", fontSize: "13px", border: "1px solid #babfc3", borderRadius: "4px" }}
                                required
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="number"
                                value={m.x}
                                onChange={(e) => updateMapping(index, "x", parseFloat(e.target.value) || 0)}
                                style={{ width: "65px", padding: "6px", fontSize: "13px", border: "1px solid #babfc3", borderRadius: "4px" }}
                                required
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="number"
                                value={m.y}
                                onChange={(e) => updateMapping(index, "y", parseFloat(e.target.value) || 0)}
                                style={{ width: "65px", padding: "6px", fontSize: "13px", border: "1px solid #babfc3", borderRadius: "4px" }}
                                required
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="number"
                                min="1"
                                value={m.fontSize}
                                onChange={(e) => updateMapping(index, "fontSize", parseFloat(e.target.value) || 12)}
                                style={{ width: "55px", padding: "6px", fontSize: "13px", border: "1px solid #babfc3", borderRadius: "4px" }}
                                required
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="color"
                                value={m.fontColor || "#000000"}
                                onChange={(e) => updateMapping(index, "fontColor", e.target.value)}
                                style={{ width: "40px", height: "30px", padding: "2px", border: "1px solid #babfc3", borderRadius: "4px", cursor: "pointer" }}
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <input
                                type="number"
                                value={m.maxWidth === null ? "" : m.maxWidth}
                                onChange={(e) => updateMapping(index, "maxWidth", e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="Sin límite"
                                style={{ width: "90%", padding: "6px", fontSize: "13px", border: "1px solid #babfc3", borderRadius: "4px" }}
                              />
                            </td>
                            <td style={{ padding: "8px" }}>
                              <button
                                type="button"
                                onClick={() => removeMapping(index)}
                                style={{
                                  padding: "6px 12px",
                                  fontSize: "12px",
                                  fontWeight: "500",
                                  borderRadius: "4px",
                                  border: "1px solid #babfc3",
                                  backgroundColor: "#ffffff",
                                  color: "#d72c0d",
                                  cursor: "pointer",
                                }}
                              >
                                Quitar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
                    <button
                      type="button"
                      onClick={addMapping}
                      style={{
                        padding: "8px 16px",
                        fontSize: "14px",
                        fontWeight: "500",
                        borderRadius: "6px",
                        border: "1px solid #babfc3",
                        backgroundColor: "#ffffff",
                        color: "#202223",
                        cursor: "pointer",
                        boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                      }}
                    >
                      Añadir mapeo
                    </button>

                    <button
                      type="button"
                      onClick={handlePreview}
                      style={{
                        padding: "8px 16px",
                        fontSize: "14px",
                        fontWeight: "500",
                        borderRadius: "6px",
                        border: "1px solid #babfc3",
                        backgroundColor: "#ffffff",
                        color: "#202223",
                        cursor: "pointer",
                        boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
                      }}
                    >
                      Previsualizar PDF
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <s-paragraph>
                  Sube una plantilla PDF diseñada. Podrás colocar los campos dinámicos encima.
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
                  margin: "16px 0",
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
                  label="Plantilla HTML"
                  name="pdfTemplate"
                  placeholder="<h1>Escape Room</h1><p>Víctima: {{Nombre de la víctima}}</p>"
                  value={data.settings?.pdfTemplate || ""}
                />
              </div>
            )}
          </s-section>

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
            Guardar configuración
          </button>
        </s-stack>
      </Form>
    </s-page>
  );
}
