import type { ActionFunctionArgs } from "react-router";
import { generatePDFFromTemplate } from "../utils/pdf.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const form = await request.formData();
    const pdfBase64Raw = (form.get("pdfFileBase64") as string) || "";
    const pdfBase64 = pdfBase64Raw.replace(/ /g, "+");
    const pdfName = form.get("pdfFileName") as string;
    const mappingsJson = form.get("mappingsJson") as string;

    let mappings = [];
    try {
      mappings = JSON.parse(mappingsJson || "[]");
    } catch (e) {}

    if (!pdfBase64) {
      return new Response("No PDF template provided", { status: 400 });
    }

    const base64Data = pdfBase64.replace(/^data:[^;]*;base64,/, "");
    const pdfBytes = Buffer.from(base64Data, "base64");

    const mockFields = mappings.map((m: any) => ({
      label: m.fieldLabel,
      value: `[${m.fieldLabel}]`,
    }));

    const prismaMappings = mappings.map((m: any) => ({
      id: m.id || "",
      configId: "",
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
    }));

    const previewBuffer = await generatePDFFromTemplate(pdfBytes, mockFields, prismaMappings);

    return new Response(previewBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="preview-${pdfName || "template"}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("[preview-action] Error:", err);
    return new Response("Error generating preview: " + err.message, { status: 500 });
  }
};
