import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PutResult, PutOptions } from "./index";

const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION;

if (!bucket) {
  // We'll still export functions but runtime will error if bucket is missing when used.
}

function s3Client() {
  return new S3Client({ region });
}

export async function putFile(key: string, data: ArrayBuffer | Buffer, opts?: PutOptions): Promise<PutResult> {
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");

  const client = s3Client();
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const contentType = opts?.contentType ?? "application/octet-stream";

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ACL: opts?.public ? "public-read" : undefined,
    ContentType: contentType,
  });

  await client.send(command);

  // Construct a public URL. This works for most S3 buckets but may differ if you use a custom domain or
  // a different S3-compatible provider.
  const regionPart = region ? `.${region}` : "";
  const url = `https://${bucket}.s3${regionPart}.amazonaws.com/${encodeURIComponent(key)}`;

  return { url };
}
