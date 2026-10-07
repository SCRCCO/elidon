// Testi condivisi dal sito pubblico (in inglese).
// Il proprietario scrive le tecniche in italiano nel pannello; qui vengono mostrate in inglese.
// I dati salvati non cambiano: una frase che non è in elenco viene mostrata così com'è.

const TECNICHE = {
  'olio su tela': 'Oil on canvas',
  'olio su carta': 'Oil on paper',
  'olio su mdf': 'Oil on MDF',
  'olio su legno': 'Oil on wood',
  'olio su tavola': 'Oil on panel',
  'olio su multistrato': 'Oil on plywood',
  'olio su bambù': 'Oil on bamboo',
  'olio su bambu': 'Oil on bamboo',
  'olio su tela incollata': 'Oil on canvas, mounted',
  'olio su tela incollata su legno': 'Oil on canvas mounted on wood',
  'olio su tela cartonata': 'Oil on canvas board',
  'acrilico su tela': 'Acrylic on canvas',
  'acrilico su carta': 'Acrylic on paper',
  'tecnica mista su tela': 'Mixed media on canvas',
  'tecnica mista su tavola': 'Mixed media on panel',
  'tecnica mista su carta': 'Mixed media on paper',
  'collage e olio su mdf': 'Collage and oil on MDF',
  'smalto su vetro intagliato su legno': 'Enamel on carved glass on wood',
  'pane a legno': 'Bread on wood',
  'corna animali, vetroresina, legno': 'Animal horns, fibreglass, wood',
  'miele, macerie, chiodi da muratore, vetro e legno': 'Honey, rubble, masonry nails, glass and wood',
  'miele, macerie, carta da gioco, vetro e legno': 'Honey, rubble, playing card, glass and wood',
  'sigarette, miele, sapone di marsiglia, vetro e legno': 'Cigarettes, honey, Marseille soap, glass and wood',
  'installazione: scarpe, erba, crocefisso, scritta sul muro': 'Installation: shoes, grass, crucifix, writing on the wall',
};

export function tecnicaInglese(tecnica) {
  const t = typeof tecnica === 'string' ? tecnica.trim() : '';
  return TECNICHE[t.toLowerCase().replace(/\s+/g, ' ')] || t;
}

// Riga «anno · tecnica · misure» come su un cartellino da museo (vuoti esclusi).
export function rigaCartellino(opera) {
  return [opera?.anno, tecnicaInglese(opera?.tecnica), opera?.dimensioni]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}
