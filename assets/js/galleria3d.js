// Galleria virtuale: una sala con le opere appese alle pareti in scala reale.
// Trascina per guardarti intorno, tocca il pavimento per camminare, tocca un quadro per avvicinarti.
import * as THREE from 'three';

const COLORI_PARETI = {
  'Bianco': 0xf1efea,
  'Grigio chiaro': 0xd6d4cf,
  'Antracite': 0x3d3c39,
  'Terracotta': 0xb4705a,
};
const OCCHI = 1.6;           // altezza dello sguardo (m)
const SOFFITTO_MIN = 3.9;
const SPAZIO = 1.3;          // spazio minimo tra due opere (m)
const MARGINE = 1.4;         // distanza minima dagli angoli (m)

const limita = (v, a, b) => Math.min(b, Math.max(a, v));
const angoloTra = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Dimensioni reali dell'opera in metri, ricavate dal testo «100 × 70 cm» e dalle proporzioni della foto.
export function misureOpera(opera, rapportoFoto) {
  const img = opera.immagine || {};
  const rapporto = rapportoFoto || (img.larghezza && img.altezza ? img.larghezza / img.altezza : 0.8);
  const testo = String(opera.dimensioni || '');
  const numeri = (testo.replace(/(\d),(\d)/g, '$1.$2').match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => n > 0).slice(0, 2);
  let lato = numeri.length ? Math.max(...numeri) / 100 : 1;
  if (/\bmm\b/i.test(testo)) lato /= 10;
  else if (/\d\s*m\b/i.test(testo) && !/cm/i.test(testo)) lato *= 100;
  lato = limita(lato, 0.25, 4.6);
  const m = rapporto >= 1 ? { w: lato, h: lato / rapporto } : { w: lato * rapporto, h: lato };
  if (m.h > 3.4) { m.w *= 3.4 / m.h; m.h = 3.4; }
  return m;
}

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

// Carica più foto insieme (al massimo «insieme» per volta) e segnala l'avanzamento.
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

// ---------------------------------------------------------------- texture disegnate al volo

