// Ritratto dell'artista nella prima schermata: sta nel buio della parete, dietro il nome, ed esce dove passa
// la luce. La luce è la stessa lampada che rade il quadro (apertura3d.js): segue il mouse, e quando nessuno lo
// muove torna a posarsi sul volto e vi respira appena. Col dito va da sola.
//
// Niente WebGL: la foto è un <img> con una maschera radiale (alfa = quanta luce arriva), quindi dove la luce
// manca si vede la parete, non un nero diverso.
//
// La foto si dispone sul testo, non sullo schermo: il volto (--volto-x, --volto-y in apertura.css, frazioni
// della foto) sta a destra del nome, e la riga --sopra-testo (qui: la punta dei pennelli) resta appena sopra
// la prima riga di testo, così niente di chiaro passa sotto le parole. Sul volto riposa la luce.
//
// Contratto con apertura.js: creaRitratto({ radice, contenitore, immagine, nome }) → { attiva(bool), ferma() } | null

const ARRIVO = 2.6;           // s: la luce entra da sinistra, come la passata radente sul quadro
const FERMO = 4000;           // ms di mouse fermo prima che la luce torni sul volto
const BUIO = 0.12;            // quanta foto resta visibile dove la luce non arriva (scritto in --buio)
const RAGGIO = 0.4;           // raggio della luce, in diagonali del ritratto
const SPOSTA = 12;            // px: di quanto la foto scorre al contrario del mouse (profondità)
const INGRANDITA = 1.12;      // oltre il «cover»: lascia margine per disporla sul testo e per farla scorrere
const VOLTO_A = 0.74;         // dove sta il volto nel ritratto, in larghezza
const STACCO = 14;            // px fra la riga --sopra-testo e il testo

const limita = (v, a, b) => Math.min(b, Math.max(a, v));
const esce = (t) => 1 - (1 - t) ** 3;
const entraEsce = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const DUE_PI = Math.PI * 2;

