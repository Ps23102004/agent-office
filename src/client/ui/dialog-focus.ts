import { modalOpen } from './dom';

/** Our small social windows keep Tab inside, and return focus when put away. */
export function focusDialog(el: HTMLElement, first?: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const controls = () => [...el.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')].filter((n) => !n.closest('[hidden], .hidden'));
  const onKey = (e: KeyboardEvent) => {
    // Another window may have opened over this one.
    if (e.key !== 'Tab' || el.closest('.backdrop') !== document.querySelector('#modal-root > .backdrop:last-child')) return;
    const list = controls();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    e.stopPropagation();
    list[at < 0 ? e.shiftKey ? list.length - 1 : 0 : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
  };
  window.addEventListener('keydown', onKey, true);
  (first ?? controls()[0])?.focus();
  return () => {
    window.removeEventListener('keydown', onKey, true);
    if (previous?.isConnected && !modalOpen()) previous.focus();
  };
}
