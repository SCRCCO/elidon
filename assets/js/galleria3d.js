// Galleria virtuale: un museo al buio, con le opere appese in scala reale e ciascuna illuminata dal proprio faretto.
// Trascina per guardarti intorno, tocca il pavimento per camminare, tocca un quadro per avvicinarti.
//
// Regole (decise con la «giuria» di progetto):
// - la foto dell'opera è la verità: niente tinte prese dalle opere sulla sala, niente zoom né ritagli;
// - le opere sono la cosa più luminosa della sala; le pareti hanno solo le pozze dei faretti;
// - un solo passaggio di disegno (i riflessi sono copie speculari sotto un pavimento semitrasparente);
// - con «riduci movimento» la camera non si muove: si passa da un punto all'altro con un velo nero.
import * as THREE from 'three';
import { misureOpera } from './misure.js?v=3';
import { materialeDipinto, cambiaMappa, forzaRilievo } from './rilievo.js?v=3';
import { rigaCartellino } from './testi.js?v=3';

// Colore delle pareti scelto nel pannello: albedo, luce di fondo della sala, forza delle pozze dei faretti
// e chiarezza dei cartellini (sulle pareti scure un cartoncino bianco sembrerebbe un errore di disegno).
const PARETI = {
  'Bianco': { colore: 0xf1efea, fondo: 0.05, faretti: 1.7, carta: 1 },
  'Grigio chiaro': { colore: 0xd6d4cf, fondo: 0.06, faretti: 2, carta: 1 },
  'Antracite': { colore: 0x3d3c39, fondo: 0.4, faretti: 8, carta: 0.4 },
  'Terracotta': { colore: 0xb4705a, fondo: 0.09, faretti: 3, carta: 0.7 },
};
const OCCHI = 1.6;            // altezza dello sguardo (m)
const SOFFITTO_MIN = 3.9;
const SPAZIO = 1.3;           // spazio minimo tra due opere (m)
const MARGINE = 1.4;          // distanza minima dagli angoli (m)
const MAX_FARETTI = 12;       // pozze di luce per parete (oltre, le vicine si uniscono)
const INCLINAZIONE = THREE.MathUtils.degToRad(22); // luce dei faretti rispetto alla parete
const PROFONDITA = 0.04;      // spessore del telaio (m)
const STACCO = 0.012;         // distanza della tela dal muro (m)
const PORTATA = 0.008;        // attenuazione della luce sul quadro: lieve calo dall'alto in basso
const DURATA_RADENTE = 2.6;   // passata di luce radente all'arrivo (s)
const RADENTE = 0.85;         // peso del rilievo sotto il faretto (durante la passata sale a 1)
const COLORE_SOFFITTO = 0x1b1a19;
const COLORE_PAVIMENTO = 0x2b2825;
const CARTA = 0xeeeae3;       // carta dei cartellini

