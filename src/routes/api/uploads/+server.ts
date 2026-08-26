import { error, json, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { createUploadSession } from "$lib/server/resumable-uploads";

const requestSchema = z
  .object({
    practiceId: z.string().uuid().optional(),
    newPracticeTitle: z.string().trim().min(1).max(120).optional(),
    originalName: z.string().trim().min(1).max(255),
    mediaType: z.string().max(200),
    totalSize: z.number().int().positive(),
  })
  .refine((value) => Boolean(value.practiceId) !== Boolean(value.newPracticeTitle));

export const POST: RequestHandler = async ({ locals, request, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (request.headers.get("origin") !== url.origin) error(403, "Origine non valida");
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) error(400, "Richiesta di caricamento non valida");
  try {
    const session = await createUploadSession(openDatabase(), getDataDirectory(), parsed.data);
    return json(
      { id: session.id, offset: session.receivedSize, totalSize: session.totalSize },
      { status: 201 },
    );
  } catch (uploadError) {
    const code = uploadError instanceof Error ? uploadError.message : "UPLOAD_FAILED";
    if (code === "FILE_TOO_LARGE") error(413, "Il documento supera 250 MB");
    if (code === "PRACTICE_NOT_FOUND") error(404, "Pratica non trovata");
    error(400, "Impossibile iniziare il caricamento");
  }
};
