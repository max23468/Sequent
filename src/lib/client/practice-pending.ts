export function setPracticePending(pending: boolean, practicePage?: HTMLElement | null) {
  const root = practicePage ?? document.querySelector<HTMLElement>(".practice-page");
  if (!root) return;
  root.inert = pending;
  if (pending) root.setAttribute("aria-busy", "true");
  else root.removeAttribute("aria-busy");
}
