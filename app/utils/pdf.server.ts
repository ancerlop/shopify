import PDFDocument from "pdfkit";

export interface PDFData {
  fields: { label: string; value: string }[];
  imageUrl?: string;
}

import { join } from "path";

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isLocalUpload(value: string): boolean {
  return value.startsWith("/uploads/");
}

function isImageUrl(value: string): boolean {
  return isHttpUrl(value) || isLocalUpload(value);
}

function getImagePath(value: string): string {
  if (isLocalUpload(value)) {
    return join(process.cwd(), "public", value);
  }
  return value;
}

function embedImage(doc: PDFDocument, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const pathOrUrl = getImagePath(value);
      doc.image(pathOrUrl, { fit: [400, 300], align: "center", valign: "center" });
      resolve();
    } catch (err) {
      console.error("[pdf-embed] Error embedding image:", err);
      resolve();
    }
  });
}

export async function generatePDF(data: PDFData, template?: string): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (template) {
      const styled = template
        .replace(/{{([^}]+)}}/g, (_, key) => {
          const field = data.fields.find(
            (f) => f.label.toLowerCase() === key.trim().toLowerCase()
          );
          return field ? field.value : "";
        });

      doc.fontSize(12).text(styled, 50, 50, { width: 500 });

      if (data.imageUrl && isImageUrl(data.imageUrl)) {
        doc.moveDown();
        await embedImage(doc, data.imageUrl);
      }
    } else {
      doc.fontSize(24).text("Tu Escape Room Personalizado", { align: "center" });
      doc.moveDown(2);

      for (const field of data.fields) {
        if (isImageUrl(field.value)) {
          doc.fontSize(14).text(`${field.label}:`, { continued: false });
          doc.moveDown(0.3);
          await embedImage(doc, field.value);
          doc.moveDown(0.5);
        } else {
          doc.fontSize(14).text(`${field.label}:`, { continued: false });
          doc.fontSize(12).text(field.value || "(no especificado)");
          doc.moveDown(0.5);
        }
      }

      if (data.imageUrl && isImageUrl(data.imageUrl) && !data.fields.some((f) => f.value === data.imageUrl)) {
        doc.moveDown();
        await embedImage(doc, data.imageUrl);
      }
    }

    doc.end();
  });
}
