/** Shows a red toast in the Command Center. Safe to call from anywhere in the browser. */
export function toastError(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>("jarvis:toast", { detail: message }));
}
