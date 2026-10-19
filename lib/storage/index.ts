export type PutResult = { url: string };

export type PutOptions = {
  contentType?: string;
  public?: boolean;
};

export async function putFile(name: string, data: ArrayBuffer | Buffer, opts?: PutOptions): Promise<PutResult> {
  const provider = process.env.STORAGE_PROVIDER || "local";

  if (provider === "s3") {
    const { putFile: s3Put } = await import("./s3");
    return s3Put(name, data, opts);
  }

  // default to local
  const { putFile: localPut } = await import("./local");
  return localPut(name, data, opts);
}
