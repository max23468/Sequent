const closingAttribute = "data-closing";

function motionIsReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function closeDialog(dialog?: HTMLDialogElement, returnValue = "") {
  if (!dialog?.open || dialog.hasAttribute(closingAttribute)) return;
  if (motionIsReduced()) {
    dialog.close(returnValue);
    return;
  }

  dialog.setAttribute(closingAttribute, "");
  await new Promise<void>((resolve) => {
    const fallback = window.setTimeout(resolve, 220);
    dialog.addEventListener(
      "animationend",
      (event) => {
        if (event.target !== dialog) return;
        window.clearTimeout(fallback);
        resolve();
      },
      { once: true },
    );
  });
  dialog.close(returnValue);
  dialog.removeAttribute(closingAttribute);
}

export function dialogMotion(dialog: HTMLDialogElement) {
  const handleCancel = (event: Event) => {
    event.preventDefault();
    void closeDialog(dialog);
  };
  dialog.addEventListener("cancel", handleCancel);
  return {
    destroy() {
      dialog.removeEventListener("cancel", handleCancel);
    },
  };
}
