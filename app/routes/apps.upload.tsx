import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return { error: "No file provided" };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { error: "File too large. Maximum size is 5MB." };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { error: "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "jpg";
  const filename = `${randomUUID()}.${ext}`;
  const tmpDir = join(tmpdir(), "shopify-uploads");
  await mkdir(tmpDir, { recursive: true });

  const filePath = join(tmpDir, filename);
  await writeFile(filePath, buffer);

  return { url: `/uploads/${filename}` };
};
