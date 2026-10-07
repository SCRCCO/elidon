// Misure reali delle opere, condivise da sito, prima schermata e galleria 3D (nessuna dipendenza da three).

const limita = (v, a, b) => Math.min(b, Math.max(a, v));

// Numeri presenti nel testo «Dimensioni» (es. «200 × 150 cm», «44,5x58 cm»), in centimetri. [] se assenti.
export function numeriDimensioni(testo) {
  const t = String(testo || '');
  let numeri = (t.replace(/(\d),(\d)/g, '$1.$2').match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => n > 0).slice(0, 2);
  if (/\bmm\b/i.test(t)) numeri = numeri.map((n) => n / 10);
  else if (/\d\s*m\b/i.test(t) && !/cm/i.test(t)) numeri = numeri.map((n) => n * 100);
  return numeri;
}

// Dimensioni reali dell'opera in metri: il lato lungo viene dal testo «Dimensioni», le proporzioni dalla foto
// (l'ordine base × altezza nel testo non è affidabile). Senza dimensioni il lato lungo vale 1 m.
export function misureOpera(opera, rapportoFoto) {
  const img = opera.immagine || {};
  const rapporto = rapportoFoto || (img.larghezza && img.altezza ? img.larghezza / img.altezza : 0.8);
  const numeri = numeriDimensioni(opera.dimensioni);
  const lato = limita(numeri.length ? Math.max(...numeri) / 100 : 1, 0.25, 4.6);
  const m = rapporto >= 1 ? { w: lato, h: lato / rapporto } : { w: lato * rapporto, h: lato };
  if (m.h > 3.4) { m.w *= 3.4 / m.h; m.h = 3.4; }
  return m;
}

// true se il testo «Dimensioni» contiene davvero delle misure (serve per disegni in scala).
export function haDimensioni(opera) {
  return numeriDimensioni(opera?.dimensioni).length > 0;
}
