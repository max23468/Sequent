import { error, redirect } from "@sveltejs/kit";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";
import { documentContentHeaders } from "$lib/document-content-headers";
import { resolveBlobPath } from "$lib/server/blob-store";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";

export const GET: RequestHandler = ({ locals, params }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const attachment = openDatabase()
    .prepare(
      `SELECT prepared_name, format, byte_size, blob_path
       FROM official_attachments WHERE id = ?`,
    )
    .get(params.id) as
    | { prepared_name: string; format: string; byte_size: number; blob_path: string }
    | undefined;
  if (!attachment) error(404, "Allegato non trovato");
  const stream = Readable.toWeb(
    createReadStream(resolveBlobPath(getDataDirectory(), attachment.blob_path)),
  );
  return new Response(stream as ReadableStream, {
    headers: documentContentHeaders({
      mediaType: attachment.format === "PDF/A-1b" ? "application/pdf" : "image/tiff",
      byteSize: attachment.byte_size,
      fileName: attachment.prepared_name,
      fallbackName: "allegato",
    }),
  });
};
