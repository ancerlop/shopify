import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    await authenticate.public.appProxy(request);

    const { filename, type, base64 } = await request.json() as {
      filename?: string;
      type?: string;
      base64?: string;
    };

    if (!base64 || !filename || !type) {
      return { error: "No file provided or incorrect payload format" };
    }

    if (!ALLOWED_MIME_TYPES.includes(type)) {
      return { error: "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed." };
    }

    const buffer = Buffer.from(base64, "base64");

    if (buffer.length > MAX_FILE_SIZE) {
      return { error: "File too large. Maximum size is 5MB." };
    }

    const ext = filename.split(".").pop() || "jpg";
    const savedFilename = `${randomUUID()}.${ext}`;
    const uploadDir = join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });

    const filePath = join(uploadDir, savedFilename);
    await writeFile(filePath, buffer);

    return { url: `/uploads/${savedFilename}` };
  } catch (err: any) {
    console.error("[upload-action] Error:", err);
    return { error: "Failed to upload: " + (err.message || String(err)) };
  }
};

