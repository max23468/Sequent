export interface DashboardVerificationItem {
  id: string;
  href: string;
  title: string;
  detail: string;
}

export function createDashboardVerificationItems(
  input: {
    practices: Array<{ id: string; title: string }>;
    domainSummaries: Array<{
      practiceId: string;
      nextStep: string;
      label: string;
    }>;
    pendingReviews: Array<{
      id: string;
      practiceId: string;
      practiceTitle: string;
      documentName: string | null;
      label: string;
      method: string;
    }>;
    failedVerifications: Array<{
      jobId: string;
      practiceId: string;
      practiceTitle: string;
      documentId: string;
      documentName: string;
    }>;
  },
  limit = 4,
): DashboardVerificationItem[] {
  const practiceTitles = new Map(input.practices.map((practice) => [practice.id, practice.title]));
  const domainItems = input.domainSummaries.flatMap((summary) => {
    const practiceTitle = practiceTitles.get(summary.practiceId);
    if (!practiceTitle) return [];
    return [
      {
        id: `domain-${summary.practiceId}`,
        href: `/pratiche/${summary.practiceId}?sezione=overview`,
        title: summary.nextStep,
        detail: `${practiceTitle} · ${summary.label}`,
      },
    ];
  });
  const reviewItems = input.pendingReviews.map((review) => ({
    id: `review-${review.id}`,
    href: `/pratiche/${review.practiceId}?sezione=verifications&verifica=${review.id}`,
    title: review.label,
    detail: `${review.documentName ?? "Senza documento"} · ${review.practiceTitle} · ${review.method === "codex" ? "Codex" : review.method === "ocr" ? "OCR" : review.method}`,
  }));
  const failedItems = input.failedVerifications.map((verification) => ({
    id: `failed-${verification.jobId}`,
    href: `/pratiche/${verification.practiceId}?sezione=documents&documento=${verification.documentId}`,
    title: "Verifica tecnica non riuscita",
    detail: `${verification.documentName} · ${verification.practiceTitle}`,
  }));

  return [...failedItems, ...reviewItems, ...domainItems].slice(0, limit);
}
