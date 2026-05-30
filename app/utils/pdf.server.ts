import PDFDocument from "pdfkit";

export interface PDFData {
  fields: { label: string; value: string }[];
  imageUrl?: string;
}

function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function embedImage(doc: PDFDocument, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isHttpUrl(value)) {
      doc.image(value, { fit: [400, 300], align: "center", valign: "center" });
      resolve();
    } else if (isDataUrl(value)) {
      const base64 = value.split(",")[1];
      if (!base64) return resolve();
      const buf = Buffer.from(base64, "base64");
      doc.image(buf, { fit: [400, 300], align: "center", valign: "center" });
      resolve();
    } else {
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

      if (data.imageUrl && (isHttpUrl(data.imageUrl) || isDataUrl(data.imageUrl))) {
        doc.moveDown();
        await embedImage(doc, data.imageUrl);
      }
    } else {
      doc.fontSize(24).text("Tu Escape Room Personalizado", { align: "center" });
      doc.moveDown(2);

      for (const field of data.fields) {
        if (isDataUrl(field.value)) {
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

      if (data.imageUrl && !data.fields.some((f) => f.value === data.imageUrl)) {
        doc.moveDown();
        await embedImage(doc, data.imageUrl);
      }
    }

    doc.end();
  });
}
