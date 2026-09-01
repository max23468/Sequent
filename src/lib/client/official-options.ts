export interface OfficialChoiceOption {
  value: string;
  label: string;
}

export async function loadOfficialChoiceOptions(
  parameters: URLSearchParams,
): Promise<OfficialChoiceOption[]> {
  const response = await fetch(`/api/official-options?${parameters.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OFFICIAL_OPTIONS_${response.status}`);
  const payload = (await response.json()) as { options?: OfficialChoiceOption[] };
  return payload.options ?? [];
}
