// Testi condivisi dal sito pubblico (in italiano).
// La tecnica si mostra esattamente come il proprietario la scrive nel pannello.

export function tecnicaInglese(tecnica) {
  // Nome storico: il sito non traduce più le tecniche, le mostra come sono scritte.
  return typeof tecnica === 'string' ? tecnica.trim() : '';
}

// Riga «anno · tecnica · misure» come su un cartellino da museo (vuoti esclusi).
export function rigaCartellino(opera) {
  return [opera?.anno, opera?.tecnica, opera?.dimensioni]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}
