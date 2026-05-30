import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  throw new Error("RESEND_API_KEY environment variable is required");
}
const resend = new Resend(apiKey);

export async function sendPDFEmail(params: {
  to: string;
  subject: string;
  html: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
  from?: string;
}) {
  const { to, subject, html, pdfBuffer, pdfFilename, from } = params;

  const base64 = pdfBuffer.toString("base64");

  await resend.emails.send({
    from: from || "onboarding@resend.dev",
    to,
    subject,
    html,
    attachments: [
      {
        filename: pdfFilename,
        content: base64,
        content_type: "application/pdf",
      },
    ],
  });
}