export function creaRitratto({ radice, contenitore, immagine, nome = '' } = {}) {
  if (!radice || !contenitore || !immagine?.file) return null;
  const ridotto = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(pointer: fine)').matches;

  const foto = document.createElement('img');
  foto.className = 'apertura__volto';
  foto.alt = nome ? `Portrait of ${nome}` : 'Portrait of the artist';
  foto.draggable = false;
  foto.decoding = 'async';
  // sul telefono basta l'anteprima; a mezza pagina su uno schermo denso serve la foto grande (virgole codificate per srcset)
  if (immagine.miniatura && immagine.miniatura !== immagine.file && immagine.larghezza) {
    const voce = (u) => u.replace(/,/g, '%2C');
    const lato = Math.max(immagine.larghezza, immagine.altezza || 0);
    foto.srcset = `${voce(immagine.miniatura)} ${Math.round((900 * immagine.larghezza) / lato)}w, ${voce(immagine.file)} ${immagine.larghezza}w`;
    foto.sizes = '(min-width: 900px) 50vw, 100vw';
  }
  foto.src = immagine.file;
  contenitore.replaceChildren(foto);

  let fermato = false;
  let pronto = false;          // la foto è decodificata e il contenitore è visibile
  let attivo = false;
  let richiesta = 0;
  let ultimo = -1;
  let tick = 0;
  let T = 0;                   // tempo del respiro (s)
  let entrata = 0;             // 0 → 1 mentre la luce arriva
  let scatola = null;          // rettangolo del contenitore (px, rispetto alla finestra)
  let riposo = [0, 0];         // il volto (px, rispetto al contenitore)
  const posa = { x: 0, y: 0 }; // angolo in alto a sinistra della foto (px, rispetto al contenitore)
  const luce = { x: 0, y: 0, r: 0 };
  const scorri = { x: 0, y: 0 };
  const puntatore = { x: 0, y: 0, sx: 0, sy: 0, peso: 0, voluto: 0, mosso: false, ultimo: -1e9 };
  let scritto = '';

  // Dispone la foto nel contenitore (vedi in cima) e trova il volto.
  function misura() {
    scatola = contenitore.getBoundingClientRect();
    const { width: w, height: h } = scatola;
    if (!w || !h || !foto.naturalWidth) return;
    const stile = getComputedStyle(contenitore);
    const v = (nome, d) => { const n = parseFloat(stile.getPropertyValue(nome)); return Number.isFinite(n) ? n / 100 : d; };
    const vx = v('--volto-x', 0.5);
    const vy = v('--volto-y', 0.4);
    const k = Math.max(w / foto.naturalWidth, h / foto.naturalHeight) * INGRANDITA;
    const fw = foto.naturalWidth * k;
    const fh = foto.naturalHeight * k;
    posa.x = limita(VOLTO_A * w - vx * fw, w - fw, 0);
    // in altezza: la riga --sopra-testo appena sopra il testo; se il ritratto comincia col testo (telefono),
    // il volto accanto al nome, col mento sopra i pulsanti
    const riga = radice.querySelector('.apertura__professione:not(:empty)') || radice.querySelector('.apertura__nome');
    const nomeR = radice.querySelector('.apertura__nome')?.getBoundingClientRect();
    const cima = riga ? riga.getBoundingClientRect().top - scatola.top : 0.5 * h;
    let y = cima > 0.3 * h ? cima - STACCO - v('--sopra-testo', vy) * fh : (nomeR ? nomeR.top - scatola.top : 0.4 * h) - vy * fh;
    const margine = fh - h >= 2 * SPOSTA ? SPOSTA : 0;
    y = limita(y, h - fh + margine, -margine);
    posa.y = y;
    riposo = [posa.x + vx * fw, posa.y + vy * fh];
    foto.style.width = `${fw.toFixed(1)}px`;
    foto.style.height = `${fh.toFixed(1)}px`;
  }

  function scrivi(opacita) {
    const testo = `${luce.x.toFixed(1)}|${luce.y.toFixed(1)}|${luce.r.toFixed(0)}|${opacita.toFixed(3)}|${scorri.x.toFixed(1)}|${scorri.y.toFixed(1)}`;
    if (testo === scritto) return;
    scritto = testo;
    // la maschera si muove con la foto: la lampada va scritta nelle sue coordinate
    const x = posa.x + scorri.x;
    const y = posa.y + scorri.y;
    const s = foto.style;
    s.setProperty('--lx', `${(luce.x - x).toFixed(1)}px`);
    s.setProperty('--ly', `${(luce.y - y).toFixed(1)}px`);
    s.setProperty('--lr', `${luce.r.toFixed(0)}px`);
    s.opacity = opacita.toFixed(3);
    s.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  // Senza movimento: la luce sta ferma sul volto.
  function fermaSulVolto() {
    misura();
    if (!scatola.width || !scatola.height) return;
    [luce.x, luce.y] = riposo;
    luce.r = RAGGIO * Math.hypot(scatola.width, scatola.height);
    scorri.x = scorri.y = 0;
    scrivi(1);
  }

  function aggiorna(dt, ora) {
    const w = scatola.width;
    const h = scatola.height;
    if (!w || !h) return;
    T += dt;
    entrata = Math.min(1, entrata + dt / ARRIVO);
    if (puntatore.mosso) { puntatore.mosso = false; puntatore.ultimo = ora; }
    if (ora - puntatore.ultimo > FERMO) puntatore.voluto = 0;
    puntatore.peso += (puntatore.voluto - puntatore.peso) * (1 - Math.exp(-dt * (puntatore.voluto ? 4 : 0.8)));

    // a riposo la luce respira attorno al volto; col mouse lo segue (anche fuori dalla foto: sul quadro
    // al ritratto arriva solo il riverbero)
    const rx = riposo[0] + 0.05 * w * Math.cos((DUE_PI * T) / 13);
    const ry = riposo[1] + 0.04 * h * Math.sin((DUE_PI * T) / 9 + 0.7);
    const mx = rx + (puntatore.x - scatola.left - rx) * puntatore.peso;
    const my = ry + (puntatore.y - scatola.top - ry) * puntatore.peso;
    const k = 1 - Math.exp(-dt * 5);
    luce.x += (mx - luce.x) * k;
    luce.y += (my - luce.y) * k;
    const raggio = RAGGIO * Math.hypot(w, h) * (1 + 0.04 * Math.sin((DUE_PI * T) / 7));
    luce.r = raggio * (0.55 + 0.45 * esce(entrata));

    const peso = fine ? puntatore.peso : 0;
    const q = 1 - Math.exp(-dt * 3);
    scorri.x += (-SPOSTA * puntatore.sx * peso - scorri.x) * q;
    scorri.y += (-SPOSTA * 0.7 * puntatore.sy * peso - scorri.y) * q;
  }

  function ciclo(ora) {
    richiesta = requestAnimationFrame(ciclo);
    tick += 1;
    // a riposo (luce arrivata, mouse fermo) 30 fotogrammi al secondo
    if (entrata >= 1 && !puntatore.mosso && ora - puntatore.ultimo > 1500 && tick % 2) return;
    if (ultimo < 0) { ultimo = ora; misura(); }
    const dt = limita((ora - ultimo) / 1000, 0, 0.1);
    ultimo = ora;
    aggiorna(dt, ora);
    // durante l'arrivo la luce parte da fuori, a sinistra, e la foto esce dal buio con lei
    const e = entraEsce(entrata);
    const x = luce.x;
    luce.x = -0.3 * scatola.width + (x + 0.3 * scatola.width) * e;
    scrivi(esce(entrata));
    luce.x = x;
  }

  function regola() {
    cancelAnimationFrame(richiesta);
    richiesta = 0;
    if (fermato || !pronto) return;
    if (ridotto.matches) { fermaSulVolto(); return; }
    if (!attivo) return;
    ultimo = -1;
    richiesta = requestAnimationFrame(ciclo);
  }

  const ascolto = new AbortController();
  const conAscolto = { signal: ascolto.signal, passive: true };
  radice.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    puntatore.x = e.clientX;
    puntatore.y = e.clientY;
    const s = radice.getBoundingClientRect();
    puntatore.sx = limita(((e.clientX - s.left) / s.width) * 2 - 1, -1, 1);
    puntatore.sy = limita(((e.clientY - s.top) / s.height) * 2 - 1, -1, 1);
    puntatore.voluto = 1;
    puntatore.mosso = true;
  }, conAscolto);
  radice.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') puntatore.voluto = 0; }, conAscolto);
  // la scatola si rimisura quando cambia: scorrendo la pagina, ruotando il telefono, quando arrivano i caratteri
  const ridimensiona = new ResizeObserver(() => { if (pronto) { misura(); if (ridotto.matches) fermaSulVolto(); } });
  ridimensiona.observe(contenitore);
  const blocco = radice.querySelector('.apertura__testo');
  if (blocco) ridimensiona.observe(blocco);
  window.addEventListener('scroll', () => { if (pronto && attivo) scatola = contenitore.getBoundingClientRect(); }, conAscolto);
  ridotto.addEventListener?.('change', regola, { signal: ascolto.signal });

  foto.style.setProperty('--buio', String(BUIO));
  foto.style.opacity = '0';
  foto.decode().then(() => {
    if (fermato) return;
    contenitore.hidden = false;
    radice.classList.add('apertura--ritratto');   // il testo si stringe e prende un'ombra (apertura.css)
    pronto = true;
    misura();
    [luce.x, luce.y] = riposo;
    regola();
  }, () => { contenitore.hidden = true; });   // foto mancante: resta la parete

  return {
    attiva(si) {
      si = !!si;
      if (si === attivo) return;
      attivo = si;
      regola();
    },
    ferma() {
      if (fermato) return;
      fermato = true;
      cancelAnimationFrame(richiesta);
      ridimensiona.disconnect();
      ascolto.abort();
      contenitore.replaceChildren();
      contenitore.hidden = true;
      radice.classList.remove('apertura--ritratto');
    },
  };
}
