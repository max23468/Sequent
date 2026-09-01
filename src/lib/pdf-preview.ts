export async function createPdfPreviewUrl(resourceUrl: string, signal: AbortSignal) {
  const response = await fetch(resourceUrl, { signal });
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (!response.ok || mediaType !== "application/pdf") throw new Error("PDF_PREVIEW_UNAVAILABLE");
  return URL.createObjectURL(await response.blob());
}
