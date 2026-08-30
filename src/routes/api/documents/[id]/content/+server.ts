import { error, redirect } from "@sveltejs/kit";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";
import { documentContentHeaders } from "$lib/document-content-headers";
import { resolveBlobPath } from "$lib/server/blob-store";
import { getDataDirectory } from "$lib/server/config";
import { getDocument } from "$lib/server/documents";
import { openDatabase } from "$lib/server/database";

export const GET: RequestHandler = ({ locals, params }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const document = getDocument(openDatabase(), params.id);
  if (!document) error(404, "Documento non trovato");
  const stream = Readable.toWeb(
    createReadStream(resolveBlobPath(getDataDirectory(), document.blobPath)),
  );
  return new Response(stream as ReadableStream, {
    headers: documentContentHeaders({
      mediaType: document.mediaType,
      byteSize: document.byteSize,
      fileName: document.originalName,
      fallbackName: "documento",
    }),
  });
};
