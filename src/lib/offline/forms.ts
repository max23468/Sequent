import { isServerReachable, queueFieldForm } from "./manager";
import { getOfflinePractice } from "./store";

function setPracticeSubmissionPending(form: HTMLFormElement, pending: boolean) {
  const practicePage = form.closest<HTMLElement>(".practice-page");
  if (!practicePage) return;
  practicePage.inert = pending;
  if (pending) practicePage.setAttribute("aria-busy", "true");
  else practicePage.removeAttribute("aria-busy");
}

export async function interceptOfflinePracticeForm(
  event: SubmitEvent,
  practiceId: string,
): Promise<string | null> {
  const form = event.target;
  if (
    !(form instanceof HTMLFormElement) ||
    form.action.endsWith("/logout") ||
    form.action.includes("/upload")
  )
    return null;

  const submittedData = new FormData(form, event.submitter);
  const includesFile = Array.from(submittedData.values()).some(
    (value) => value instanceof File && value.size > 0,
  );
  if (includesFile && navigator.onLine) return null;

  event.preventDefault();
  setPracticeSubmissionPending(form, true);
  let navigationStarted = false;
  try {
    if (await isServerReachable()) {
      const submittedForm = document.createElement("form");
      submittedForm.method = form.method;
      submittedForm.action = form.action;
      submittedForm.enctype = form.enctype;
      submittedForm.hidden = true;
      for (const [name, value] of submittedData) {
        if (typeof value !== "string") continue;
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = name;
        hidden.value = value;
        submittedForm.append(hidden);
      }
      document.body.append(submittedForm);
      navigationStarted = true;
      submittedForm.submit();
      return null;
    }

    const offlinePractice = await getOfflinePractice(practiceId);
    if (offlinePractice?.status !== "complete")
      return "Questa pratica non è stata preparata per le modifiche offline.";
    if (!form.action.includes("/saveFields"))
      return "Questa funzione richiede la connessione. I dati già conservati offline non sono stati modificati.";

    const queued = await queueFieldForm(practiceId, form);
    window.dispatchEvent(new Event("sequent:offline-queue"));
    return queued
      ? "Modifica conservata sul dispositivo e in attesa di sincronizzazione."
      : "Non è stato possibile conservare questa modifica offline.";
  } finally {
    if (!navigationStarted) setPracticeSubmissionPending(form, false);
  }
}