function texturePavimento() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const listelli = 8;
  const larg = c.width / listelli;
  let seme = 11;
  const caso = () => ((seme = (seme * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < listelli; i++) {
    let y = -caso() * 400;
    while (y < c.height) {
      const lung = 300 + caso() * 420;
      const tono = 158 + caso() * 18;
      g.fillStyle = `rgb(${tono + 22},${tono - 4},${tono - 40})`;
      g.fillRect(i * larg, y, larg, lung);
      g.globalAlpha = 0.08;
      for (let k = 0; k < 14; k++) {
        g.fillStyle = caso() > 0.5 ? '#5a3e22' : '#fff3df';
        g.fillRect(i * larg + caso() * larg, y, 1 + caso() * 2, lung);
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(40,26,14,.55)';
      g.fillRect(i * larg, y, larg, 2);
      y += lung;
    }
    g.fillStyle = 'rgba(40,26,14,.5)';
    g.fillRect(i * larg, 0, 2, c.height);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textureSfumata(interno, esterno, dimensione = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = dimensione;
  const g = c.getContext('2d');
  const r = dimensione / 2;
  const grad = g.createRadialGradient(r, r * 0.8, 0, r, r, r);
  grad.addColorStop(0, interno);
  grad.addColorStop(1, esterno);
  g.fillStyle = grad;
  g.fillRect(0, 0, dimensione, dimensione);
  return new THREE.CanvasTexture(c);
}

function textureOmbra() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,1)';
  g.shadowBlur = 28;
  g.shadowOffsetX = 1000;
  g.fillRect(48 - 1000, 48, 160, 160);
  return new THREE.CanvasTexture(c);
}

function textureCartellino(opera) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfaf7';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1c1a17';
  g.font = 'italic 500 52px Cormorant, Georgia, serif';
  const titolo = String(opera.titolo || 'Senza titolo');
  const righe = [];
  let riga = '';
  for (const parola of titolo.split(/\s+/)) {
    const prova = riga ? `${riga} ${parola}` : parola;
    if (g.measureText(prova).width > c.width - 72 && riga) { righe.push(riga); riga = parola; } else riga = prova;
  }
  righe.push(riga);
  righe.slice(0, 2).forEach((r, i) => g.fillText(r, 36, 78 + i * 56));
  g.fillStyle = '#6b665e';
  g.font = '400 30px Inter, system-ui, sans-serif';
  const dati = [opera.anno, opera.tecnica].filter(Boolean).join(' · ');
  const y = 78 + Math.min(2, righe.length) * 56 + 18;
  g.fillText(dati, 36, y);
  if (opera.dimensioni) g.fillText(String(opera.dimensioni), 36, y + 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textureScritta(testo, colore) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const corpo = 160;
  g.font = `400 ${corpo}px Cormorant, Georgia, serif`;
  const testoSpaziato = testo.toUpperCase().split('').join(' ');
  c.width = Math.ceil(g.measureText(testoSpaziato).width + 40);
  c.height = corpo * 1.4;
  g.font = `400 ${corpo}px Cormorant, Georgia, serif`;
  g.fillStyle = colore;
  g.textBaseline = 'middle';
  g.fillText(testoSpaziato, 20, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, rapporto: c.width / c.height };
}

// ---------------------------------------------------------------- sala

export async function creaSala(radice, tutteLeOpere, { colorePareti, nome = '', suDettagli } = {}) {
  const $ = (s) => radice.querySelector(s);
  const scenaEl = $('[data-sala-scena]');
  const caricamento = $('[data-sala-caricamento]');
  const progresso = $('[data-sala-progresso]');
  const aiuto = $('[data-sala-aiuto]');
  const didascalia = $('[data-sala-didascalia]');
  const bottoneGiro = $('[data-sala-giro]');
  caricamento.classList.remove('sala__caricamento--fine');
  aiuto.classList.remove('sala__aiuto--nascosto');
  didascalia.hidden = true;
  progresso.style.width = '0';

  const tattile = matchMedia('(pointer: coarse)').matches;

  // Prima si caricano le foto: servono le loro proporzioni per appenderle in scala.
  // Quelle che non si caricano (file mancante) restano fuori dalla sala.
  const latoTexture = tattile || tutteLeOpere.length > 40 ? 1024 : 1600;
  const foto = await precarica(tutteLeOpere.map((o) => o.immagine.miniatura), latoTexture, (fatti, totale) => {
    progresso.style.width = `${Math.round((fatti / totale) * 90)}%`;
  });
  const opere = tutteLeOpere.filter((_, i) => foto[i]);
  const caricate = foto.filter(Boolean);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tattile ? 1.5 : 2));
  renderer.setClearColor(0x0b0a09);
  scenaEl.append(renderer.domElement);
  const tela = renderer.domElement;

  const scena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 120);
  camera.rotation.order = 'YXZ';

  const daLiberare = [];
  const tieni = (x) => { daLiberare.push(x); return x; };
  let chiuso = false;

  const fine = () => {
    progresso.style.width = '100%';
    caricamento.classList.add('sala__caricamento--fine');
  };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Luci: una luce diffusa calda; i coni dei faretti sono disegnati sulle pareti.
  scena.add(new THREE.HemisphereLight(0xfff6ea, 0x9a8a7a, 2.6));
  scena.add(new THREE.AmbientLight(0xffffff, 0.9));

  // Progetto della sala
  const misure = opere.map((o, i) => misureOpera(o, caricate[i].w / caricate[i].h));
  const { W, D, assegnati } = opere.length ? progettaSala(misure) : { W: 8, D: 6, assegnati: [[], [], [], []] };
  // Con quadri molto alti il soffitto si alza.
  const SOFFITTO = Math.max(SOFFITTO_MIN, ...misure.map((m) => Math.max(1.55, m.h / 2 + 0.5) + m.h / 2 + 0.9));
  const pareti = [
    { centro: new THREE.Vector3(0, 0, -D / 2), destra: new THREE.Vector3(1, 0, 0), normale: new THREE.Vector3(0, 0, 1), lunghezza: W },
    { centro: new THREE.Vector3(W / 2, 0, 0), destra: new THREE.Vector3(0, 0, 1), normale: new THREE.Vector3(-1, 0, 0), lunghezza: D },
    { centro: new THREE.Vector3(0, 0, D / 2), destra: new THREE.Vector3(-1, 0, 0), normale: new THREE.Vector3(0, 0, -1), lunghezza: W },
    { centro: new THREE.Vector3(-W / 2, 0, 0), destra: new THREE.Vector3(0, 0, -1), normale: new THREE.Vector3(1, 0, 0), lunghezza: D },
  ];
  const colore = COLORI_PARETI[colorePareti] ?? COLORI_PARETI.Bianco;
  const paretiScure = new THREE.Color(colore).getHSL({}).l < 0.45;

  // Pavimento
  const texPav = tieni(texturePavimento());
  texPav.repeat.set(W / 1.6, D / 1.6);
  texPav.anisotropy = maxAniso;
  const pavimento = new THREE.Mesh(tieni(new THREE.PlaneGeometry(W, D)), tieni(new THREE.MeshLambertMaterial({ map: texPav })));
  pavimento.rotation.x = -Math.PI / 2;
  scena.add(pavimento);

  // Soffitto
  const soffitto = new THREE.Mesh(tieni(new THREE.PlaneGeometry(W, D)), tieni(new THREE.MeshBasicMaterial({ color: 0xd8d5cf })));
  soffitto.rotation.x = Math.PI / 2;
  soffitto.position.y = SOFFITTO;
  scena.add(soffitto);

  // Pareti, con una leggera sfumatura verso il basso
  const cGrad = document.createElement('canvas');
  cGrad.width = 4;
  cGrad.height = 256;
  const gGrad = cGrad.getContext('2d');
  const sf = gGrad.createLinearGradient(0, 0, 0, 256);
  sf.addColorStop(0, '#d9d6d0');
  sf.addColorStop(0.35, '#ffffff');
  sf.addColorStop(1, '#c9c4bc');
  gGrad.fillStyle = sf;
  gGrad.fillRect(0, 0, 4, 256);
  const texParete = tieni(new THREE.CanvasTexture(cGrad));
  texParete.colorSpace = THREE.SRGBColorSpace;
  const matParete = tieni(new THREE.MeshLambertMaterial({ color: colore, map: texParete }));
  const matBattiscopa = tieni(new THREE.MeshLambertMaterial({ color: paretiScure ? 0x222120 : 0xdedbd5 }));
  const matBinario = tieni(new THREE.MeshBasicMaterial({ color: 0x1a1918 }));
  const pareteMesh = [];
  for (const p of pareti) {
    const m = new THREE.Mesh(tieni(new THREE.PlaneGeometry(p.lunghezza, SOFFITTO)), matParete);
    m.position.copy(p.centro).setY(SOFFITTO / 2);
    m.rotation.y = Math.atan2(p.normale.x, p.normale.z);
    scena.add(m);
    pareteMesh.push(m);
    const battiscopa = new THREE.Mesh(tieni(new THREE.BoxGeometry(p.lunghezza, 0.09, 0.015)), matBattiscopa);
    battiscopa.position.copy(p.centro).addScaledVector(p.normale, 0.008).setY(0.045);
    battiscopa.rotation.y = m.rotation.y;
    scena.add(battiscopa);
    const binario = new THREE.Mesh(tieni(new THREE.BoxGeometry(p.lunghezza - 1.2, 0.035, 0.035)), matBinario);
    binario.position.copy(p.centro).addScaledVector(p.normale, 0.9).setY(SOFFITTO - 0.05);
    binario.rotation.y = m.rotation.y;
    scena.add(binario);
  }

  // Panca al centro
  const ostacoli = [];
  if (W > 7) {
    const legno = tieni(new THREE.MeshLambertMaterial({ color: 0x9a7552 }));
    const ferro = tieni(new THREE.MeshLambertMaterial({ color: 0x222120 }));
    const panca = new THREE.Group();
    const piano = new THREE.Mesh(tieni(new THREE.BoxGeometry(2, 0.06, 0.5)), legno);
    piano.position.y = 0.44;
    panca.add(piano);
    for (const x of [-0.85, 0.85]) {
      const gamba = new THREE.Mesh(tieni(new THREE.BoxGeometry(0.05, 0.41, 0.44)), ferro);
      gamba.position.set(x, 0.205, 0);
      panca.add(gamba);
    }
    scena.add(panca);
    ostacoli.push(new THREE.Box2(new THREE.Vector2(-1.35, -0.6), new THREE.Vector2(1.35, 0.6)));
  }

  // Opere
  const texLuce = tieni(textureSfumata('rgba(255,236,206,.55)', 'rgba(255,236,206,0)'));
  const texOmbra = tieni(textureOmbra());
  const matLati = tieni(new THREE.MeshLambertMaterial({ color: 0x2a2826 }));
  const geoFaretto = tieni(new THREE.CylinderGeometry(0.045, 0.06, 0.16, 16));
  const matFaretto = tieni(new THREE.MeshLambertMaterial({ color: 0x1d1c1b }));
  const quadri = [];
  const sequenza = [];
  const cartellini = [];
  pareti.forEach((p, ip) => {
    const indici = assegnati[ip];
    const totale = indici.reduce((s, i) => s + misure[i].w, 0);
    const spazio = (p.lunghezza - totale) / (indici.length + 1);
    let s = -p.lunghezza / 2 + spazio;
    const rot = Math.atan2(p.normale.x, p.normale.z);
    for (const i of indici) {
      const { w, h } = misure[i];
      const opera = opere[i];
      const y = Math.max(1.55, h / 2 + 0.5);
      const centro = p.centro.clone().addScaledVector(p.destra, s + w / 2).setY(y);

      const fronte = tieni(new THREE.MeshBasicMaterial({ color: 0xf4f4f4, toneMapped: false, map: tieni(textureDa(caricate[i].sorgente, maxAniso)) }));
      const profondita = 0.035;
      const tela3d = new THREE.Mesh(tieni(new THREE.BoxGeometry(w, h, profondita)), [matLati, matLati, matLati, matLati, fronte, matLati]);
      tela3d.position.copy(centro).addScaledVector(p.normale, profondita / 2 + 0.012);
      tela3d.rotation.y = rot;
      scena.add(tela3d);

      const ombra = new THREE.Mesh(tieni(new THREE.PlaneGeometry(w * 1.6, h * 1.6)), tieni(new THREE.MeshBasicMaterial({ map: texOmbra, transparent: true, opacity: paretiScure ? 0.5 : 0.32, depthWrite: false })));
      ombra.position.copy(centro).addScaledVector(p.normale, 0.006).add(new THREE.Vector3(0, -0.06, 0)).addScaledVector(p.destra, 0.03);
      ombra.rotation.y = rot;
      scena.add(ombra);

      const luce = new THREE.Mesh(tieni(new THREE.PlaneGeometry(w + 1.6, Math.min(SOFFITTO - 0.2, h + 1.9))), tieni(new THREE.MeshBasicMaterial({ map: texLuce, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: paretiScure ? 0.9 : 0.55 })));
      luce.position.copy(centro).addScaledVector(p.normale, 0.004).add(new THREE.Vector3(0, 0.25, 0));
      luce.rotation.y = rot;
      scena.add(luce);

      const faretto = new THREE.Mesh(geoFaretto, matFaretto);
      faretto.position.copy(centro).addScaledVector(p.normale, 0.9).setY(SOFFITTO - 0.16);
      faretto.lookAt(centro);
      faretto.rotateX(Math.PI / 2);
      scena.add(faretto);

      const cartellino = new THREE.Mesh(tieni(new THREE.PlaneGeometry(0.24, 0.12)), tieni(new THREE.MeshBasicMaterial({ color: 0xf2f0ec, toneMapped: false })));
      cartellino.position.copy(p.centro).addScaledVector(p.destra, s + w + 0.3).addScaledVector(p.normale, 0.006).setY(Math.min(1.4, y));
      cartellino.rotation.y = rot;
      cartellino.userData.opera = opera;
      scena.add(cartellino);
      cartellini.push(cartellino);

      tela3d.userData = { opera, indice: sequenza.length, centro, normale: p.normale.clone(), w, h, fronte, alta: false, latoFoto: Math.max(caricate[i].w, caricate[i].h) };
      quadri.push(tela3d);
      sequenza.push(tela3d);
      s += w + spazio;
    }
  });

  // Cartellini e scritta: si disegnano quando i caratteri sono pronti
  const caratteri = ['italic 500 52px Cormorant', '400 30px Inter', '400 160px Cormorant'].map((f) => document.fonts.load(f).catch(() => {}));
  Promise.all(caratteri).then(() => {
    if (chiuso) return;
    for (const c of cartellini) {
      c.material.map = tieni(textureCartellino(c.userData.opera));
      c.material.color.set(0xffffff);
      c.material.needsUpdate = true;
    }
    if (nome) {
      const fondo = pareti[0];
      const opereFondo = assegnati[0].map((i) => misure[i]);
      const cima = opereFondo.length ? Math.max(...opereFondo.map((m) => Math.max(1.55, m.h / 2 + 0.5) + m.h / 2)) : 1.8;
      const altezzaLettere = 0.26;
      if (cima + 0.3 + altezzaLettere < SOFFITTO - 0.25) {
        const { texture, rapporto } = textureScritta(nome, paretiScure ? '#ece7de' : '#2b2926');
        tieni(texture);
        const larghezza = Math.min(W * 0.7, altezzaLettere * 1.4 * rapporto);
        const scritta = new THREE.Mesh(tieni(new THREE.PlaneGeometry(larghezza, larghezza / rapporto)), tieni(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })));
        scritta.position.copy(fondo.centro).addScaledVector(fondo.normale, 0.005).setY(Math.min(SOFFITTO - 0.35, cima + 0.45));
        scena.add(scritta);
      }
    }
  });

  // Indicatore sul pavimento (dove si andrà cliccando)
  const anello = new THREE.Mesh(tieni(new THREE.RingGeometry(0.16, 0.2, 40)), tieni(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })));
  anello.rotation.x = -Math.PI / 2;
  anello.visible = false;
  scena.add(anello);

  // ---------------------------------------------------------------- movimento

  const limiti = { x: W / 2 - 0.55, z: D / 2 - 0.55 };
  const posizione = new THREE.Vector3(0, OCCHI, D / 2 - 1.3);
  const meta = posizione.clone();
  let yaw = 0;
  let pitch = 0;
  let yawMeta = 0;
  let pitchMeta = 0;
  let attuale = -1;
  let puntoVista = null;
  let giro = false;
  let arrivo = 0;
  let tempo = 0;

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

  function vai(i) {
    if (!sequenza.length) return;
    const n = sequenza.length;
    attuale = ((i % n) + n) % n;
    const q = sequenza[attuale].userData;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fovOrizz = 2 * Math.atan(Math.tan(fov / 2) * camera.aspect);
    const distanza = limita(Math.max((q.h / 0.68) / 2 / Math.tan(fov / 2), (q.w / 0.75) / 2 / Math.tan(fovOrizz / 2)), 1.3, Math.min(W, D) - 1.2);
    meta.copy(q.centro).addScaledVector(q.normale, distanza).setY(OCCHI);
    dentro(meta);
    yawMeta = yaw + angoloTra(yaw, Math.atan2(q.normale.x, q.normale.z));
    pitchMeta = Math.atan2(q.centro.y - OCCHI, meta.distanceTo(q.centro.clone().setY(OCCHI)));
    puntoVista = meta.clone();
    arrivo = tempo;
    mostraDidascalia(q);
    // Da vicino serve più dettaglio: si carica la foto grande (o meno ridotta).
    if (!q.alta && (q.opera.immagine.file !== q.opera.immagine.miniatura || q.latoFoto > latoTexture)) {
      q.alta = true;
      caricaImmagine(q.opera.immagine.file, tattile ? 1600 : 2400).then((f) => {
        if (!f || chiuso) return;
        const vecchia = q.fronte.map;
        q.fronte.map = tieni(textureDa(f.sorgente, maxAniso));
        q.fronte.needsUpdate = true;
        vecchia?.dispose();
      });
    }
  }

  function mostraDidascalia(q) {
    $('[data-sala-conta]').textContent = `${q.indice + 1} / ${sequenza.length}`;
    $('[data-sala-titolo]').textContent = q.opera.titolo || 'Untitled';
    $('[data-sala-dati]').textContent = [q.opera.anno, q.opera.tecnica, q.opera.dimensioni].filter(Boolean).join(' · ');
    didascalia.hidden = false;
  }

  function nascondiAiuto() { aiuto.classList.add('sala__aiuto--nascosto'); }
  const timerAiuto = setTimeout(nascondiAiuto, 8000);

  function fermaGiro() {
    giro = false;
    bottoneGiro.setAttribute('aria-pressed', 'false');
  }

  // ---------------------------------------------------------------- input

  const raggio = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const bersagli = [...quadri, pavimento, ...pareteMesh];
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
        const k = tattile ? 0.006 : 0.0042;
        yaw += dx * k;
        pitch = limita(pitch + dy * k, -0.75, 0.75);
        yawMeta = yaw;
        pitchMeta = pitch;
        fermaGiro();
      }
      anello.visible = false;
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const hit = colpisci(e);
    const suQuadro = hit && quadri.includes(hit.object);
    tela.style.cursor = suQuadro ? 'pointer' : '';
    anello.visible = !!hit && hit.object === pavimento;
    if (anello.visible) anello.position.set(hit.point.x, 0.01, hit.point.z);
  }
  function suSu(e) {
    if (!trascina) return;
    const fermo = trascina.mosso <= 5;
    trascina = null;
    if (!fermo) return;
    const hit = colpisci(e);
    if (!hit) return;
    fermaGiro();
    if (quadri.includes(hit.object)) {
      const i = hit.object.userData.indice;
      if (i === attuale && puntoVista && posizione.distanceTo(puntoVista) < 0.4) suDettagli?.(hit.object.userData.opera);
      else vai(i);
    } else if (hit.object === pavimento) {
      meta.set(hit.point.x, OCCHI, hit.point.z);
      dentro(meta);
    } else {
      const normale = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      meta.copy(hit.point).addScaledVector(normale, 1.8).setY(OCCHI);
      dentro(meta);
    }
  }
  function suRotella(e) {
    e.preventDefault();
    const avanti = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    meta.addScaledVector(avanti, -e.deltaY * 0.004);
    dentro(meta);
    fermaGiro();
  }
  function suTasto(e) {
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') { tasti.add(k); fermaGiro(); nascondiAiuto(); } else tasti.delete(k);
  }
  function suRidimensiona() {
    const w = radice.clientWidth;
    const h = radice.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 72 : 62;
    camera.updateProjectionMatrix();
  }

  tela.addEventListener('pointerdown', suGiu);
  tela.addEventListener('pointermove', suMuovi);
  tela.addEventListener('pointerup', suSu);
  tela.addEventListener('pointercancel', () => { trascina = null; });
  tela.addEventListener('pointerleave', () => { anello.visible = false; });
  tela.addEventListener('wheel', suRotella, { passive: false });
  window.addEventListener('keydown', suTasto);
  window.addEventListener('keyup', suTasto);
  window.addEventListener('resize', suRidimensiona);

  const bottoni = {
    prec: $('[data-sala-prec]'),
    succ: $('[data-sala-succ]'),
    giro: bottoneGiro,
    dettagli: $('[data-sala-dettagli]'),
  };
  const azioni = {
    prec: () => { fermaGiro(); vai(attuale < 0 ? sequenza.length - 1 : attuale - 1); },
    succ: () => { fermaGiro(); vai(attuale + 1); },
    giro: () => {
      giro = !giro;
      bottoneGiro.setAttribute('aria-pressed', String(giro));
      if (giro) vai(attuale + 1);
    },
    dettagli: () => { if (attuale >= 0) suDettagli?.(sequenza[attuale].userData.opera); },
  };
  for (const [k, b] of Object.entries(bottoni)) b.addEventListener('click', azioni[k]);
  bottoneGiro.setAttribute('aria-pressed', 'false');

  // ---------------------------------------------------------------- disegno

  let ultimo = performance.now();
  let richiesta = 0;
  const avanti = new THREE.Vector3();
  const lato = new THREE.Vector3();

  function fotogramma() {
    richiesta = requestAnimationFrame(fotogramma);
    const ora = performance.now();
    const dt = Math.min((ora - ultimo) / 1000, 0.05);
    ultimo = ora;
    tempo += dt;

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

    const morbido = 1 - Math.exp(-dt * 3.2);
    posizione.lerp(meta, morbido);
    yaw += angoloTra(yaw, yawMeta) * (1 - Math.exp(-dt * 3.6));
    pitch += (pitchMeta - pitch) * (1 - Math.exp(-dt * 3.6));
    camera.position.copy(posizione);
    camera.position.y += Math.sin(tempo * 1.3) * 0.004;
    camera.rotation.set(pitch, yaw, 0);

    // la didascalia resta finché non si sceglie di andare altrove
    if (puntoVista && meta.distanceTo(puntoVista) > 0.6) { puntoVista = null; didascalia.hidden = true; }
    if (giro && tempo - arrivo > 7) vai(attuale + 1);

    renderer.render(scena, camera);
  }

  function suVisibilita() {
    cancelAnimationFrame(richiesta);
    if (!document.hidden && !chiuso) { ultimo = performance.now(); fotogramma(); }
  }
  document.addEventListener('visibilitychange', suVisibilita);

  suRidimensiona();
  fotogramma();
  fine();

  return {
    chiudi() {
      chiuso = true;
      cancelAnimationFrame(richiesta);
      clearTimeout(timerAiuto);
      window.removeEventListener('keydown', suTasto);
      window.removeEventListener('keyup', suTasto);
      window.removeEventListener('resize', suRidimensiona);
      document.removeEventListener('visibilitychange', suVisibilita);
      for (const [k, b] of Object.entries(bottoni)) b.removeEventListener('click', azioni[k]);
      for (const x of daLiberare) x.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss?.();
      tela.remove();
    },
  };
}
