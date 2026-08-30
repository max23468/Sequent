import { error } from "@sveltejs/kit";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";
import { resolveBlobPath } from "$lib/server/blob-store";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { getOfficialArtifact } from "$lib/server/official-flow";

export const GET: RequestHandler = ({ locals, params }) => {
  if (!locals.ownerId) error(401, "Accesso richiesto");
  const artifact = getOfficialArtifact(openDatabase(), params.artifactId, params.id);
  if (!artifact) error(404, "File non trovato");
  const stream = Readable.toWeb(
    createReadStream(resolveBlobPath(getDataDirectory(), artifact.blobPath)),
  ) as ReadableStream;
  const safeName = artifact.originalName.replaceAll(/[\r\n"\\/]/gu, "-");
  const asciiName = safeName.replaceAll(/[^\x20-\x7e]/gu, "_");
  return new Response(stream, {
    headers: {
      "content-type": artifact.mediaType,
      "content-length": String(artifact.byteSize),
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "cache-control": "private, no-store",
    },
  });
};
