import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Form, useActionData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useEffect, useState } from "react";
import PdfEditor, { type FieldMapping, type AvailableField } from "../components/PdfEditor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const product = await db.product.findUnique({
    where: { id: params.id },
    include: {
      fields: { orderBy: { sortOrder: "asc" } },
      pdfConfig: {
        include: { fieldMappings: true },
      },
    },
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

  const pdfConfigData = product.pdfConfig
    ? {
        id: product.pdfConfig.id,
        pdfTemplate: product.pdfConfig.pdfTemplate,
        pdfTemplateName: product.pdfConfig.pdfTemplateName,
        pdfTemplateFileBase64: product.pdfConfig.pdfTemplateFile
          ? product.pdfConfig.pdfTemplateFile.toString("base64")
          : null,
        fieldMappings: product.pdfConfig.fieldMappings.map((fm) => ({
          id: fm.id,
          configId: fm.configId,
          fieldLabel: fm.fieldLabel,
          fieldType: fm.fieldType,
          page: fm.page,
          x: fm.x,
          y: fm.y,
          fontSize: fm.fontSize,
          fontColor: fm.fontColor,
          fontFamily: fm.fontFamily,
          maxWidth: fm.maxWidth,
          imageHeight: fm.imageHeight,
        })),
      }
    : null;

  return {
    product: {
      ...product,
      pdfConfig: pdfConfigData,
    },
    shopifyProduct: data?.product,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  const product = await db.product.findUnique({
    where: { id: params.id },
    include: { pdfConfig: true },
  });
  if (!product) return { ok: false, error: "Product not found" };

  const store = await db.store.findUnique({ where: { id: product.storeId } });
  if (!store || store.myshopifyDomain !== session.shop) {
    return { ok: false, error: "Forbidden" };
  }

  // --- Form field management ---
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
    return { ok: true };
  }

  if (intent === "remove-field") {
    const fieldId = String(form.get("fieldId") || "");
    if (!fieldId) return { ok: false, error: "fieldId required" };
    const field = await db.formField.findUnique({ where: { id: fieldId } });
    if (!field || field.productId !== params.id) return { ok: false, error: "Field not found" };
    await db.formField.delete({ where: { id: fieldId } });
    return { ok: true };
  }

  // --- PDF template management ---
  if (intent === "save-pdf") {
    const pdfBase64 = form.get("pdfFileBase64") as string;
    const pdfName = form.get("pdfFileName") as string;
    const pdfTemplate = (form.get("pdfTemplate") as string) || "";
    const mappingsJson = form.get("mappingsJson") as string;

    let mappings: FieldMapping[] = [];
    try { mappings = JSON.parse(mappingsJson || "[]"); } catch (e) {}

    const configData: any = { pdfTemplate };

    if (pdfBase64) {
      configData.pdfTemplateFile = Buffer.from(
        pdfBase64.replace(/^data:application\/pdf;base64,/, ""),
        "base64"
      );
      configData.pdfTemplateName = pdfName || "template.pdf";
    }

    const config = await db.productPdfConfig.upsert({
      where: { productId: params.id! },
      create: { productId: params.id!, ...configData },
      update: configData,
    });

    // Save field mappings
    if (pdfBase64 || product.pdfConfig?.pdfTemplateFile) {
      await db.pdfFieldMapping.deleteMany({ where: { configId: config.id } });
      if (mappings.length > 0) {
        await db.pdfFieldMapping.createMany({
          data: mappings.map((m) => ({
            configId: config.id,
            fieldLabel: m.fieldLabel,
            fieldType: m.fieldType || "text",
            x: Number(m.x) || 0,
            y: Number(m.y) || 0,
            fontSize: Number(m.fontSize) || 12,
            fontColor: m.fontColor || "#000000",
            fontFamily: m.fontFamily || "Helvetica",
            maxWidth: m.maxWidth ? Number(m.maxWidth) : null,
            imageHeight: m.imageHeight ? Number(m.imageHeight) : null,
            page: Number(m.page) || 0,
          })),
        });
      }
    }

    return { ok: true, intent: "save-pdf" };
  }

  if (intent === "delete-template") {
    if (product.pdfConfig) {
      await db.productPdfConfig.delete({ where: { id: product.pdfConfig.id } });
    }
    return { ok: true, intent: "delete-template" };
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
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  const [pdfBase64, setPdfBase64] = useState<string>("");
  const [pdfName, setPdfName] = useState<string>("");
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (data.product.pdfConfig) {
      setPdfName(data.product.pdfConfig.pdfTemplateName || "");
      setMappings((data.product.pdfConfig.fieldMappings as FieldMapping[]) || []);
    }
  }, [data.product.pdfConfig]);

  useEffect(() => {
    if (actionData && typeof actionData === "object") {
      if ("error" in actionData && actionData.error) {
        shopify.toast.show(String(actionData.error), { isError: true });
      } else if ("ok" in actionData && actionData.ok) {
        if ("intent" in actionData && actionData.intent === "delete-template") {
          shopify.toast.show("Plantilla eliminada");
        } else if ("intent" in actionData && actionData.intent === "save-pdf") {
          shopify.toast.show("Plantilla PDF guardada");
        } else {
          shopify.toast.show("Campo actualizado");
        }
      }
    }
  }, [actionData, shopify]);

  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === "object" && !("error" in fetcher.data)) {
      shopify.toast.show("Campo actualizado");
    }
  }, [fetcher.data, shopify]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      shopify.toast.show("Selecciona un archivo PDF válido.", { isError: true });
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
    if (confirm("¿Eliminar la plantilla PDF y todos sus mapeos?")) {
      setPdfBase64("");
      setPdfName("");
      setMappings([]);
      fetcher.submit({ intent: "delete-template" }, { method: "post" });
    }
  };

  const handlePreview = async (e: React.MouseEvent) => {
    e.preventDefault();
    const currentPdf = pdfBase64 || (data.product.pdfConfig?.pdfTemplateFileBase64
      ? `data:application/pdf;base64,${data.product.pdfConfig.pdfTemplateFileBase64}` : "");
    if (!currentPdf) {
      shopify.toast.show("Sube una plantilla PDF primero.", { isError: true });
      return;
    }
    setPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append("pdfFileBase64", currentPdf);
      formData.append("pdfFileName", pdfName);
      formData.append("mappingsJson", JSON.stringify(mappings));
      const response = await fetch("/preview", { method: "POST", body: formData });
      if (!response.ok) {
        shopify.toast.show("Error: " + await response.text(), { isError: true });
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
      shopify.toast.show("PDF descargado");
    } catch (err: any) {
      shopify.toast.show("Error: " + err.message, { isError: true });
    } finally {
      setPreviewLoading(false);
    }
  };

  const activePdfBase64 = pdfBase64 || (data.product.pdfConfig?.pdfTemplateFileBase64
    ? `data:application/pdf;base64,${data.product.pdfConfig.pdfTemplateFileBase64}` : "");
  const hasPdf = Boolean(pdfName || data.product.pdfConfig?.pdfTemplateName);

  const availableFields: AvailableField[] = data.product.fields.map((f: any) => ({
    label: f.label,
    type: f.type,
  }));

  return (
    <s-page heading={data.shopifyProduct?.title || "Configurar producto"}>
      {/* ===== FORM FIELDS SECTION ===== */}
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
                      <button type="submit" style={deleteBtnStyle}>Eliminar</button>
                    </fetcher.Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      {/* ===== ADD FIELD ===== */}
      <s-section heading="Añadir campo">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="add-field" />
          <s-stack direction="block" gap="base">
            <s-text-field label="Nombre del campo" name="label" placeholder="Ej: Nombre de la víctima" required />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: "500", color: "#202223" }}>Tipo de campo</label>
              <select name="type" required style={selectStyle}>
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <s-checkbox label="Campo obligatorio" name="required" value="true" />
            <s-text-field label="Orden" name="sortOrder" value={String(data.product.fields.length)} />
            <button type="submit" style={primaryBtnStyle}>Añadir campo</button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* ===== PDF TEMPLATE SECTION ===== */}
      <s-section heading="Plantilla PDF">
        {hasPdf ? (
          <Form method="post">
            <input type="hidden" name="intent" value="save-pdf" />
            <input type="hidden" name="pdfFileBase64" value={pdfBase64} />
            <input type="hidden" name="pdfFileName" value={pdfName} />
            <input type="hidden" name="mappingsJson" value={JSON.stringify(mappings)} />

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* File header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", border: "1px solid #babfc3", borderRadius: "6px", backgroundColor: "#f6f6f7",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <svg viewBox="0 0 20 20" width="18" height="18" style={{ fill: "#6d7175" }}>
                    <path d="M15.5 5h-3V1.5a.5.5 0 0 0-.5-.5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5.5a.5.5 0 0 0-.5-.5zM12 2.06c.8.23 1.5.93 1.73 1.73H12V2.06zM15 17H5V3h5v2.5a.5.5 0 0 0 .5.5H13v11z" />
                  </svg>
                  <span style={{ fontSize: "14px", fontWeight: "500", color: "#202223" }}>
                    {pdfName || data.product.pdfConfig?.pdfTemplateName}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={handlePreview} disabled={previewLoading} style={{
                    ...secondaryBtnStyle,
                    backgroundColor: previewLoading ? "#f6f6f7" : "#ffffff",
                    color: previewLoading ? "#8c9196" : "#202223",
                    cursor: previewLoading ? "not-allowed" : "pointer",
                  }}>
                    {previewLoading ? "Generando..." : "⬇ Previsualizar"}
                  </button>
                  <button type="button" onClick={handleDeleteTemplate} style={{...secondaryBtnStyle, color: "#d72c0d"}}>
                    Eliminar plantilla
                  </button>
                </div>
              </div>

              {/* Visual editor */}
              <p style={{ fontSize: "13px", color: "#6d7175", margin: "0" }}>
                Arrastra los campos sobre el PDF. Los campos de imagen muestran un recuadro con las dimensiones.
              </p>
              {activePdfBase64 ? (
                <PdfEditor
                  pdfBase64={activePdfBase64}
                  mappings={mappings}
                  availableFields={availableFields}
                  onMappingsChange={setMappings}
                />
              ) : (
                <div style={{ padding: "16px", textAlign: "center", color: "#6d7175" }}>
                  Guarda para cargar el editor...
                </div>
              )}

              <button type="submit" style={primaryBtnStyle}>
                Guardar plantilla PDF
              </button>
            </div>
          </Form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.product.fields.length === 0 ? (
              <div style={{
                padding: "16px", border: "1px dashed #babfc3", borderRadius: "6px",
                textAlign: "center", color: "#6d7175", fontSize: "13px",
              }}>
                Añade primero los campos del formulario antes de configurar la plantilla PDF.
              </div>
            ) : (
              <>
                <s-paragraph>
                  Sube una plantilla PDF diseñada para este producto. Podrás arrastrar los campos directamente sobre el PDF.
                </s-paragraph>
                <input type="file" accept=".pdf" onChange={handleFileChange} style={{
                  padding: "8px", border: "1px solid #babfc3", borderRadius: "6px",
                  width: "100%", maxWidth: "400px",
                }} />

                <div style={{ margin: "4px 0", display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#e1e3e5" }} />
                  <span style={{ fontSize: "12px", color: "#6d7175", fontWeight: "500" }}>O USA TEXTO PLANO</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#e1e3e5" }} />
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value="save-pdf" />
                  <input type="hidden" name="pdfFileBase64" value="" />
                  <input type="hidden" name="pdfFileName" value="" />
                  <input type="hidden" name="mappingsJson" value="[]" />
                  <s-text-area
                    label="Plantilla de texto"
                    name="pdfTemplate"
                    placeholder={"Víctima: {{Nombre de la víctima}}\nMascota: {{Mascota}}"}
                    value={data.product.pdfConfig?.pdfTemplate || ""}
                  />
                  <div style={{ marginTop: "12px" }}>
                    <button type="submit" style={primaryBtnStyle}>Guardar plantilla de texto</button>
                  </div>
                </Form>
              </>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", fontSize: "14px", fontWeight: "500", borderRadius: "6px",
  border: "1px solid #babfc3", backgroundColor: "#008060", color: "#ffffff",
  cursor: "pointer", boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)", width: "fit-content",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: "13px", fontWeight: "500", borderRadius: "4px",
  border: "1px solid #babfc3", backgroundColor: "#ffffff", color: "#202223", cursor: "pointer",
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: "13px", fontWeight: "500", borderRadius: "4px",
  border: "1px solid #babfc3", backgroundColor: "#ffffff", color: "#d72c0d",
  cursor: "pointer", boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)",
};

const selectStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: "14px", borderRadius: "6px", border: "1px solid #babfc3",
  backgroundColor: "#ffffff", height: "36px", color: "#202223",
  boxShadow: "0 1px 0 0 rgba(22, 29, 37, 0.05)", width: "100%",
};
