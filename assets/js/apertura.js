// Prima schermata (hero): un'opera alla volta su una parete scura, illuminata da una lampada radente.
//
// Qui sta la regia: l'opera adattata al riquadro deciso dal CSS, lo strato statico sempre presente (due <img> A/B
// che si alternano in dissolvenza), il bottone trasparente sul quadro, il cartellino, i comandi ‹ ❙❙ ›,
// l'avanzamento automatico e le sue pause. Il motore WebGL (apertura3d.js) è facoltativo: si scarica solo se il
// dispositivo lo regge e disegna sopra lo strato statico, allineato al pixel; se si guasta resta lo strato statico,
// già sull'opera giusta.
//
// Contratto con main.js: avvia({ radice, palco, opere, immagineRiserva, suApri }) → { sospendi(bool), ferma() }
import { rigaCartellino } from './testi.js?v=3';

const PERMANENZA = 9000;      // ms: quanto resta ogni opera prima di passare alla successiva
const DOPO_COMANDO = 6000;    // ms in più dopo ‹ › o uno scorrimento del dito
const DISSOLVENZA = 1200;     // ms: cambio d'opera senza WebGL, l'una sparisce e l'altra entra (vedi apertura.css)
const SOGLIA_DITO = 50;       // px di scorrimento orizzontale per cambiare opera sul telefono

// Attributi del contesto WebGL: niente canale alfa né profondità (la scena è disegnata in ordine), niente MSAA.
const CONTESTO = { alpha: false, depth: false, stencil: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' };

const due = (n) => String(n).padStart(2, '0');

// «Painter · Visual Artist · Storyteller» → gruppi che non si spezzano, così nessuna parola resta orfana.
function dividiProfessione(radice) {
  const p = radice.querySelector('.apertura__professione');
  const testo = p?.textContent.trim() || '';
  if (!testo.includes('·') || p.childElementCount) return;
  const parti = testo.split('·').map((s) => s.trim()).filter(Boolean);
  p.replaceChildren(...parti.flatMap((parte, i) => {
    const gruppo = document.createElement('span');
    gruppo.className = 'apertura__gruppo';
    gruppo.textContent = i < parti.length - 1 ? `${parte} ·` : parte;
    return i ? [' ', gruppo] : [gruppo];
  }));
}

// Il motore WebGL si scarica solo se servirà davvero e il dispositivo lo regge.
function motoreConsentito(ridotto) {
  if (ridotto) return false;
  const rete = navigator.connection;
  if (rete?.saveData) return false;
  if (/(^|-)2g$|^3g$/.test(rete?.effectiveType || '')) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 2) return false;
  return 'WebGL2RenderingContext' in window;
}

function nuovaImmagine() {
  const img = document.createElement('img');
  img.className = 'apertura__quadro';
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  return img;
}

