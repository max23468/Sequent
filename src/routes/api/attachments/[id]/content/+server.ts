import { error, redirect } from "@sveltejs/kit";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";
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
  const encodedName = encodeURIComponent(attachment.prepared_name.replaceAll(/[\r\n]/g, "_"));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": attachment.format === "PDF/A-1b" ? "application/pdf" : "image/tiff",
      "Content-Length": String(attachment.byte_size),
      "Content-Disposition": `inline; filename="allegato"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    },
  });
};
