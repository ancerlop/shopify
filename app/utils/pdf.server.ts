import PDFDocument from "pdfkit";
import { PDFDocument as PdfLibDocument, rgb, StandardFonts } from "pdf-lib";
import type { PdfFieldMapping } from "@prisma/client";
import { join } from "path";
import { readFileSync } from "fs";

export interface PDFData {
  fields: { label: string; value: string }[];
  imageUrl?: string;
}

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

async function getImageBytes(value: string): Promise<Buffer | null> {
  try {
    if (isLocalUpload(value)) {
      const filePath = getImagePath(value);
      return readFileSync(filePath);
    } else if (isHttpUrl(value)) {
      const res = await fetch(value);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  } catch (error) {
    console.error("Error loading image bytes:", error);
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  let cleanHex = hex.replace(/^#/, "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split("").map((c) => c + c).join("");
  }
  const num = parseInt(cleanHex, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return [r, g, b];
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

const FONT_MAP: Record<string, StandardFonts> = {
  "Helvetica": StandardFonts.Helvetica,
  "Helvetica-Bold": StandardFonts.HelveticaBold,
  "Helvetica-Oblique": StandardFonts.HelveticaOblique,
  "Helvetica-BoldOblique": StandardFonts.HelveticaBoldOblique,
  "Courier": StandardFonts.Courier,
  "Courier-Bold": StandardFonts.CourierBold,
  "Courier-Oblique": StandardFonts.CourierOblique,
  "Courier-BoldOblique": StandardFonts.CourierBoldOblique,
  "Times-Roman": StandardFonts.TimesRoman,
  "Times-Bold": StandardFonts.TimesRomanBold,
  "Times-Italic": StandardFonts.TimesRomanItalic,
  "Times-BoldItalic": StandardFonts.TimesRomanBoldItalic,
};

export async function generatePDFFromTemplate(
  templateBytes: Uint8Array,
  fields: { label: string; value: string }[],
  mappings: (PdfFieldMapping & { fontFamily?: string })[]
): Promise<Buffer> {
  const pdfDoc = await PdfLibDocument.load(templateBytes);

  // Pre-embed all distinct fonts needed
  const fontCache: Record<string, any> = {};
  async function getFont(family: string) {
    const key = family || "Helvetica";
    if (!fontCache[key]) {
      const stdFont = FONT_MAP[key] ?? StandardFonts.Helvetica;
      fontCache[key] = await pdfDoc.embedFont(stdFont);
    }
    return fontCache[key];
  }

  for (const mapping of mappings) {
    const field = fields.find(
      (f) => f.label.toLowerCase() === mapping.fieldLabel.toLowerCase()
    );
    if (!field || !field.value) continue;

    const pages = pdfDoc.getPages();
    const pageIndex = mapping.page;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];

    if (isImageUrl(field.value)) {
      const imgBytes = await getImageBytes(field.value);
      if (imgBytes) {
        try {
          let embeddedImage;
          const lowerVal = field.value.toLowerCase();
          if (lowerVal.endsWith(".png")) {
            embeddedImage = await pdfDoc.embedPng(imgBytes);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imgBytes);
          }
          
          const boxWidth = mapping.maxWidth || 150;
          const boxHeight = (mapping as any).imageHeight || (mapping.maxWidth ? (boxWidth * 0.75) : 112);
          
          // Escalar proporcionalmente para que quepa en la caja sin deformarse
          const dims = embeddedImage.scaleToFit(boxWidth, boxHeight);
          
          // Centrar la imagen dentro de la caja definida
          const xOffset = (boxWidth - dims.width) / 2;
          const yOffset = (boxHeight - dims.height) / 2;

          page.drawImage(embeddedImage, {
            x: mapping.x + xOffset,
            y: mapping.y + yOffset,
            width: dims.width,
            height: dims.height,
          });
        } catch (imgErr) {
          console.error("Error embedding image in PDF:", imgErr);
        }
      }
    } else {
      const [r, g, b] = hexToRgb(mapping.fontColor || "#000000");
      const font = await getFont((mapping as any).fontFamily || "Helvetica");
      page.drawText(field.value, {
        x: mapping.x,
        y: mapping.y,
        size: mapping.fontSize,
        font,
        color: rgb(r, g, b),
        maxWidth: mapping.maxWidth || undefined,
        lineHeight: mapping.fontSize * 1.2,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