const limita = (v, a, b) => Math.min(b, Math.max(a, v));
const angoloTra = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const morbida = (t) => 0.5 - 0.5 * Math.cos(Math.PI * limita(t, 0, 1));   // easeInOutSine
const uscita = (t) => 1 - (1 - limita(t, 0, 1)) ** 2;                      // easeOutQuad
const gradino = (a, b, x) => { const t = limita((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const prossimoFotogramma = () => new Promise((r) => requestAnimationFrame(() => r()));

// Carica una foto e, se è molto grande, la riduce: le schede grafiche dei telefoni hanno poca memoria.
export function caricaImmagine(url, latoMassimo, attesa = 20000) {
  return new Promise((risolvi) => {
    const img = new Image();
    img.decoding = 'async';
    const timer = setTimeout(() => { img.src = ''; risolvi(null); }, attesa);
    img.onload = () => {
      clearTimeout(timer);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return risolvi(null);
      const scala = Math.min(1, latoMassimo / Math.max(w, h));
      if (scala === 1) return risolvi({ sorgente: img, w, h });
      const c = document.createElement('canvas');
      c.width = Math.round(w * scala);
      c.height = Math.round(h * scala);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      risolvi({ sorgente: c, w, h });
    };
    img.onerror = () => { clearTimeout(timer); risolvi(null); };
    img.src = url;
  });
}

function textureDa(sorgente, maxAniso) {
  const t = new THREE.Texture(sorgente);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAniso);
  t.needsUpdate = true;
  return t;
}

// Carica più foto insieme (al massimo 6 per volta) e segnala l'avanzamento.
async function precarica(urls, latoMassimo, suAvanzamento) {
  const risultati = new Array(urls.length).fill(null);
  let prossimo = 0;
  let fatti = 0;
  const lavoratore = async () => {
    while (prossimo < urls.length) {
      const i = prossimo++;
      risultati[i] = await caricaImmagine(urls[i], latoMassimo);
      suAvanzamento(++fatti, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, lavoratore));
  return risultati;
}

// Sceglie la grandezza della sala e distribuisce le opere sulle quattro pareti.
export function progettaSala(misure) {
  const n = misure.length;
  const somma = misure.reduce((s, m) => s + m.w, 0);
  const proporzione = 1.45;
  let perimetro = Math.max(26, (somma + SPAZIO * n + MARGINE * 8) * 1.1);
  for (let tentativo = 0; tentativo < 40; tentativo++) {
    const D = perimetro / (2 * (proporzione + 1));
    const W = D * proporzione;
    const lunghezze = [W, D, W, D];
    const capacita = lunghezze.map((l) => l - 2 * MARGINE);
    const totaleCapacita = capacita.reduce((a, b) => a + b, 0);
    const daOccupare = somma + SPAZIO * Math.max(0, n - 1);
    const assegnati = [[], [], [], []];
    const usato = [0, 0, 0, 0];
    let p = 0;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const w = misure[i].w;
      const quota = (daOccupare * capacita[p]) / totaleCapacita;
      const extra = assegnati[p].length ? SPAZIO : 0;
      if (p < 3 && assegnati[p].length && (usato[p] + extra + w / 2 > quota || usato[p] + extra + w > capacita[p])) p++;
      const extra2 = assegnati[p].length ? SPAZIO : 0;
      if (usato[p] + extra2 + w > capacita[p]) { ok = false; break; }
      usato[p] += extra2 + w;
      assegnati[p].push(i);
    }
    if (ok) return { W, D, assegnati };
    perimetro *= 1.1;
  }
  throw new Error('Impossibile progettare la sala');
}

// ---------------------------------------------------------------- shader

// rumore senza sin(): niente strisce sulle GPU mobili
const RUMORE = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float rumore(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

const VERTICE_MONDO = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vMondo;
  void main() {
    vUv = uv;
    vec4 m = modelMatrix * vec4(position, 1.0);
    vMondo = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
  }
`;

// Parete: albedo × (luce di fondo con calo verticale + pozze dei faretti) × intonaco appena accennato.
// Per ogni faretto: cono morbido, coseno sulla parete, calo con la distanza. Da qui nasce la «smerlatura» sopra il quadro.
const FRAMMENTO_PARETE = /* glsl */ `
  precision highp float;
  uniform vec3 uAlbedo;
  uniform vec3 uNormale;
  uniform vec2 uLungo;        // direzione della parete sul piano xz
  uniform float uFondo;       // luce di fondo della sala
  uniform float uForza;       // forza delle pozze
  uniform float uAltezza;     // altezza del soffitto
  uniform vec3 uFaretti[N];
  uniform vec3 uAssi[N];
  uniform vec2 uConi[N];      // coseno esterno, coseno interno
  uniform float uAccese[N];
  varying vec3 vMondo;
  ${RUMORE}
  void main() {
    vec3 P = vMondo;
    float verticale = P.y < 1.6
      ? mix(0.55, 1.0, smoothstep(0.0, 1.5, P.y))
      : mix(1.0, 0.78, smoothstep(1.6, uAltezza, P.y));
    float pozze = 0.0;
    vec3 lungo = vec3(uLungo.x, 0.0, uLungo.y);
    for (int i = 0; i < N; i++) {
      vec3 Lv = uFaretti[i] - P;
      float d2 = dot(Lv, Lv);
      vec3 L = Lv * inversesqrt(d2);
      // cono ellittico, più largo lungo la parete: la pozza ha una cima tonda invece che a sesto acuto
      float c = dot(-L, uAssi[i]);
      vec3 laterale = -L - c * uAssi[i];
      float sulMuro = dot(laterale, lungo);
      float cosEll = c * inversesqrt(c * c + dot(laterale, laterale) - 0.58 * sulMuro * sulMuro);
      float cono = smoothstep(uConi[i].x, uConi[i].y, cosEll);
      float coseno = 0.25 + 0.75 * max(dot(uNormale, L), 0.0);
      pozze += uAccese[i] * cono * coseno / (1.0 + 0.25 * d2);
    }
    float luce = (uFondo + uForza * pozze) * verticale;
    vec2 q = vec2(dot(P.xz, uLungo), P.y);
    float intonaco = 1.0 + 0.03 * (rumore(q * 3.5) - 0.5) + 0.018 * (rumore(q * 31.0) - 0.5);
    // spalla morbida: le pozze più forti restano bianche senza bruciarsi
    luce = luce < 0.6 ? luce : 0.6 + 0.3 * (1.0 - exp(-(luce - 0.6) * 3.3));
    gl_FragColor = vec4(uAlbedo * luce * intonaco, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  }
`;

// Pavimento: cemento scuro a basso contrasto, con la ricaduta dei faretti davanti alle opere.
// È semitrasparente (alfa premoltiplicato): sotto si vedono le copie speculari dei quadri, cioè i riflessi.
const FRAMMENTO_PAVIMENTO = /* glsl */ `
  precision highp float;
  uniform sampler2D uCemento;
  uniform vec3 uColore;
  uniform float uFondo;
  uniform float uForza;
  uniform float uRiflessi;    // 0 = pavimento opaco (riflessi spenti)
  uniform vec2 uMezza;        // metà della sala (x, z)
  uniform vec4 uMacchie[M];   // centro (x, z) e raggi (x, z) della luce caduta a terra
  uniform float uAccese[M];
  varying vec3 vMondo;
  ${RUMORE}
  void main() {
    vec2 p = vMondo.xz;
    float t = texture2D(uCemento, p / 3.2).r;
    float bordo = min(uMezza.x - abs(p.x), uMezza.y - abs(p.y));
    float ao = mix(0.5, 1.0, smoothstep(0.0, 0.8, bordo));
    float luce = uFondo;
    for (int i = 0; i < M; i++) {
      vec2 d = (p - uMacchie[i].xy) / uMacchie[i].zw;
      luce += uAccese[i] * uForza * exp(-dot(d, d));
    }
    vec3 c = uColore * (0.82 + 0.36 * t) * luce * ao;
    // più riflesso vicino alle pareti, quasi niente al centro
    float alfa = mix(1.0, mix(0.64, 0.9, smoothstep(0.2, 3.5, bordo)), uRiflessi);
    gl_FragColor = vec4(c, alfa);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0 * alfa;
  }
`;

// Riflesso: la stessa foto, capovolta (v invertita), molto sfocata dalle mipmap e che svanisce sotto il pavimento.
const FRAMMENTO_RIFLESSO = /* glsl */ `
  precision highp float;
  uniform sampler2D mappa;
  uniform float uForza;
  varying vec2 vUv;
  varying vec3 vMondo;
  void main() {
    // la mesh è più grande del quadro: i bordi sfumano invece di tagliare il riflesso di netto
    vec2 uv = (vUv - 0.5) * ALLARGA + 0.5;
    vec2 dentro = smoothstep(vec2(-0.06), vec2(0.06), uv) * smoothstep(vec2(-0.06), vec2(0.06), 1.0 - uv);
    vec3 c = texture2D(mappa, clamp(vec2(uv.x, 1.0 - uv.y), 0.0, 1.0), 4.0).rgb;
    float sfuma = exp(vMondo.y * 1.6);
    gl_FragColor = vec4(c * uForza * sfuma * dentro.x * dentro.y, 1.0);
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- texture disegnate al volo

// Cemento lisciato: macchie larghe e morbide a ±4%, grana fine. Dati (non colore): la media vale 0,5.
function textureCemento() {
  const lato = 512;
  const c = document.createElement('canvas');
  c.width = c.height = lato;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, lato, lato);
  let seme = 7;
  const caso = () => ((seme = (seme * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 220; i++) {
    const x = caso() * lato;
    const y = caso() * lato;
    const r = 24 + caso() * 110;
    const a = 0.025 + caso() * 0.035;
    const tono = caso() > 0.5 ? '255,255,255' : '0,0,0';
    // le macchie che toccano un bordo si ripetono dall'altra parte: la texture si ripete senza giunte
    for (const dx of [-lato, 0, lato]) {
      for (const dy of [-lato, 0, lato]) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx + r < 0 || cx - r > lato || cy + r < 0 || cy - r > lato) continue;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${tono},${a})`);
        grad.addColorStop(1, `rgba(${tono},0)`);
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
  const dati = g.getImageData(0, 0, lato, lato);
  for (let i = 0; i < dati.data.length; i += 4) {
    const v = (caso() - 0.5) * 12;
    dati.data[i] += v;
    dati.data[i + 1] += v;
    dati.data[i + 2] += v;
  }
  g.putImageData(dati, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Ombra morbida del telaio sul muro.
function textureOmbra() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,1)';
  g.shadowBlur = 24;
  g.shadowOffsetX = 1000;
  g.fillRect(44 - 1000, 44, 168, 168);
  return new THREE.CanvasTexture(c);
}

// Divide un testo in righe che stanno nella larghezza data (l'ultima riga ammessa finisce con «…»).
function avvolgi(g, testo, larghezza, massimo) {
  const righe = [];
  let riga = '';
  for (const parola of String(testo).split(/\s+/).filter(Boolean)) {
    const prova = riga ? `${riga} ${parola}` : parola;
    if (g.measureText(prova).width > larghezza && riga) { righe.push(riga); riga = parola; } else riga = prova;
  }
  if (riga) righe.push(riga);
  if (righe.length > massimo) {
    righe.length = massimo;
    let ultima = righe[massimo - 1];
    while (ultima && g.measureText(`${ultima}…`).width > larghezza) ultima = ultima.slice(0, -1);
    righe[massimo - 1] = `${ultima.trimEnd()}…`;
  }
  return righe;
}

// Cartellino da museo: titolo in corsivo, poi «anno · tecnica in inglese · misure».
const CARTELLINO = { w: 0.26, h: 0.13, px: 1024 };
function textureCartellino(opera) {
  const c = document.createElement('canvas');
  c.width = CARTELLINO.px;
  c.height = CARTELLINO.px / 2;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  const margine = 72;
  const larghezza = c.width - margine * 2;
  g.font = 'italic 500 88px Cormorant, Georgia, serif';
  const titolo = avvolgi(g, opera.titolo || 'Untitled', larghezza, 2);
  g.font = '400 42px Inter, system-ui, sans-serif';
  const dati = avvolgi(g, rigaCartellino(opera), larghezza, 3);
  const altezza = titolo.length * 92 + (dati.length ? 22 + dati.length * 56 : 0);
  let y = Math.max(margine, (c.height - altezza) / 2) + 70;
  g.fillStyle = '#1c1a17';
  g.font = 'italic 500 88px Cormorant, Georgia, serif';
  for (const r of titolo) { g.fillText(r, margine, y); y += 92; }
  y += 22 - 92 + 56;
  g.fillStyle = '#45413b';
  g.font = '400 42px Inter, system-ui, sans-serif';
  for (const r of dati) { g.fillText(r, margine, y); y += 56; }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// I quattro lati del telaio in un'unica mesh, con le UV inchiodate al bordo della foto:
// la pittura sembra girare sul telaio. Il fronte è a z = 0, il retro (contro il muro) a z = -p.
function geometriaBordi(w, h, p) {
  const e = 0.005; // fascia di foto stirata sul lato
  const x = w / 2;
  const y = h / 2;
  const posizioni = [];
  const normali = [];
  const uv = [];
  const indici = [];
  const lato = (a, b, n, uvA, uvB, uvB2, uvA2) => {
    const k = posizioni.length / 3;
    posizioni.push(...a, 0, ...b, 0, ...b, -p, ...a, -p);
    for (let i = 0; i < 4; i++) normali.push(...n);
    uv.push(...uvA, ...uvB, ...uvB2, ...uvA2);
    indici.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  lato([-x, y], [x, y], [0, 1, 0], [0, 1], [1, 1], [1, 1 - e], [0, 1 - e]);       // sopra
  lato([x, -y], [-x, -y], [0, -1, 0], [1, 0], [0, 0], [0, e], [1, e]);            // sotto
  lato([x, y], [x, -y], [1, 0, 0], [1, 1], [1, 0], [1 - e, 0], [1 - e, 1]);       // destra
  lato([-x, -y], [-x, y], [-1, 0, 0], [0, 0], [0, 1], [e, 1], [e, 0]);            // sinistra
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posizioni, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normali, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indici);
  return geo;
}

// Il percorso da a a b evita gli ostacoli (la panca) passando dagli angoli del loro ingombro allargato.
function segmentoTaglia(a, b, r) {
  // Liang–Barsky sul piano xz
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const prove = [[-dx, a.x - r.min.x], [dx, r.max.x - a.x], [-dz, a.z - r.min.y], [dz, r.max.y - a.z]];
  for (const [p, q] of prove) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-4;
}
function instrada(a, b, ostacoli) {
  const nodi = [a, b];
  for (const o of ostacoli) {
    const r = o.clone().expandByScalar(0.55);
    for (const [x, z] of [[r.min.x, r.min.y], [r.max.x, r.min.y], [r.max.x, r.max.y], [r.min.x, r.max.y]]) nodi.push(new THREE.Vector3(x, a.y, z));
  }
  const libero = (p, q) => ostacoli.every((o) => !segmentoTaglia(p, q, o.clone().expandByScalar(0.25)));
  if (libero(a, b)) return [a, b];
  // Dijkstra su pochi nodi
  const n = nodi.length;
  const dist = new Array(n).fill(Infinity);
  const da = new Array(n).fill(-1);
  const fatto = new Array(n).fill(false);
  dist[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!fatto[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    fatto[u] = true;
    for (let v = 0; v < n; v++) {
      if (fatto[v] || v === u || !libero(nodi[u], nodi[v])) continue;
      const d = dist[u] + nodi[u].distanceTo(nodi[v]);
      if (d < dist[v]) { dist[v] = d; da[v] = u; }
    }
  }
  if (da[1] < 0) return [a, b];
  const punti = [];
  for (let v = 1; v >= 0; v = da[v]) { punti.unshift(nodi[v]); if (v === 0) break; }
  return punti;
}

// ---------------------------------------------------------------- sala

export async function creaSala(radice, tutteLeOpere, opzioni = {}) {
  const { colorePareti, nome = '', citazione = '', autoreCitazione = '', idIniziale = '', suDettagli, suTutteLeOpere } = opzioni;
  const $ = (s) => radice.querySelector(s);
  const el = {
    scena: $('[data-sala-scena]'),
    velo: $('[data-sala-velo]'),
    caricamento: $('[data-sala-caricamento]'),
    citazione: $('[data-sala-citazione]'),
    autore: $('[data-sala-autore]'),
    barra: $('[data-sala-barra]'),
    progresso: $('[data-sala-progresso]'),
    aiuto: $('[data-sala-aiuto]'),
    didascalia: $('[data-sala-didascalia]'),
    conta: $('[data-sala-conta]'),
    titolo: $('[data-sala-titolo]'),
    dati: $('[data-sala-dati]'),
    sosta: $('[data-sala-sosta]'),
    dettagli: $('[data-sala-dettagli]'),
    prec: $('[data-sala-prec]'),
    succ: $('[data-sala-succ]'),
    giro: $('[data-sala-giro]'),
    fine: $('[data-sala-fine]'),
    fineTesto: $('[data-sala-fine-testo]'),
    ricomincia: $('[data-sala-ricomincia]'),
    tutte: $('[data-sala-tutte]'),
    messaggio: $('[data-sala-messaggio]'),
    messaggioTesto: $('[data-sala-messaggio-testo]'),
    torna: $('[data-sala-torna]'),
    esci: $('[data-sala-esci]'),
  };

  // Stato iniziale dell'interfaccia (la sala si può aprire più volte nella stessa visita)
  radice.classList.remove('sala--ferma');
  el.caricamento.classList.remove('sala__caricamento--fine');
  el.aiuto.classList.add('sala__aiuto--nascosto');
  el.didascalia.hidden = true;
  el.fine.hidden = true;
  el.messaggio.hidden = true;
  el.velo.classList.remove('sala__velo--chiuso');
  el.giro.setAttribute('aria-pressed', 'false');
  el.progresso.style.transform = 'scaleX(0)';
  el.barra.setAttribute('aria-valuenow', '0');
  const frase = String(citazione || '').trim();
  el.citazione.textContent = frase || 'Preparing the exhibition';
  el.citazione.classList.toggle('sala__citazione--breve', !frase);
  el.autore.textContent = frase ? String(autoreCitazione || '').trim() : '';
  el.autore.hidden = !el.autore.textContent;

  // Chi usa la tastiera entra nella sala; all'uscita torna dove era.
  const fuocoPrima = document.activeElement;
  radice.focus({ preventScroll: true });

  const riduci = matchMedia('(prefers-reduced-motion: reduce)');
  const tattile = matchMedia('(pointer: coarse)').matches;
  const apertoIl = performance.now();
  const avanza = (frazione) => {
    el.progresso.style.transform = `scaleX(${frazione.toFixed(3)})`;
    el.barra.setAttribute('aria-valuenow', String(Math.round(frazione * 100)));
  };

  // Ascoltatori dei pulsanti dell'interfaccia: si collegano subito (servono anche al messaggio d'errore).
  const ascoltati = [];
  const ascolta = (bersaglio, evento, fn, opz) => { bersaglio.addEventListener(evento, fn, opz); ascoltati.push([bersaglio, evento, fn, opz]); };
  const staccaTutto = () => { for (const [b, e, fn, o] of ascoltati) b.removeEventListener(e, fn, o); ascoltati.length = 0; };
  const esci = () => el.esci.click(); // main.js chiude la sala dal pulsante «Exit»

  function mostraMessaggio(testo) {
    el.messaggioTesto.textContent = testo;
    el.messaggio.hidden = false;
    radice.classList.add('sala--ferma');
    el.caricamento.classList.add('sala__caricamento--fine');
    el.didascalia.hidden = true;
    el.fine.hidden = true;
    el.aiuto.classList.add('sala__aiuto--nascosto');
    el.torna.focus({ preventScroll: true });
  }
  ascolta(el.torna, 'click', esci);

  // Controllore minimo, per quando la sala non si può allestire (il messaggio resta finché si esce)
  const controlloreVuoto = () => ({
    chiudi() {
      staccaTutto();
      el.messaggio.hidden = true;
      radice.classList.remove('sala--ferma');
      if (fuocoPrima?.isConnected && !radice.contains(fuocoPrima)) fuocoPrima.focus?.({ preventScroll: true });
    },
    vaiA() {},
  });

  // Il contesto WebGL si crea subito: se manca, lo si dice senza far aspettare le foto.
  const tela = document.createElement('canvas');
  let renderer = null;
  try {
    const contesto = tela.getContext('webgl2', {
      alpha: false, depth: true, stencil: false, antialias: true, premultipliedAlpha: true,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (contesto) renderer = new THREE.WebGLRenderer({ canvas: tela, context: contesto, antialias: true });
  } catch (err) {
    console.info('3D room: WebGL not available', err);
  }
  if (!renderer) {
    mostraMessaggio('The 3D gallery cannot start on this device. You can still see all the paintings on the site.');
    return controlloreVuoto();
  }
  let contestoPerso = false;
  const daLiberare = [];
  const tieni = (x) => { daLiberare.push(x); return x; };
  const inertiti = [];
  let chiuso = false;
  let richiesta = 0;
  // Se l'allestimento fallisce si libera tutto e si mostra un messaggio (mai un alert()).
  const fallito = (err) => {
    console.error('3D room:', err);
    chiuso = true;
    cancelAnimationFrame(richiesta);
    staccaTutto();
    for (const x of inertiti) x.inert = false;
    for (const x of daLiberare) x.dispose?.();
    renderer.dispose();
    if (!contestoPerso) renderer.forceContextLoss();
    tela.remove();
    ascolta(el.torna, 'click', esci);
    mostraMessaggio('The 3D gallery could not be opened. You can still see all the paintings on the site.');
    return controlloreVuoto();
  };
  try {
    let dprMassimo = Math.min(window.devicePixelRatio || 1, tattile ? 1.5 : 2);
    renderer.setPixelRatio(dprMassimo);
    renderer.setClearColor(0x050505);

    // Prima si caricano le foto: servono le loro proporzioni per appenderle in scala.
    // Quelle che non si caricano (file mancante) restano fuori dalla sala.
    const latoTexture = tattile || tutteLeOpere.length > 40 ? 1024 : 1600;
    const latoVicino = tattile ? 1024 : 2400; // da vicino, solo su schermi grandi, si carica la foto più definita
    const foto = await precarica(tutteLeOpere.map((o) => o.immagine.miniatura), latoTexture, (fatti, totale) => avanza((fatti / totale) * 0.85));
    const opere = tutteLeOpere.filter((_, i) => foto[i]);
    const caricate = foto.filter(Boolean);

    // Chiusa mentre si caricavano le foto: niente da allestire.
    if (radice.hidden) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      return controlloreVuoto();
    }
    if (!opere.length) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      mostraMessaggio('There are no paintings on display in the room at the moment.');
      return controlloreVuoto();
    }

    const scena = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 120);
    camera.rotation.order = 'YXZ';

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // Luce di servizio, solo per i piccoli oggetti Lambert (cartellini, lati del telaio, panca, faretti):
    // pareti, pavimento, soffitto e quadri hanno shader propri e non la vedono.
    // Intensità π: una superficie rivolta in alto mostra esattamente il colore del materiale.
    const CIELO = new THREE.Color(0xffffff);
    const TERRA = new THREE.Color(0x3a3836);
    scena.add(new THREE.HemisphereLight(CIELO, TERRA, Math.PI));
    const RESA_VERTICALE = (CIELO.r + TERRA.r) / 2; // quanto vede una superficie verticale

    // Progetto della sala
    const misure = opere.map((o, i) => misureOpera(o, caricate[i].w / caricate[i].h));
    const { W, D, assegnati } = progettaSala(misure);
    // Con quadri molto alti il soffitto si alza.
    const SOFFITTO = Math.max(SOFFITTO_MIN, ...misure.map((m) => Math.max(1.55, m.h / 2 + 0.5) + m.h / 2 + 0.9));
    const Y_FARETTO = SOFFITTO - 0.2;
    // Il binario sta alla distanza che dà circa 22° di luce sul centro di un quadro appeso a 1,55 m.
    const BINARIO = limita((Y_FARETTO - 1.55) * Math.tan(INCLINAZIONE), 0.75, 1.6);
    const pareti = [
      { centro: new THREE.Vector3(0, 0, -D / 2), destra: new THREE.Vector3(1, 0, 0), normale: new THREE.Vector3(0, 0, 1), lunghezza: W },
      { centro: new THREE.Vector3(W / 2, 0, 0), destra: new THREE.Vector3(0, 0, 1), normale: new THREE.Vector3(-1, 0, 0), lunghezza: D },
      { centro: new THREE.Vector3(0, 0, D / 2), destra: new THREE.Vector3(-1, 0, 0), normale: new THREE.Vector3(0, 0, -1), lunghezza: W },
      { centro: new THREE.Vector3(-W / 2, 0, 0), destra: new THREE.Vector3(0, 0, -1), normale: new THREE.Vector3(1, 0, 0), lunghezza: D },
    ];
    const tinta = PARETI[colorePareti] ?? PARETI.Bianco;
    const albedo = new THREE.Color(tinta.colore);

    // ------------------------------------------------ opere e faretti (prima i dati, poi le mesh)

    const sequenza = []; // in ordine di visita: pareti nord, est, sud, ovest, da sinistra a destra
    pareti.forEach((p, ip) => {
      const indici = assegnati[ip];
      const totale = indici.reduce((s, i) => s + misure[i].w, 0);
      const spazio = (p.lunghezza - totale) / (indici.length + 1);
      let s = -p.lunghezza / 2 + spazio;
      p.faretti = [];
      for (const i of indici) {
        const { w, h } = misure[i];
        const y = Math.max(1.55, h / 2 + 0.5);
        const centro = p.centro.clone().addScaledVector(p.destra, s + w / 2).setY(y);
        const faretto = centro.clone().addScaledVector(p.normale, BINARIO).setY(Y_FARETTO);
        const mira = centro.clone().add(new THREE.Vector3(0, 0.1, 0));
        const q = {
          opera: opere[i], foto: caricate[i], indice: sequenza.length, parete: ip,
          centro, normale: p.normale.clone(), destra: p.destra.clone(), w, h, faretto, mira, s: s + w / 2,
          accensione: riduci.matches ? 1 : 0,
        };
        sequenza.push(q);
        p.faretti.push({ faretto, mira, mezzo: Math.max(w, h) / 2, membri: [q], s: s + w / 2 });
        s += w + spazio;
      }
      // Oltre MAX_FARETTI per parete, le pozze più vicine si uniscono in una sola più larga.
      while (p.faretti.length > MAX_FARETTI) {
        let migliore = 0;
        for (let k = 1; k < p.faretti.length - 1; k++) if (p.faretti[k + 1].s - p.faretti[k].s < p.faretti[migliore + 1].s - p.faretti[migliore].s) migliore = k;
        const a = p.faretti[migliore];
        const b = p.faretti[migliore + 1];
        const unito = {
          faretto: a.faretto.clone().lerp(b.faretto, 0.5),
          mira: a.mira.clone().lerp(b.mira, 0.5),
          mezzo: (b.s - a.s) / 2 + Math.max(a.mezzo, b.mezzo),
          membri: [...a.membri, ...b.membri],
          s: (a.s + b.s) / 2,
        };
        p.faretti.splice(migliore, 2, unito);
      }
      for (const f of p.faretti) {
        const distanza = f.faretto.distanceTo(f.mira);
        const esterno = Math.atan((f.mezzo * 0.8 + 0.7) / distanza);
        f.asse = f.mira.clone().sub(f.faretto).normalize();
        f.coni = new THREE.Vector2(Math.cos(esterno), Math.cos(esterno * 0.35));
      }
    });
    const n = sequenza.length;

    // La stessa luce delle pareti calcolata in JS: serve ai cartellini, che devono stare nella luce del muro.
    const fondoSala = { valore: riduci.matches ? 1 : 0.25 };
    function luceSuParete(P, ip) {
      const p = pareti[ip];
      const verticale = P.y < 1.6 ? 0.55 + 0.45 * gradino(0, 1.5, P.y) : 1 - 0.22 * gradino(1.6, SOFFITTO, P.y);
      let pozze = 0;
      const Lv = new THREE.Vector3();
      for (const f of p.faretti) {
        Lv.copy(f.faretto).sub(P);
        const d2 = Lv.lengthSq();
        Lv.normalize();
        const c = -Lv.dot(f.asse);
        const laterale = Lv.clone().negate().addScaledVector(f.asse, -c);
        const sulMuro = laterale.dot(p.destra);
        const cono = gradino(f.coni.x, f.coni.y, c / Math.sqrt(c * c + laterale.lengthSq() - 0.58 * sulMuro * sulMuro));
        const coseno = 0.25 + 0.75 * Math.max(p.normale.dot(Lv), 0);
        pozze += Math.max(...f.membri.map((q) => q.accensione)) * cono * coseno / (1 + 0.25 * d2);
      }
      const luce = (tinta.fondo * fondoSala.valore + tinta.faretti * pozze) * verticale;
      return luce < 0.6 ? luce : 0.6 + 0.3 * (1 - Math.exp(-(luce - 0.6) * 3.3));
    }

    // ------------------------------------------------ pareti, soffitto, binari

    const materialiParete = [];
    const pareteMesh = [];
    const geoUnita = tieni(new THREE.PlaneGeometry(1, 1));
    pareti.forEach((p) => {
      const nf = Math.max(1, p.faretti.length);
      const vuoto = !p.faretti.length;
      const mat = tieni(new THREE.ShaderMaterial({
        defines: { N: nf },
        uniforms: {
          uAlbedo: { value: albedo },
          uNormale: { value: p.normale },
          uLungo: { value: new THREE.Vector2(p.destra.x, p.destra.z) },
          uFondo: { value: tinta.fondo * fondoSala.valore },
          uForza: { value: tinta.faretti },
          uAltezza: { value: SOFFITTO },
          uFaretti: { value: vuoto ? [new THREE.Vector3(0, -10, 0)] : p.faretti.map((f) => f.faretto) },
          uAssi: { value: vuoto ? [new THREE.Vector3(0, -1, 0)] : p.faretti.map((f) => f.asse) },
          uConi: { value: vuoto ? [new THREE.Vector2(0.9, 0.95)] : p.faretti.map((f) => f.coni) },
          uAccese: { value: new Array(nf).fill(0) },
        },
        vertexShader: VERTICE_MONDO,
        fragmentShader: FRAMMENTO_PARETE,
      }));
      materialiParete.push(mat);
      const m = new THREE.Mesh(tieni(new THREE.PlaneGeometry(p.lunghezza, SOFFITTO)), mat);
      m.position.copy(p.centro).setY(SOFFITTO / 2);
      m.rotation.y = Math.atan2(p.normale.x, p.normale.z);
      scena.add(m);
      pareteMesh.push(m);
    });

    const soffitto = new THREE.Mesh(tieni(new THREE.PlaneGeometry(W, D)), tieni(new THREE.MeshBasicMaterial({ color: COLORE_SOFFITTO })));
    soffitto.rotation.x = Math.PI / 2;
    soffitto.position.y = SOFFITTO;
    scena.add(soffitto);

    // Binari incassati nel soffitto e fuga d'ombra al piede delle pareti (al posto del battiscopa chiaro)
    const geoCubo = tieni(new THREE.BoxGeometry(1, 1, 1));
    const binari = new THREE.InstancedMesh(geoCubo, tieni(new THREE.MeshBasicMaterial({ color: 0x0d0c0c })), 4);
    const fughe = new THREE.InstancedMesh(geoUnita, tieni(new THREE.MeshBasicMaterial({ color: 0x0e0d0c })), 4);
    const matrice = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scala = new THREE.Vector3();
    const su = new THREE.Vector3(0, 1, 0);
    pareti.forEach((p, ip) => {
      quat.setFromAxisAngle(su, Math.atan2(p.normale.x, p.normale.z));
      matrice.compose(p.centro.clone().addScaledVector(p.normale, BINARIO).setY(SOFFITTO - 0.0125), quat, scala.set(p.lunghezza - 1.2, 0.025, 0.04));
      binari.setMatrixAt(ip, matrice);
      matrice.compose(p.centro.clone().addScaledVector(p.normale, 0.002).setY(0.007), quat, scala.set(p.lunghezza, 0.014, 1));
      fughe.setMatrixAt(ip, matrice);
    });
    scena.add(binari, fughe);
    daLiberare.push(binari, fughe);

    // ------------------------------------------------ pavimento e riflessi

    const macchie = [];
    const membriMacchie = [];
    pareti.forEach((p) => {
      for (const f of p.faretti) {
        const c = f.mira.clone().addScaledVector(p.normale, 0.75);
        const lungo = f.mezzo + 0.5;
        const largo = 0.95;
        const lungoX = Math.abs(p.destra.x) > 0.5;
        macchie.push(new THREE.Vector4(c.x, c.z, lungoX ? lungo : largo, lungoX ? largo : lungo));
        membriMacchie.push(f.membri);
      }
    });
    const nm = Math.max(1, macchie.length);
    const texCemento = tieni(textureCemento());
    texCemento.anisotropy = maxAniso;
    const matPavimento = tieni(new THREE.ShaderMaterial({
      defines: { M: nm },
      uniforms: {
        uCemento: { value: texCemento },
        uColore: { value: new THREE.Color(COLORE_PAVIMENTO) },
        uFondo: { value: 0.8 * fondoSala.valore },
        uForza: { value: 1.6 },
        uRiflessi: { value: 1 },
        uMezza: { value: new THREE.Vector2(W / 2, D / 2) },
        uMacchie: { value: macchie.length ? macchie : [new THREE.Vector4(0, 0, 1, 1)] },
        uAccese: { value: new Array(nm).fill(0) },
      },
      vertexShader: VERTICE_MONDO,
      fragmentShader: FRAMMENTO_PAVIMENTO,
      transparent: true,
      premultipliedAlpha: true,
    }));
    const pavimento = new THREE.Mesh(tieni(new THREE.PlaneGeometry(W, D)), matPavimento);
    pavimento.rotation.x = -Math.PI / 2;
    scena.add(pavimento);

    // ------------------------------------------------ panca da museo

    const ostacoli = [];
    if (W > 7) {
      const panca = new THREE.Group();
      const seduta = new THREE.Mesh(tieni(new THREE.BoxGeometry(2.0, 0.07, 0.5)), tieni(new THREE.MeshLambertMaterial({ color: 0x38322c })));
      seduta.position.y = 0.425;
      const zoccolo = new THREE.Mesh(tieni(new THREE.BoxGeometry(1.8, 0.39, 0.32)), tieni(new THREE.MeshLambertMaterial({ color: 0x24211e })));
      zoccolo.position.y = 0.195;
      panca.add(seduta, zoccolo);
      scena.add(panca);
      ostacoli.push(new THREE.Box2(new THREE.Vector2(-1.35, -0.6), new THREE.Vector2(1.35, 0.6)));
    }

    // ------------------------------------------------ quadri, riflessi, cartellini, faretti

    const texOmbra = tieni(textureOmbra());
    const fronti = [];
    const cartellini = [];
    const matLente = tieni(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const matCorpo = tieni(new THREE.MeshLambertMaterial({ color: 0x24221f }));
    const corpi = new THREE.InstancedMesh(tieni(new THREE.CylinderGeometry(0.038, 0.05, 0.15, 16)), matCorpo, n);
    const steli = new THREE.InstancedMesh(tieni(new THREE.CylinderGeometry(0.008, 0.008, 1, 6)), matCorpo, n);
    const lenti = new THREE.InstancedMesh(tieni(new THREE.CircleGeometry(0.036, 20)), matLente, n);
    daLiberare.push(corpi, steli, lenti);
    const LENTE_SPENTA = new THREE.Color(0x2a2826);
    const LENTE_ACCESA = new THREE.Color(0xfff1d6);
    const coloreLente = new THREE.Color();
    const giu = new THREE.Vector3(0, -1, 0);
    const zeta = new THREE.Vector3(0, 0, 1);

    for (const q of sequenza) {
      const { w, h, opera } = q;
      const rot = Math.atan2(q.normale.x, q.normale.z);
      const base = tieni(textureDa(q.foto.sorgente, maxAniso));
      q.base = base;

      // Fronte dipinto, illuminato dal suo faretto (luce dall'alto a circa 22° dalla parete)
      const materiale = tieni(materialeDipinto({
        mappa: base, larghezza: w, altezza: h, forza: forzaRilievo(opera),
        intensita: 0, portata: PORTATA, ambiente: 0.3, radente: RADENTE, lucido: 0.12,
      }));
      const fronte = new THREE.Mesh(tieni(new THREE.PlaneGeometry(w, h)), materiale);
      fronte.position.copy(q.centro).addScaledVector(q.normale, PROFONDITA + STACCO);
      fronte.rotation.y = rot;
      fronte.updateMatrixWorld();
      q.luceFaretto = fronte.worldToLocal(q.faretto.clone());
      // a luce piena il centro del quadro vale esattamente la foto (la portata toglie appena in basso)
      q.intensitaPiena = 1 + q.luceFaretto.lengthSq() * PORTATA;
      materiale.uniforms.uLuce.value.copy(q.luceFaretto);
      q.inversa = fronte.matrixWorld.clone().invert();
      q.materiale = materiale;
      fronte.userData.q = q;
      scena.add(fronte);
      fronti.push(fronte);

      // Lati del telaio: la pittura gira sul bordo
      const matBordi = tieni(new THREE.MeshLambertMaterial({ map: base, color: 0xffffff }));
      const bordi = new THREE.Mesh(tieni(geometriaBordi(w, h, PROFONDITA)), matBordi);
      fronte.add(bordi);
      q.matBordi = matBordi;

      // Ombra morbida del telaio sul muro
      const ombra = new THREE.Mesh(geoUnita, tieni(new THREE.MeshBasicMaterial({ map: texOmbra, transparent: true, opacity: 0, depthWrite: false })));
      ombra.scale.set(w * 1.55, h * 1.55, 1);
      ombra.position.copy(q.centro).addScaledVector(q.normale, 0.004).add(new THREE.Vector3(0, -0.05, 0));
      ombra.rotation.y = rot;
      scena.add(ombra);
      q.ombra = ombra.material;

      // Riflesso: copia speculare sotto il pavimento
      const matRiflesso = tieni(new THREE.ShaderMaterial({
        defines: { ALLARGA: '1.12' },
        uniforms: { mappa: { value: base }, uForza: { value: 0 } },
        vertexShader: VERTICE_MONDO,
        fragmentShader: FRAMMENTO_RIFLESSO,
      }));
      const riflesso = new THREE.Mesh(tieni(new THREE.PlaneGeometry(w * 1.12, h * 1.12)), matRiflesso);
      riflesso.position.copy(fronte.position).setY(-fronte.position.y);
      riflesso.rotation.y = rot;
      scena.add(riflesso);
      q.riflesso = riflesso;

      // Cartellino a destra dell'opera, nella luce della parete (Lambert: non brilla)
      const matCartellino = tieni(new THREE.MeshLambertMaterial({ color: CARTA }));
      const cartellino = new THREE.Mesh(tieni(new THREE.PlaneGeometry(CARTELLINO.w, CARTELLINO.h)), matCartellino);
      cartellino.position.copy(q.centro).addScaledVector(q.destra, w / 2 + 0.3 + CARTELLINO.w / 2)
        .addScaledVector(q.normale, 0.004).setY(Math.min(1.42, q.centro.y));
      cartellino.rotation.y = rot;
      cartellino.userData.q = q;
      scena.add(cartellino);
      cartellini.push(cartellino);
      q.cartellino = cartellino;

      // Faretto sul binario: stelo, corpo orientato verso il quadro, lente calda
      const dir = q.mira.clone().sub(q.faretto).normalize();
      quat.setFromUnitVectors(giu, dir);
      matrice.compose(q.faretto, quat, scala.set(1, 1, 1));
      corpi.setMatrixAt(q.indice, matrice);
      const altoStelo = SOFFITTO - 0.025 - q.faretto.y;
      matrice.compose(q.faretto.clone().setY(q.faretto.y + altoStelo / 2), quat.identity(), scala.set(1, altoStelo, 1));
      steli.setMatrixAt(q.indice, matrice);
      quat.setFromUnitVectors(zeta, dir);
      matrice.compose(q.faretto.clone().addScaledVector(dir, 0.0765), quat, scala.set(1, 1, 1));
      lenti.setMatrixAt(q.indice, matrice);
      lenti.setColorAt(q.indice, LENTE_SPENTA);
    }
    scena.add(corpi, steli, lenti);

    // Cartellini: si disegnano quando i caratteri sono pronti
    const caratteri = ['italic 500 88px Cormorant', '400 42px Inter'].map((f) => document.fonts.load(f).catch(() => {}));
    Promise.all(caratteri).then(() => {
      if (chiuso) return;
      for (const c of cartellini) {
        c.material.map = tieni(textureCartellino(c.userData.q.opera));
        c.material.map.anisotropy = Math.min(8, maxAniso);
        c.material.needsUpdate = true;
      }
      sporco = true;
    });

    // Indicatore sul pavimento (dove si andrà cliccando)
    const anello = new THREE.Mesh(tieni(new THREE.RingGeometry(0.16, 0.2, 40)), tieni(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false })));
    anello.rotation.x = -Math.PI / 2;
    anello.visible = false;
    scena.add(anello);

    // ------------------------------------------------ luci: accensione, opera per opera

    // Applica a pareti, pavimento, quadri, riflessi, lenti e cartellini lo stato di accensione corrente.
    function applicaLuci() {
      pareti.forEach((p, ip) => {
        const u = materialiParete[ip].uniforms;
        u.uFondo.value = tinta.fondo * fondoSala.valore;
        p.faretti.forEach((f, k) => { u.uAccese.value[k] = Math.max(...f.membri.map((q) => q.accensione)); });
      });
      matPavimento.uniforms.uFondo.value = 0.8 * fondoSala.valore;
      membriMacchie.forEach((membri, k) => { matPavimento.uniforms.uAccese.value[k] = Math.max(...membri.map((q) => q.accensione)); });
      for (const q of sequenza) {
        const a = q.accensione;
        if (!q.radente) q.materiale.uniforms.uIntensita.value = q.intensitaPiena * a;
        q.matBordi.color.setScalar(0.3 + 0.62 * a);
        q.riflesso.material.uniforms.uForza.value = 0.75 * (0.25 + 0.75 * a);
        q.ombra.opacity = 0.18 + 0.2 * a;
        lenti.setColorAt(q.indice, coloreLente.copy(LENTE_SPENTA).lerp(LENTE_ACCESA, a));
        const luce = luceSuParete(q.cartellino.position, q.parete);
        q.cartellino.material.color.set(CARTA).multiplyScalar(Math.min(1.6, (luce * tinta.carta) / RESA_VERTICALE));
      }
      lenti.instanceColor.needsUpdate = true;
    }

    let accensione = null; // { inizio } finché le luci si stanno accendendo
    function aggiornaAccensione() {
      if (!accensione) return false;
      const t = tempo - accensione.inizio;
      fondoSala.valore = 0.25 + 0.75 * uscita((t + 0.2) / 1.4);
      let finito = fondoSala.valore >= 0.999;
      for (const q of sequenza) {
        q.accensione = uscita((t - 0.09 * q.indice) / 0.3);
        if (q.accensione < 1) finito = false;
      }
      applicaLuci();
      if (finito) {
        accensione = null;
        governatore.attesa = tempo + 1.5;
        dopoAccensione?.();
        dopoAccensione = null;
      }
      return true;
    }
    let dopoAccensione = null;

    // ------------------------------------------------ movimento

    const limiti = { x: W / 2 - 0.55, z: D / 2 - 0.55 };
    const posizione = new THREE.Vector3(0, OCCHI, D / 2 - 1.3);
    const meta = posizione.clone();
    let yaw = 0;
    let pitch = 0;
    let yawMeta = 0;
    let pitchMeta = 0;
    let attuale = -1;          // opera in visita
    let arrivato = false;      // la camera è ferma davanti all'opera in visita
    let puntoVista = null;
    let percorso = null;       // camminata in corso
    let giro = false;          // visita guidata
    let arrivo = 0;
    let tempo = 0;
    let sporco = true;         // va ridisegnato
    const visitate = new Set(); // opere che hanno già avuto la passata radente

    function dentro(v) {
      v.x = limita(v.x, -limiti.x, limiti.x);
      v.z = limita(v.z, -limiti.z, limiti.z);
      for (const b of ostacoli) {
        if (v.x > b.min.x && v.x < b.max.x && v.z > b.min.y && v.z < b.max.y) {
          const dx = Math.min(v.x - b.min.x, b.max.x - v.x);
          const dz = Math.min(v.z - b.min.y, b.max.y - v.z);
          if (dx < dz) v.x = v.x - b.min.x < b.max.x - v.x ? b.min.x : b.max.x;
          else v.z = v.z - b.min.y < b.max.y - v.z ? b.min.y : b.max.y;
        }
      }
      return v;
    }

    // Dove fermarsi davanti a un'opera: il quadro occupa circa tre quarti dell'altezza (o quattro quinti della larghezza).
    function vistaDi(q) {
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const fovOrizz = 2 * Math.atan(Math.tan(fov / 2) * camera.aspect);
      const distanza = limita(Math.max((q.h / 0.72) / 2 / Math.tan(fov / 2), (q.w / 0.8) / 2 / Math.tan(fovOrizz / 2)), 1.4, Math.min(W, D) - 1.2);
      const p = dentro(q.centro.clone().addScaledVector(q.normale, distanza).setY(OCCHI));
      const piano = Math.hypot(p.x - q.centro.x, p.z - q.centro.z);
      return { p, yaw: Math.atan2(q.normale.x, q.normale.z), pitch: Math.atan2(q.centro.y - OCCHI, piano) };
    }

    // Velo nero (riduci movimento): si chiude, si sposta la camera, si riapre. Circa 220 ms in tutto.
    let timerVelo = 0;
    function taglio(sposta) {
      clearTimeout(timerVelo);
      el.velo.classList.add('sala__velo--chiuso');
      timerVelo = setTimeout(() => {
        if (chiuso) return;
        sposta();
        sporco = true;
        requestAnimationFrame(() => requestAnimationFrame(() => el.velo.classList.remove('sala__velo--chiuso')));
      }, 110);
    }

    // Camminata morbida lungo una curva che evita la panca: prima si guarda lungo il cammino, poi ci si gira verso la meta.
    const tangente = new THREE.Vector3();
    function cammina(destinazione, guarda, alArrivo) {
      percorso = null;
      if (riduci.matches) {
        taglio(() => {
          posizione.copy(destinazione);
          meta.copy(destinazione);
          if (guarda) { yaw = yawMeta = guarda.yaw; pitch = pitchMeta = guarda.pitch; }
          alArrivo?.();
        });
        return;
      }
      const a = posizione.clone();
      const b = destinazione.clone();
      let punti = instrada(a, b, ostacoli);
      // un passo indietro verso il centro della sala a metà strada: il cammino si incurva come quello di un visitatore
      const lunghezzaDiretta = a.distanceTo(b);
      if (punti.length === 2 && lunghezzaDiretta > 1.2) {
        const mezzo = a.clone().lerp(b, 0.5);
        const verso = new THREE.Vector3(-mezzo.x, 0, -mezzo.z);
        if (verso.lengthSq() > 1e-4) {
          mezzo.addScaledVector(verso.normalize(), Math.min(0.9, lunghezzaDiretta * 0.12));
          dentro(mezzo);
          // solo se entrambe le metà restano dirette: mai uno zig-zag attorno alla panca
          if (instrada(a, mezzo, ostacoli).length === 2 && instrada(mezzo, b, ostacoli).length === 2) punti = [a, mezzo, b];
        }
      }
      const curva = new THREE.CatmullRomCurve3(punti, false, 'centripetal');
      const lunghezza = lunghezzaDiretta < 0.02 ? 0 : curva.getLength();
      percorso = {
        curva, lunghezza, inizio: tempo,
        durata: lunghezza < 0.05 ? 0.9 : limita(1.2 + 0.3 * lunghezza, 1.6, 4.2),
        yaw0: yaw, pitch0: pitch, guarda, alArrivo,
        pesoTangente: gradino(0.6, 2.2, lunghezza),
      };
    }

    function aggiornaPercorso() {
      const c = percorso;
      if (!c) return false;
      const s = limita((tempo - c.inizio) / c.durata, 0, 1);
      const t = morbida(s);
      if (c.lunghezza > 0) c.curva.getPointAt(t, posizione);
      let y = c.yaw0;
      let pt = c.pitch0;
      if (c.pesoTangente > 0) {
        c.curva.getTangentAt(Math.min(t, 0.999), tangente);
        const w1 = gradino(0, 0.25, s) * c.pesoTangente;
        y += angoloTra(y, Math.atan2(-tangente.x, -tangente.z)) * w1;
        pt += (0 - pt) * w1;
      }
      if (c.guarda) {
        const w2 = c.pesoTangente > 0 ? gradino(0.5, 0.95, s) : gradino(0, 1, s);
        y += angoloTra(y, c.guarda.yaw) * w2;
        pt += (c.guarda.pitch - pt) * w2;
      }
      yaw = yawMeta = y;
      pitch = pitchMeta = pt;
      meta.copy(posizione);
      if (s >= 1) {
        percorso = null;
        c.alArrivo?.();
      }
      return true;
    }

    function interrompi() {
      if (percorso) { percorso = null; meta.copy(posizione); }
    }

    // Va all'opera i (in ordine di visita).
    function vai(i) {
      if (!n) return;
      attuale = ((i % n) + n) % n;
      const q = sequenza[attuale];
      arrivato = false;
      puntoVista = null;
      nascondiDidascalia();
      el.fine.hidden = true;
      fermaRadente();
      const v = vistaDi(q);
      cammina(v.p, v, () => arrivoA(q, v.p));
    }

    function arrivoA(q, punto) {
      if (sequenza[attuale] !== q) return;
      arrivato = true;
      arrivo = tempo;
      puntoVista = punto.clone();
      mostraDidascalia(q);
      if (!visitate.has(q) && !riduci.matches) { visitate.add(q); avviaRadente(q); }
      caricaDefinita(q);
    }

    // ------------------------------------------------ passata radente all'arrivo

    function avviaRadente(q) {
      if (q.accensione < 1) return;
      q.radente = { inizio: tempo };
    }
    function fermaRadente() {
      for (const q of sequenza) {
        if (!q.radente) continue;
        q.radente = null;
        q.materiale.uniforms.uLuce.value.copy(q.luceFaretto);
        q.materiale.uniforms.uRadente.value = RADENTE;
        q.materiale.uniforms.uIntensita.value = q.intensitaPiena * q.accensione;
      }
    }
    const lampada = new THREE.Vector3();
    function aggiornaRadente() {
      let attivo = false;
      for (const q of sequenza) {
        if (!q.radente) continue;
        const s = (tempo - q.radente.inizio) / DURATA_RADENTE;
        const u = q.materiale.uniforms;
        if (s >= 1) {
          q.radente = null;
          u.uLuce.value.copy(q.luceFaretto);
          u.uRadente.value = RADENTE;
          u.uIntensita.value = q.intensitaPiena * q.accensione;
          attivo = true;
          continue;
        }
        // la lampada scende di lato, attraversa il quadro quasi parallela alla tela, poi torna al faretto
        const peso = gradino(0, 0.22, s) * (1 - gradino(0.78, 1, s));
        const lato = Math.max(q.w, q.h);
        lampada.set(THREE.MathUtils.lerp(-0.75 * q.w, 0.75 * q.w, morbida(s)), THREE.MathUtils.lerp(0.14 * q.h, 0.04 * q.h, s), 0.2 * lato);
        u.uLuce.value.copy(q.luceFaretto).lerp(lampada, peso);
        u.uRadente.value = THREE.MathUtils.lerp(RADENTE, 1, peso);
        u.uIntensita.value = THREE.MathUtils.lerp(q.intensitaPiena, 1 + lampada.lengthSq() * PORTATA, peso) * q.accensione;
        attivo = true;
      }
      return attivo;
    }

    // Da vicino serve più dettaglio: su schermi grandi si carica la foto meno ridotta (al massimo 4 alla volta).
    const definite = [];
    function caricaDefinita(q) {
      if (q.definita || q.inCarica || latoVicino <= latoTexture) return;
      if (q.opera.immagine.file === q.opera.immagine.miniatura && Math.max(q.foto.w, q.foto.h) <= latoTexture) return;
      q.inCarica = true;
      caricaImmagine(q.opera.immagine.file, latoVicino).then((f) => {
        q.inCarica = false;
        if (!f || chiuso) return;
        const t = textureDa(f.sorgente, maxAniso);
        renderer.initTexture(t);
        cambiaMappa(q.materiale, t);
        q.definita = t;
        definite.push(q);
        if (definite.length > 4) {
          const vecchia = definite.shift();
          cambiaMappa(vecchia.materiale, vecchia.base);
          vecchia.definita.dispose();
          vecchia.definita = null;
        }
        sporco = true;
      });
    }

    // ------------------------------------------------ interfaccia

    function mostraDidascalia(q) {
      el.conta.textContent = `${String(q.indice + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
      el.titolo.textContent = q.opera.titolo || 'Untitled';
      el.dati.textContent = rigaCartellino(q.opera);
      el.dati.hidden = !el.dati.textContent;
      el.sosta.style.transform = 'scaleX(0)';
      el.didascalia.classList.toggle('sala__didascalia--giro', giro);
      el.didascalia.hidden = false;
    }
    function nascondiDidascalia() { el.didascalia.hidden = true; }

    let aiutoVisibile = false;
    let timerAiuto = 0;
    function nascondiAiuto() {
      if (!aiutoVisibile) return;
      aiutoVisibile = false;
      el.aiuto.classList.add('sala__aiuto--nascosto');
      clearTimeout(timerAiuto);
    }

    function fermaGiro() {
      if (!giro) return;
      giro = false;
      el.giro.setAttribute('aria-pressed', 'false');
      el.didascalia.classList.remove('sala__didascalia--giro');
    }
    function avviaGiro(da) {
      giro = true;
      el.giro.setAttribute('aria-pressed', 'true');
      vai(da);
    }
    function sostaDi(q) { return limita(7 + 0.6 * q.w * q.h, 7, 12); }

    function mostraFine() {
      fermaGiro();
      nascondiDidascalia();
      el.fineTesto.textContent = [nome, `${n} ${n === 1 ? 'painting' : 'paintings'}`].filter(Boolean).join(' · ');
      el.fine.hidden = false;
      el.ricomincia.focus({ preventScroll: true });
    }

    // ------------------------------------------------ input

    const raggio = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const bersagli = [...fronti, ...cartellini, pavimento, ...pareteMesh];
    let trascina = null;
    const tasti = new Set();

    function colpisci(e) {
      const r = tela.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raggio.setFromCamera(ndc, camera);
      return raggio.intersectObjects(bersagli, false)[0] || null;
    }

    function suGiu(e) {
      if (e.button !== undefined && e.button !== 0) return;
      tela.setPointerCapture?.(e.pointerId);
      trascina = { x: e.clientX, y: e.clientY, mosso: 0 };
      nascondiAiuto();
    }
    function suMuovi(e) {
      if (trascina) {
        const dx = e.clientX - trascina.x;
        const dy = e.clientY - trascina.y;
        trascina.x = e.clientX;
        trascina.y = e.clientY;
        trascina.mosso += Math.abs(dx) + Math.abs(dy);
        if (trascina.mosso > 5) {
          interrompi();
          fermaGiro();
          const k = tattile ? 0.006 : 0.0042;
          yaw += dx * k;
          pitch = limita(pitch + dy * k, -0.75, 0.75);
          yawMeta = yaw;
          pitchMeta = pitch;
          sporco = true;
        }
        anello.visible = false;
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const hit = colpisci(e);
      const suOpera = hit && (fronti.includes(hit.object) || cartellini.includes(hit.object));
      tela.style.cursor = suOpera ? 'pointer' : '';
      const vedeva = anello.visible;
      anello.visible = !!hit && hit.object === pavimento;
      if (anello.visible) anello.position.set(hit.point.x, 0.01, hit.point.z);
      if (anello.visible || vedeva) sporco = true;
    }
    function suSu(e) {
      if (!trascina) return;
      const clic = trascina.mosso <= 5;
      trascina = null;
      if (!clic) return;
      const hit = colpisci(e);
      if (!hit) return;
      fermaGiro();
      const q = hit.object.userData.q;
      if (q && fronti.includes(hit.object)) {
        if (q.indice === attuale && arrivato && posizione.distanceTo(puntoVista) < 0.4) suDettagli?.(q.opera);
        else vai(q.indice);
      } else if (q) {
        vai(q.indice);
      } else if (hit.object === pavimento) {
        arrivato = false;
        nascondiDidascalia();
        fermaRadente();
        cammina(dentro(new THREE.Vector3(hit.point.x, OCCHI, hit.point.z)));
      } else {
        const normale = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        const destinazione = dentro(hit.point.clone().addScaledVector(normale, 1.8).setY(OCCHI));
        arrivato = false;
        nascondiDidascalia();
        fermaRadente();
        cammina(destinazione, { yaw: Math.atan2(normale.x, normale.z), pitch: 0 });
      }
    }
    function suRotella(e) {
      e.preventDefault();
      interrompi();
      fermaGiro();
      const avanti = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      meta.addScaledVector(avanti, -limita(e.deltaY, -120, 120) * 0.004);
      dentro(meta);
      sporco = true;
    }
    function suTasto(e) {
      if (document.querySelector('dialog[open]') || !el.messaggio.hidden) return;
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
      if (e.target.closest?.('input, textarea, select')) return;
      e.preventDefault();
      if (e.type === 'keydown') { tasti.add(k); interrompi(); fermaGiro(); nascondiAiuto(); } else tasti.delete(k);
    }
    function suRidimensiona() {
      const w = radice.clientWidth || window.innerWidth;
      const h = radice.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = camera.aspect >= 1 ? 50 : 62;
      camera.updateProjectionMatrix();
      sporco = true;
    }
    function suContestoPerso(e) {
      e.preventDefault();
      contestoPerso = true;
      cancelAnimationFrame(richiesta);
      fermo = true;
      mostraMessaggio('The 3D view was interrupted by the device. Please go back to the site and open the gallery again.');
    }

    ascolta(tela, 'pointerdown', suGiu);
    ascolta(tela, 'pointermove', suMuovi);
    ascolta(tela, 'pointerup', suSu);
    ascolta(tela, 'pointercancel', () => { trascina = null; });
    ascolta(tela, 'pointerleave', () => { if (anello.visible) { anello.visible = false; sporco = true; } });
    ascolta(tela, 'wheel', suRotella, { passive: false });
    ascolta(tela, 'webglcontextlost', suContestoPerso);
    ascolta(window, 'keydown', suTasto);
    ascolta(window, 'keyup', suTasto);
    ascolta(window, 'blur', () => tasti.clear());
    ascolta(window, 'resize', suRidimensiona);

    ascolta(el.prec, 'click', () => { fermaGiro(); vai(attuale < 0 ? n - 1 : attuale - 1); });
    ascolta(el.succ, 'click', () => { fermaGiro(); vai(attuale + 1); });
    ascolta(el.giro, 'click', () => {
      if (giro) { fermaGiro(); return; }
      nascondiAiuto();
      avviaGiro(attuale < 0 || attuale >= n - 1 ? 0 : attuale + 1);
    });
    ascolta(el.dettagli, 'click', () => { if (attuale >= 0) suDettagli?.(sequenza[attuale].opera); });
    ascolta(el.ricomincia, 'click', () => { el.fine.hidden = true; avviaGiro(0); });
    ascolta(el.tutte, 'click', () => suTutteLeOpere?.());

    // ------------------------------------------------ prestazioni

    // Se i fotogrammi superano circa 22 ms: prima si spengono i riflessi, poi si abbassa la risoluzione.
    const governatore = { campioni: [], attesa: 0, passi: 0 };
    function governa(dtVero) {
      if (accensione || tempo < governatore.attesa || governatore.passi > 4) return;
      governatore.campioni.push(dtVero); // la mediana ignora gli scatti isolati (foto caricate, cambio di scheda)
      if (governatore.campioni.length < 90) return;
      const ordinati = governatore.campioni.sort((a, b) => a - b);
      const mediana = ordinati[ordinati.length >> 1];
      governatore.campioni = [];
      if (mediana <= 0.022) return;
      governatore.attesa = tempo + 1;
      governatore.passi++;
      if (matPavimento.uniforms.uRiflessi.value > 0) {
        matPavimento.uniforms.uRiflessi.value = 0;
        for (const q of sequenza) q.riflesso.visible = false;
      } else if (renderer.getPixelRatio() > 1) {
        dprMassimo = Math.max(1, renderer.getPixelRatio() - 0.25);
        renderer.setPixelRatio(dprMassimo);
        suRidimensiona();
      } else governatore.passi = 99;
      // lo stato resta leggibile sulla radice (utile per le prove e per capire un telefono lento)
      radice.dataset.qualita = `${matPavimento.uniforms.uRiflessi.value ? 'riflessi' : 'senza riflessi'}, dpr ${renderer.getPixelRatio()}`;
    }

    // Si disegna solo quando qualcosa cambia; fermo con la scheda nascosta o con il visore aperto sopra la sala.
    const dialoghi = [...document.querySelectorAll('dialog')];
    let ultimo = performance.now();
    let fermo = false;
    let disegnatoPrima = false;
    const avanti = new THREE.Vector3();
    const lato = new THREE.Vector3();
    const firma = [NaN, NaN, NaN, NaN, NaN];

    function fotogramma() {
      richiesta = requestAnimationFrame(fotogramma);
      const ora = performance.now();
      const dtVero = Math.min((ora - ultimo) / 1000, 0.5);
      ultimo = ora;
      if (dialoghi.some((d) => d.open)) { disegnatoPrima = false; return; }
      tempo += dtVero;
      const dt = Math.min(dtVero, 0.05);
      let animato = false;

      if (tasti.size) {
        avanti.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        lato.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const v = 2.4 * dt;
        if (tasti.has('w') || tasti.has('arrowup')) meta.addScaledVector(avanti, v);
        if (tasti.has('s') || tasti.has('arrowdown')) meta.addScaledVector(avanti, -v);
        if (tasti.has('d')) meta.addScaledVector(lato, v);
        if (tasti.has('a')) meta.addScaledVector(lato, -v);
        if (tasti.has('arrowleft')) { yaw += 1.6 * dt; yawMeta = yaw; }
        if (tasti.has('arrowright')) { yaw -= 1.6 * dt; yawMeta = yaw; }
        dentro(meta);
      }

      animato = aggiornaAccensione() || animato;
      if (!aggiornaPercorso()) {
        // movimento libero: si scivola verso la meta (subito, con «riduci movimento»)
        const morbido = riduci.matches ? 1 : 1 - Math.exp(-dt * 3.2);
        posizione.lerp(meta, morbido);
        const k = riduci.matches ? 1 : 1 - Math.exp(-dt * 3.6);
        yaw += angoloTra(yaw, yawMeta) * k;
        pitch += (pitchMeta - pitch) * k;
      } else animato = true;
      animato = aggiornaRadente() || animato;

      // la didascalia resta finché non si va altrove
      if (puntoVista && meta.distanceTo(puntoVista) > 0.6) { puntoVista = null; arrivato = false; nascondiDidascalia(); }

      // visita guidata: sosta proporzionata all'opera, poi la successiva; dopo l'ultima, il cartello finale
      if (giro && arrivato && attuale >= 0) {
        const q = sequenza[attuale];
        const sosta = sostaDi(q);
        const frazione = (tempo - arrivo) / sosta;
        el.sosta.style.transform = `scaleX(${limita(frazione, 0, 1).toFixed(3)})`;
        if (frazione >= 1) {
          if (attuale >= n - 1) mostraFine();
          else vai(attuale + 1);
        }
      }

      camera.position.copy(posizione);
      camera.rotation.set(pitch, yaw, 0);
      const cambiata = firma[0] !== posizione.x || firma[1] !== posizione.y || firma[2] !== posizione.z || firma[3] !== yaw || firma[4] !== pitch;
      if (!cambiata && !animato && !sporco) { disegnatoPrima = false; return; }
      firma[0] = posizione.x; firma[1] = posizione.y; firma[2] = posizione.z; firma[3] = yaw; firma[4] = pitch;
      sporco = false;

      // il riflesso d'olio sulle creste dipende da dove si guarda
      for (const q of sequenza) q.materiale.uniforms.uOcchio.value.copy(posizione).applyMatrix4(q.inversa);

      renderer.render(scena, camera);
      if (disegnatoPrima) governa(dtVero);
      disegnatoPrima = true;
    }

    function suVisibilita() {
      cancelAnimationFrame(richiesta);
      disegnatoPrima = false;
      if (!document.hidden && !chiuso && !fermo) { ultimo = performance.now(); fotogramma(); }
    }
    ascolta(document, 'visibilitychange', suVisibilita);

    // ------------------------------------------------ avvio

    el.scena.append(tela);
    suRidimensiona();
    applicaLuci();

    // Punto di partenza: l'ingresso, oppure davanti all'opera richiesta (#virtual-gallery/<id>)
    const iniziale = idIniziale ? sequenza.find((q) => String(q.opera.id) === String(idIniziale)) : null;
    if (iniziale) {
      attuale = iniziale.indice;
      const v = vistaDi(iniziale);
      posizione.copy(v.p);
      meta.copy(v.p);
      yaw = yawMeta = v.yaw;
      pitch = pitchMeta = v.pitch;
    }
    camera.position.copy(posizione);
    camera.rotation.set(pitch, yaw, 0);

    // Shader compilati e foto caricate sulla scheda grafica prima di togliere la soglia: niente scatti all'ingresso.
    try {
      if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scena, camera);
      else renderer.compile(scena, camera);
    } catch { /* si compilano al primo disegno */ }
    for (let i = 0; i < sequenza.length; i++) {
      if (chiuso || radice.hidden) break;
      renderer.initTexture(sequenza[i].base);
      avanza(0.85 + (0.15 * (i + 1)) / sequenza.length);
      if (i % 3 === 2) await prossimoFotogramma();
    }
    avanza(1);
    // la citazione resta almeno un momento, anche quando le foto sono già in memoria
    const attesa = 1600 - (performance.now() - apertoIl);
    if (attesa > 0) await new Promise((r) => setTimeout(r, attesa));

    const controllore = {
      chiudi() {
        if (chiuso) return;
        chiuso = true;
        for (const x of inertiti) x.inert = false;
        inertiti.length = 0;
        cancelAnimationFrame(richiesta);
        clearTimeout(timerAiuto);
        clearTimeout(timerVelo);
        staccaTutto();
        for (const q of sequenza) q.definita?.dispose();
        for (const x of daLiberare) x.dispose?.();
        renderer.dispose();
        if (!contestoPerso) renderer.forceContextLoss();
        tela.remove();
        radice.classList.remove('sala--ferma');
        delete radice.dataset.qualita;
        el.velo.classList.remove('sala__velo--chiuso');
        el.didascalia.hidden = true;
        el.fine.hidden = true;
        el.messaggio.hidden = true;
        el.aiuto.classList.add('sala__aiuto--nascosto');
        el.caricamento.classList.remove('sala__caricamento--fine'); // alla prossima apertura si rivede subito la soglia
        avanza(0);
        if (fuocoPrima?.isConnected && !radice.contains(fuocoPrima)) fuocoPrima.focus?.({ preventScroll: true });
      },
      vaiA(id) {
        const q = sequenza.find((x) => String(x.opera.id) === String(id));
        if (!q || chiuso) return;
        fermaGiro();
        vai(q.indice);
      },
    };

    // Chiusa durante l'allestimento: si libera tutto subito.
    if (radice.hidden) { controllore.chiudi(); return controllore; }

    // Il resto della pagina non riceve il fuoco della tastiera finché la sala è aperta (i <dialog> restano attivi).
    for (const x of document.body.children) {
      if (x === radice || x.tagName === 'DIALOG' || x.tagName === 'SCRIPT' || x.inert) continue;
      x.inert = true;
      inertiti.push(x);
    }

    // Si toglie la soglia, poi le luci si accendono una opera dopo l'altra (tutte insieme con «riduci movimento»).
    el.caricamento.classList.add('sala__caricamento--fine');
    aiutoVisibile = true;
    el.aiuto.classList.remove('sala__aiuto--nascosto');
    timerAiuto = setTimeout(nascondiAiuto, 9000);
    if (riduci.matches) {
      fondoSala.valore = 1;
      for (const q of sequenza) q.accensione = 1;
      applicaLuci();
      if (iniziale) arrivoA(iniziale, posizione);
    } else {
      accensione = { inizio: 0.35 };
      dopoAccensione = iniziale ? () => { if (attuale === iniziale.indice && !percorso) arrivoA(iniziale, posizione); } : null;
    }
    ultimo = performance.now();
    fotogramma();

    return controllore;
  } catch (err) {
    return fallito(err);
  }
}
