// Prima schermata — versione provvisoria (verrà sostituita): mostra la prima opera scelta come immagine statica.
// Contratto con main.js: avvia({ radice, palco, opere, immagineRiserva, suApri }) → { sospendi(bool), ferma() }
import { rigaCartellino } from './testi.js?v=3';

export function avvia({ palco, opere, immagineRiserva, suApri }) {
  const prima = opere[0];
  const img = prima?.immagine || immagineRiserva;
  if (!img) return { sospendi() {}, ferma() {} };
  const foto = document.createElement('img');
  foto.src = img.miniatura;
  foto.alt = prima ? prima.titolo || 'Untitled' : '';
  foto.className = 'apertura__poster';
  palco.replaceChildren(foto);
  if (prima) {
    const didascalia = document.createElement('p');
    didascalia.className = 'apertura__didascalia';
    didascalia.textContent = `${prima.titolo || 'Untitled'} — ${rigaCartellino(prima)}`;
    palco.append(didascalia);
    foto.addEventListener('click', () => suApri?.(prima));
  }
  return { sospendi() {}, ferma() { palco.replaceChildren(); } };
}
