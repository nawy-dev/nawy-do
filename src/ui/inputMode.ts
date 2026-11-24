/**
 * Remembers how the person last interacted (`data-input` on <html>): `pointer` after a touch or a
 * click, `keys` after a key press. The focus ring is for keyboards, so CSS hides it in `pointer`
 * mode: without this, closing a task's sheet hands focus back to the row and a square outline
 * stays around it until the next tap elsewhere (seen on an Android phone).
 */
export function watchInputMode(doc: Document = document): () => void {
  const root = doc.documentElement;
  const pointer = () => {
    root.dataset.input = 'pointer';
  };
  const keys = () => {
    root.dataset.input = 'keys';
  };
  doc.addEventListener('pointerdown', pointer, true);
  doc.addEventListener('keydown', keys, true);
  return () => {
    doc.removeEventListener('pointerdown', pointer, true);
    doc.removeEventListener('keydown', keys, true);
  };
}