export function avvia({ radice, palco, opere = [], immagineRiserva = null, suApri } = {}) {
  const nulla = { sospendi() {}, ferma() {} };
  const riquadro = palco?.querySelector('[data-riquadro]');
  if (!radice || !riquadro) return nulla;
  const $ = (sel) => palco.querySelector(sel);
  const cartellino = $('[data-cartellino]');
  const didascalia = $('[data-didascalia]');
  const titolo = $('[data-cartellino-titolo]');
  const dati = $('[data-cartellino-dati]');
  const conta = $('[data-cartellino-conta]');
  const comandi = $('[data-comandi]');
  const tastoPrec = $('[data-prec]');
  const tastoPausa = $('[data-pausa]');
  const tastoSucc = $('[data-succ]');
  const ridotto = matchMedia('(prefers-reduced-motion: reduce)');

  dividiProfessione(radice);
  const imgA = nuovaImmagine();
  const imgB = nuovaImmagine();
  imgA.fetchPriority = 'high';               // la prima opera è l'immagine principale della pagina
  riquadro.replaceChildren(imgA, imgB);

  // ---------------------------------------------------------------- nessuna opera: immagine di riserva o niente
  const elenco = opere.filter((o) => o?.immagine?.miniatura);
  if (!elenco.length) {
    if (cartellino) cartellino.hidden = true;
    if (!immagineRiserva?.miniatura) { palco.hidden = true; return nulla; }
    imgA.src = immagineRiserva.miniatura;
    imgA.classList.add('attiva');
    return { sospendi() {}, ferma() { riquadro.replaceChildren(); } };
  }

  const n = elenco.length;
  const bersaglio = document.createElement('button');
  bersaglio.type = 'button';
  bersaglio.className = 'apertura__bersaglio';
  riquadro.append(bersaglio);
  if (n < 2 && comandi) comandi.hidden = true;

  let indice = 0;              // opera richiesta (verso cui si sta andando)
  let mostrata = -1;           // opera nello strato statico e nel cartellino
  let attiva = imgA;           // <img> visibile
  let motore = null;           // motore WebGL, quando è acceso
  let fermato = false;
  const rapporti = new Map();  // id opera → larghezza / altezza della foto

  const rapporto = (o) => rapporti.get(o.id)
    || (o.immagine.larghezza && o.immagine.altezza ? o.immagine.larghezza / o.immagine.altezza : 0.8);

  // ---------------------------------------------------------------- impaginazione

  // Allineamento dell'opera nel riquadro, letto da object-position in apertura.css (es. «50% 100%»).
  function allineamento() {
    const p = getComputedStyle(imgA).objectPosition.split(' ');
    const v = (s) => (s?.endsWith('%') ? parseFloat(s) / 100 : 0.5);
    return [v(p[0]), v(p[1])];
  }

  // Rettangolo dell'opera nel riquadro, come lo calcola il browser per object-fit: contain.
  function misura(r) {
    const b = riquadro.getBoundingClientRect();
    const [ax, ay] = allineamento();
    let w = b.width;
    let h = w / r;
    if (h > b.height) { h = b.height; w = h * r; }
    return { x: (b.width - w) * ax, y: (b.height - h) * ay, w, h, b };
  }

  // Per il motore: il rettangolo dell'opera rispetto alla sezione (px CSS).
  function rettangolo(r) {
    const q = misura(r);
    const s = radice.getBoundingClientRect();
    return { x: q.b.left - s.left + q.x, y: q.b.top - s.top + q.y, w: q.w, h: q.h };
  }

  // Per il motore: la zona occupata davvero dal testo (righe e pulsanti, non la colonna intera),
  // che la luce lascia scura.
  function zonaTesto() {
    const testo = radice.querySelector('.apertura__testo');
    if (!testo) return null;
    const s = radice.getBoundingClientRect();
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const unisci = (r) => {
      if (!r.width || !r.height) return;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    };
    const tratto = document.createRange();
    const giro = document.createTreeWalker(testo, NodeFilter.SHOW_TEXT);
    while (giro.nextNode()) {
      if (!giro.currentNode.textContent.trim()) continue;
      tratto.selectNodeContents(giro.currentNode);
      for (const r of tratto.getClientRects()) unisci(r);
    }
    for (const b of testo.querySelectorAll('a, button')) unisci(b.getBoundingClientRect());
    return x0 < x1 ? { x: x0 - s.left, y: y0 - s.top, w: x1 - x0, h: y1 - y0 } : null;
  }

  function disponi() {
    if (mostrata < 0) return;
    const q = misura(rapporto(elenco[mostrata]));
    for (const [k, v] of [['--qx', q.x], ['--qy', q.y], ['--qw', q.w], ['--qh', q.h]]) palco.style.setProperty(k, `${v.toFixed(2)}px`);
  }

  function scriviCartellino(i) {
    const o = elenco[i];
    const nome = (o.titolo || '').trim() || 'Untitled';
    titolo.textContent = nome;
    dati.textContent = rigaCartellino(o);
    conta.textContent = `${due(i + 1)} / ${due(n)}`;
    const anno = String(o.anno ?? '').trim();
    bersaglio.setAttribute('aria-label', `View the painting: ${anno ? `${nome}, ${anno}` : nome}`);
  }

  // ---------------------------------------------------------------- strato statico

  const decodifica = (img, url) => {
    if (img.getAttribute('src') !== url) img.src = url;
    return img.decode().catch(() => {});
  };
  const segnaRapporto = (o, img) => { if (img.naturalWidth && img.naturalHeight) rapporti.set(o.id, img.naturalWidth / img.naturalHeight); };

  // Porta lo strato statico (e il cartellino) sull'opera i: in dissolvenza, oppure subito
  // (al buio di un cambio di luce, quando il canvas copre comunque le <img>).
  let gettoneStatico = 0;
  let attesaCartellino = 0;
  function mostraStatico(i, dissolvi, ritardo = 0) {
    const o = elenco[i];
    const t = ++gettoneStatico;
    clearTimeout(attesaCartellino);
    if (!dissolvi) {             // cartellino e bottone subito, la foto appena è decodificata
      mostrata = i;
      scriviCartellino(i);
      disponi();
      // al buio il testo nuovo rientra con la luce, poco dopo
      if (ritardo) attesaCartellino = setTimeout(() => cartellino.classList.remove('cambio'), ritardo);
      else cartellino.classList.remove('cambio');
    } else cartellino.classList.add('cambio');
    if (attiva.getAttribute('src') === o.immagine.miniatura && attiva.classList.contains('attiva')) {
      mostrata = i;
      scriviCartellino(i);
      disponi();
      if (dissolvi) cartellino.classList.remove('cambio');
      return Promise.resolve();
    }
    const nuova = attiva === imgA ? imgB : imgA;
    const attendi = dissolvi ? new Promise((r) => setTimeout(r, 350)) : null;   // il testo del cartellino esce
    return Promise.all([decodifica(nuova, o.immagine.miniatura), attendi]).then(() => {
      if (t !== gettoneStatico || fermato) return;
      segnaRapporto(o, nuova);
      radice.classList.toggle('apertura--subito', !dissolvi || ridotto.matches);
      nuova.classList.add('attiva');
      attiva.classList.remove('attiva');
      attiva = nuova;
      mostrata = i;
      scriviCartellino(i);
      disponi();
      if (dissolvi) cartellino.classList.remove('cambio');
      if (dissolvi && !ridotto.matches) return new Promise((r) => setTimeout(r, DISSOLVENZA));
      return undefined;
    });
  }

  // Precarica la foto (e la texture, se c'è il motore) dell'opera i, una sola alla volta.
  const precaricate = new Set();
  function precarica(i) {
    if (fermato) return;
    const o = elenco[(i + n) % n];
    if (!precaricate.has(o.id)) {
      precaricate.add(o.id);
      const img = new Image();
      img.decoding = 'async';
      img.src = o.immagine.miniatura;
      img.decode().then(() => segnaRapporto(o, img), () => {});
    }
    motore?.precarica(o);
  }

  // ---------------------------------------------------------------- avanzamento automatico e pause

  let pronta = false;          // la prima opera è visibile
  let passi = 0;               // cambi automatici dall'ultimo giro (dopo un giro intero ci si ferma)
  let giroFinito = false;
  let pausaUtente = false;
  let sopra = false;           // puntatore sul quadro o sul cartellino
  let fuoco = false;           // tastiera dentro il quadro o i comandi
  let visibile = true;         // la sezione è sullo schermo
  let sospeso = false;         // visore, lettore o sala aperti (main.js)
  let inCambio = false;
  let timer = 0;
  let partenza = 0;
  let restante = PERMANENZA;
  let attesaPrecarica = 0;

  const automatico = () => n > 1 && !ridotto.matches;
  const inPausa = () => !automatico() || !pronta || giroFinito || pausaUtente || sopra || fuoco
    || !visibile || document.hidden || sospeso || inCambio;
  const disegnabile = () => visibile && !document.hidden && !sospeso;

  function orologio() {
    const ferma = inPausa() || fermato;
    if (ferma && timer) {
      clearTimeout(timer);
      timer = 0;
      restante = Math.max(0, restante - (performance.now() - partenza));
    } else if (!ferma && !timer) {
      partenza = performance.now();
      timer = setTimeout(scadenza, Math.max(restante, 1500));
    }
  }

  function scadenza() {
    timer = 0;
    restante = PERMANENZA;
    passi += 1;
    vai(indice + 1, { verso: 1 });
    if (passi >= n) { giroFinito = true; statoPausa(); }   // giro completo: si resta sulla prima opera
  }

  function statoPausa() {
    const ferma = pausaUtente || giroFinito;
    tastoPausa.setAttribute('aria-pressed', String(ferma));
    tastoPausa.hidden = !automatico();
    // annunciare il cartellino solo quando le opere non scorrono da sole
    didascalia.setAttribute('aria-live', automatico() && !ferma ? 'off' : 'polite');
  }

  function aggiornaDisegno() { motore?.attiva(disegnabile()); }

  // ---------------------------------------------------------------- cambio d'opera

  let gettoneCambio = 0;
  function vai(i, { manuale = false, verso = 1 } = {}) {
    i = (i + n) % n;
    if (i === indice && (inCambio || mostrata === i)) return;
    indice = i;
    if (manuale) {
      passi = 0;
      restante = PERMANENZA + DOPO_COMANDO;
      statoPausa();
    }
    const t = ++gettoneCambio;
    inCambio = true;
    orologio();
    clearTimeout(attesaPrecarica);
    const fatto = motore ? motore.vai(elenco[i], verso) : mostraStatico(i, !ridotto.matches);
    fatto.then(() => {
      if (t !== gettoneCambio || fermato) return;
      if (mostrata !== indice) mostraStatico(indice, false);   // cambio annullato o motore spento a metà
      cartellino.classList.remove('cambio');
      inCambio = false;
      if (!manuale) restante = PERMANENZA;
      attesaPrecarica = setTimeout(() => { if (disegnabile()) precarica(indice + verso); }, 1500);
      orologio();
    });
  }

  // ---------------------------------------------------------------- motore WebGL (facoltativo)

  const callbackMotore = {
    // la luce si abbassa: il testo del cartellino esce con lei
    suSpegni() { cartellino.classList.add('cambio'); },
    // al buio: lo strato statico e il cartellino passano all'opera nuova, invisibili sotto il canvas
    suBuio(opera, r) {
      const i = elenco.indexOf(opera);
      if (i < 0) return;
      if (r) rapporti.set(opera.id, r);
      mostraStatico(i, false, 450);
    },
    // primo fotogramma illuminato: la luce entra, la permanenza riparte da capo
    suPronto() {
      restante = PERMANENZA;
      if (timer) { clearTimeout(timer); timer = 0; }
      orologio();
      // la texture della prossima opera si prepara durante la permanenza, non durante il cambio
      clearTimeout(attesaPrecarica);
      attesaPrecarica = setTimeout(() => { if (disegnabile() && automatico()) precarica(indice + 1); }, 1500);
    },
    // contesto perso, troppo lento, foto mancante: resta lo strato statico, allineato all'opera richiesta
    suGuasto(motivo) {
      if (motivo) console.info(`Hero: static layer only (${motivo})`);
      const m = motore;
      motore = null;
      m?.ferma();
      mostraStatico(indice, false);
    },
  };

  function accendi() {
    if (fermato || motore || !motoreConsentito(ridotto.matches)) return;
    const tela = document.createElement('canvas');
    tela.className = 'apertura__tela';
    tela.setAttribute('aria-hidden', 'true');
    let gl = null;
    try { gl = tela.getContext('webgl2', CONTESTO); } catch { gl = null; }
    if (!gl) return;
    const rilascia = () => { gl.getExtension('WEBGL_lose_context')?.loseContext(); tela.remove(); };
    radice.prepend(tela);
    import('./apertura3d.js?v=3').then(({ creaMotore }) => {
      if (fermato || ridotto.matches) { rilascia(); return; }
      motore = creaMotore({
        radice, tela, contesto: gl, rettangolo, zonaTesto,
        dettaglio: matchMedia('(pointer: fine)').matches && innerWidth >= 900,
        ...callbackMotore,
      });
      motore.attiva(disegnabile());
      motore.vai(elenco[indice], 1);
    }).catch((err) => {
      console.warn('Hero: WebGL engine not available', err);
      motore = null;
      rilascia();
    });
  }

  // ---------------------------------------------------------------- comandi

  // tutti gli ascoltatori si tolgono insieme in ferma()
  const ascolto = new AbortController();
  const conAscolto = { signal: ascolto.signal };

  let dito = null;             // tocco in corso sul quadro
  let ultimoScorrimento = 0;
  bersaglio.addEventListener('click', () => {
    if (performance.now() - ultimoScorrimento < 500) return;   // era uno scorrimento del dito, non un tocco
    if (mostrata >= 0) suApri?.(elenco[mostrata]);
  }, conAscolto);
  tastoPrec.addEventListener('click', () => vai(indice - 1, { manuale: true, verso: -1 }), conAscolto);
  tastoSucc.addEventListener('click', () => vai(indice + 1, { manuale: true, verso: 1 }), conAscolto);
  tastoPausa.addEventListener('click', () => {
    if (pausaUtente || giroFinito) {
      pausaUtente = false;
      giroFinito = false;
      passi = 0;
      restante = Math.min(restante, 2500);
    } else pausaUtente = true;
    statoPausa();
    orologio();
  }, conAscolto);
  palco.addEventListener('keydown', (e) => {
    if (n < 2 || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); vai(indice - 1, { manuale: true, verso: -1 }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); vai(indice + 1, { manuale: true, verso: 1 }); }
  }, conAscolto);

  // pausa col puntatore sopra il quadro o il cartellino, e con la tastiera dentro
  const suEntra = (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') { sopra = true; orologio(); } };
  const suEsce = (e) => {
    if (!sopra || palco.contains(e.relatedTarget)) return;
    sopra = false;
    restante = Math.max(restante, 2500);
    orologio();
  };
  for (const zona of [riquadro, cartellino]) {
    zona.addEventListener('pointerenter', suEntra, conAscolto);
    zona.addEventListener('pointerleave', suEsce, conAscolto);
  }
  // solo il fuoco da tastiera: un clic col mouse su ‹ › non deve fermare lo scorrimento per sempre
  palco.addEventListener('focusin', (e) => { fuoco = !!e.target.matches?.(':focus-visible'); orologio(); }, conAscolto);
  palco.addEventListener('focusout', (e) => {
    if (palco.contains(e.relatedTarget)) return;
    fuoco = false;
    restante = Math.max(restante, 2500);
    orologio();
  }, conAscolto);

  // scorrimento orizzontale del dito sul quadro (lo scorrimento verticale resta alla pagina: touch-action pan-y)
  riquadro.addEventListener('pointerdown', (e) => {
    dito = e.pointerType === 'touch' && n > 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  }, conAscolto);
  riquadro.addEventListener('pointerup', (e) => {
    if (!dito || e.pointerId !== dito.id) return;
    const dx = e.clientX - dito.x;
    const dy = e.clientY - dito.y;
    dito = null;
    if (Math.abs(dx) < SOGLIA_DITO || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    ultimoScorrimento = performance.now();
    const verso = dx < 0 ? 1 : -1;
    vai(indice + verso, { manuale: true, verso });
  }, conAscolto);
  riquadro.addEventListener('pointercancel', () => { dito = null; }, conAscolto);

  // ---------------------------------------------------------------- visibilità, dimensioni, preferenze

  const osservatore = new IntersectionObserver(([r]) => {
    visibile = r.isIntersecting;
    orologio();
    aggiornaDisegno();
  });
  osservatore.observe(radice);
  const suVisibilita = () => { orologio(); aggiornaDisegno(); };
  document.addEventListener('visibilitychange', suVisibilita, conAscolto);

  const ridimensiona = new ResizeObserver(() => { disponi(); motore?.ridimensiona(); });
  ridimensiona.observe(radice);
  ridimensiona.observe(riquadro);
  const blocco = radice.querySelector('.apertura__testo');
  if (blocco) ridimensiona.observe(blocco);   // il testo cambia misura quando arrivano i caratteri

  // chi chiede meno movimento mentre la pagina è aperta: niente WebGL né avanzamento automatico
  const suPreferenza = () => {
    if (ridotto.matches && motore) callbackMotore.suGuasto('');
    statoPausa();
    orologio();
  };
  ridotto.addEventListener?.('change', suPreferenza, conAscolto);

  // ---------------------------------------------------------------- partenza

  statoPausa();
  const prima = elenco[0];
  imgA.src = prima.immagine.miniatura;
  imgA.classList.add('attiva');
  mostrata = 0;
  scriviCartellino(0);
  disponi();
  radice.classList.add('apertura--subito');
  imgA.decode().catch(() => {}).then(() => {
    if (fermato) return;
    segnaRapporto(prima, imgA);
    disponi();
    radice.classList.add('apertura--pronta');
    pronta = true;
    orologio();
    // il motore e la foto successiva arrivano dopo la prima opera, quando il browser è libero
    const poi = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    poi(() => { accendi(); if (disegnabile() && automatico()) precarica(1); }, { timeout: 2000 });
  });

  return {
    sospendi(si) {
      sospeso = !!si;
      orologio();
      aggiornaDisegno();
    },
    ferma() {
      if (fermato) return;
      fermato = true;
      clearTimeout(timer);
      clearTimeout(attesaPrecarica);
      osservatore.disconnect();
      ridimensiona.disconnect();
      clearTimeout(attesaCartellino);
      ascolto.abort();
      motore?.ferma();
      motore = null;
    },
  };
}
