const DOCUMENT_SANDBOX = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

export function documentContentHeaders(input: {
  mediaType: string;
  byteSize: number;
  fileName: string;
  fallbackName: string;
}): Record<string, string> {
  const encodedName = encodeURIComponent(input.fileName.replaceAll(/[\r\n]/g, "_"));
  return {
    "Content-Type": input.mediaType || "application/octet-stream",
    "Content-Length": String(input.byteSize),
    "Content-Disposition": `inline; filename="${input.fallbackName}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": DOCUMENT_SANDBOX,
  };
}
