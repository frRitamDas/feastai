import fs from "fs";
import path from "path";
import { PutResult, PutOptions } from "./index";

const uploadsDir = path.join(process.cwd(), "public", "uploads");

async function ensureDir() {
  try {
    await fs.promises.mkdir(uploadsDir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

export async function putFile(name: string, data: ArrayBuffer | Buffer, opts?: PutOptions): Promise<PutResult> {
  await ensureDir();

  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dest = path.join(uploadsDir, safeName);

  await fs.promises.writeFile(dest, buf);

  // Public URL will be served from /uploads/<name>
  const url = `/uploads/${encodeURIComponent(safeName)}`;
  return { url };
}
