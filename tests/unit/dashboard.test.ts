import { describe, expect, it } from "vitest";
import { createDashboardVerificationItems } from "../../src/lib/dashboard.ts";

describe("Dashboard operativa", () => {
  it("limita le righe senza nascondere errori tecnici e revisioni pendenti", () => {
    const practices = Array.from({ length: 6 }, (_, index) => ({
      id: `practice-${index}`,
      title: `Pratica ${index}`,
    }));
    const items = createDashboardVerificationItems({
      practices,
      domainSummaries: practices.map((practice) => ({
        practiceId: practice.id,
        nextStep: "Completa la pratica",
        label: "Da completare",
      })),
      pendingReviews: [
        {
          id: "review-1",
          practiceId: "practice-1",
          practiceTitle: "Pratica 1",
          documentName: "Documento.pdf",
          label: "Conferma il dato",
          method: "ocr",
        },
      ],
      failedVerifications: [
        {
          jobId: "job-1",
          practiceId: "practice-2",
          practiceTitle: "Pratica 2",
          documentId: "document-1",
          documentName: "Allegato.pdf",
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "failed-job-1",
      "review-review-1",
      "domain-practice-0",
      "domain-practice-1",
    ]);
  });
});
