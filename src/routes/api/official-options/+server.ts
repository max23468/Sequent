import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  getCatalogField,
  listOfficialChoiceOptions,
} from "../../../domain/official-catalog/catalog.ts";

export const GET: RequestHandler = ({ locals, url }) => {
  if (!locals.ownerId) error(401, "Accesso richiesto");
  const fieldId = url.searchParams.get("fieldId")?.trim() ?? "";
  const field = getCatalogField(fieldId);
  if (!field || field.control !== "combobox") error(404, "Elenco ufficiale non disponibile");
  const options = listOfficialChoiceOptions(fieldId, {
    query: url.searchParams.get("query") ?? "",
    provinceCode: url.searchParams.get("province") ?? "",
    effectiveDate: url.searchParams.get("date") ?? "",
    limit: 60,
  });
  return json(
    { options },
    {
      headers: {
        "cache-control": "private, max-age=300",
      },
    },
  );
};
