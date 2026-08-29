export interface SearchResult {
  kind: "practice" | "document" | "subject" | "asset";
  id: string;
  practiceId: string;
  label: string;
  context: string;
  href: string;
}

export async function searchSequent(query: string): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const payload = (await response.json()) as { results: Omit<SearchResult, "href">[] };
  return payload.results.map((result) => ({
    ...result,
    href: `/pratiche/${result.practiceId}${
      result.kind === "document"
        ? `?sezione=documents&documento=${result.id}`
        : result.kind === "subject"
          ? "?sezione=people"
          : result.kind === "asset"
            ? "?sezione=estate"
            : ""
    }`,
  }));
}
