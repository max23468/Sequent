import { error, redirect } from "@sveltejs/kit";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";
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
  const encodedName = encodeURIComponent(document.originalName.replaceAll(/[\r\n]/g, "_"));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": document.mediaType || "application/octet-stream",
      "Content-Length": String(document.byteSize),
      "Content-Disposition": `inline; filename="documento"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    },
  });
};
