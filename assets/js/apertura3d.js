// Motore WebGL della prima schermata: un'opera su una parete scura, illuminata da una lampada radente
// (la luce che i restauratori usano per far leggere l'impasto). La regia (apertura.js) decide quale opera
// mostrare e quando; qui si disegna soltanto.
//
// - La camera è in scala di pixel: sul piano z = 0 un'unità vale un pixel CSS, così il quadro WebGL coincide
//   con l'<img> dello strato statico che sta sotto il canvas.
// - Quattro draw call: parete (pozza di luce, ombra portata analitica, intonaco, riflesso del colore ≤ 8 %),
//   fianchi della tela (il bordo della foto tirato sui lati), superficie dipinta (materialeDipinto di rilievo.js),
//   velo del buio (solo durante i cambi d'opera).
// - Il cambio d'opera è un cambio di luce: la lampada si abbassa, al buio si cambia opera, la luce radente
//   rientra dal lato. L'opera non viene mai deformata, ritagliata né mescolata con un'altra.
import * as THREE from 'three';
import { materialeDipinto, cambiaMappa, forzaRilievo } from './rilievo.js?v=3';
import { misureOpera } from './misure.js?v=3';

const FOV = 30;                 // obiettivo lungo: la prospettiva si intuisce appena
const INTRO = 2.6;              // s: passata radente da sinistra all'arrivo
const SPEGNI = 0.7;             // s: la lampada si abbassa
const BUIO = 0.15;              // s: al buio si cambia opera
const ACCENDI = 1.5;            // s: la luce radente rientra dal lato

// Lampada in coordinate del quadro: x, y in mezze misure (±1 = bordo), z in lati lunghi.
const ALTEZZA = 0.22;           // a riposo: abbastanza bassa da far leggere il rilievo, mai sotto ~12°
const RASENTE = 0.1;            // quando entra dal lato o sta fuori dal quadro
const LATO = 1.5;               // da quanto lontano entra (mezze misure)

// Governatore delle prestazioni: fotogrammi da ignorare all'inizio, fotogrammi misurati per la mediana.
const RISCALDAMENTO = 30;
const CAMPIONI = 60;

// Luce sulla superficie dipinta (vedi materialeDipinto): con la luce piena la foto resta la verità.
const AMBIENTE = 0.38;
const RADENTE = 0.9;
const LUCIDO = 0.12;
const PORTATA = 0.1;            // attenuazione a riposo, × 1 / lato lungo²
const PORTATA_INTRO = 0.55;     // in più all'inizio della passata: la luce arriva da un lato
const PORTATA_ENTRATA = 8;      // in più quando la luce rientra dopo il buio: prima il lato vicino alla lampada
const AMBIENTE_ENTRATA = 0.1;   // frazione dell'ambiente all'inizio del rientro (il resto arriva con la lampada)

// Parete
const POZZA = 0.032;            // luminosità della pozza di luce (lineare, sopra il colore del muro)
const CALDO = [1, 0.83, 0.64];  // colore della lampada (lineare)
const SFUMA_TESTO = 240;        // px: la luce si spegne prima di arrivare al testo

const PARETE_V = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 m = modelMatrix * vec4(position, 1.0);
    vP = m.xy;
    gl_Position = projectionMatrix * viewMatrix * m;
  }
`;

const PARETE_F = /* glsl */ `
  precision highp float;
  uniform vec3 uMuro;       // colore del muro (lineare), uguale allo sfondo CSS
  uniform vec3 uLuce;       // lampada (px, mondo; z misurata dal piano del quadro)
  uniform float uProf;      // spessore della tela = distanza del quadro dal muro (px)
  uniform vec4 uQ;          // quadro: centro xy, mezze misure zw (px)
  uniform float uIntensita; // 0 = lampada spenta
  uniform float uRaggio;    // raggio della pozza di luce (px)
  uniform float uPozza;     // luminosità della pozza
  uniform vec3 uCaldo;      // colore della lampada
  uniform vec3 uTinta;      // colore dominante dell'opera (solo la tinta, massimo = 1)
  uniform vec4 uTesto;      // zona del testo: centro xy, mezze misure zw (px)
  uniform float uSfuma;     // px di sfumatura attorno al testo
  uniform vec2 uBordo;      // mezze misure del canvas (px): ai bordi il muro torna identico allo sfondo CSS
  varying vec2 vP;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float rumore(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  void main() {
    // pozza di luce sul muro (il muro guarda verso +z)
    vec3 Lv = uLuce - vec3(vP, -uProf);
    float d2 = dot(Lv, Lv);
    float coseno = max(Lv.z, 0.0) * inversesqrt(max(d2, 1.0));
    float pozza = uIntensita * coseno / (1.0 + d2 / (uRaggio * uRaggio));
    // la luce resta attorno al quadro e non arriva mai ai bordi della sezione
    float sdQ = sdBox(vP - uQ.xy, uQ.zw);
    vec2 margine = uBordo - abs(vP);
    pozza *= 1.0 - smoothstep(0.1 * uRaggio, 0.75 * uRaggio, sdQ);
    pozza *= smoothstep(0.0, 140.0, min(margine.x, margine.y));

    // ombra portata dalla tela: il suo contorno proiettato dalla lampada sul muro, con la penombra
    // che cresce con la distanza (lampada bassa = ombra lunga, come nella luce radente)
    float hz = max(uLuce.z, 8.0);
    float k = uProf / hz;
    vec2 centroOmbra = uQ.xy + (uQ.xy - uLuce.xy) * k;
    float sdOmbra = sdBox(vP - centroOmbra, uQ.zw * (1.0 + k));
    float penombra = 3.0 + 0.35 * length(uQ.xy - uLuce.xy) * k + 0.6 * uProf;
    float ombra = 1.0 - smoothstep(-0.5 * penombra, penombra, sdOmbra);

    // ombra di contatto: la tela è appesa, non dipinta sul muro
    float contatto = 1.0 - smoothstep(0.0, 2.2 * uProf, sdQ);

    // intonaco appena percettibile, solo dove arriva la luce
    float intonaco = 0.93 + 0.14 * (0.6 * rumore(vP / 38.0) + 0.4 * rumore(vP / 7.0));

    // riflesso del colore dell'opera sul muro vicino (al massimo l'8 % della luce)
    float alone = exp(-max(sdQ, 0.0) / (0.3 * uRaggio));
    vec3 luce = mix(uCaldo, uTinta, 0.08 * alone);

    // la zona del testo resta scura (sfumatura ampia e angoli tondi: nessun rettangolo visibile)
    float libero = smoothstep(-0.15 * uSfuma, uSfuma, sdBox(vP - uTesto.xy, max(uTesto.zw - 0.5 * uSfuma, 0.0)) - 0.5 * uSfuma);

    vec3 col = uMuro * (1.0 - 0.5 * contatto)
             + luce * (uPozza * pozza * intonaco * (1.0 - 0.92 * ombra) * libero);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    // dithering dopo la conversione in sRGB: nessuna banda nella sfumatura, il muro lontano resta identico al CSS
    gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  }
`;

const FIANCHI_V = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vec4 m = modelMatrix * vec4(position, 1.0);
    vP = m.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * m;
  }
`;

const FIANCHI_F = /* glsl */ `
  precision highp float;
  uniform sampler2D mappa;
  uniform vec3 uLuce;
  uniform float uIntensita;
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vN;
  void main() {
    vec3 colore = texture2D(mappa, vUv).rgb;
    vec3 L = normalize(uLuce - vP);
    float luce = 0.22 + 0.6 * max(dot(normalize(vN), L), 0.0) * uIntensita;
    gl_FragColor = vec4(colore * luce, 1.0);
    #include <colorspace_fragment>
  }
`;

const VELO_V = /* glsl */ `
  void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

const VELO_F = /* glsl */ `
  precision highp float;
  uniform vec3 uMuro;
  uniform float uOpacita;
  void main() {
    gl_FragColor = vec4(uMuro, uOpacita);
    #include <colorspace_fragment>
  }
`;

const limita = (v, a, b) => Math.min(b, Math.max(a, v));
const liscio = (t) => t * t * (3 - 2 * t);
const esce = (t) => 1 - (1 - t) ** 3;
const entraEsce = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const DUE_PI = Math.PI * 2;

// I quattro fianchi di una tela 1 × 1 profonda 1 (da z = 0 a z = −1), con le coordinate della foto
// inchiodate al suo bordo: il colore del bordo si tira sui lati, come una tela avvolta sul telaio.
function geometriaFianchi() {
  const e = 0.002;
  const pos = [];
  const nor = [];
  const uv = [];
  const ind = [];
  const faccia = (vertici, normale, coordinate) => {
    const base = pos.length / 3;
    vertici.forEach((v, i) => { pos.push(...v); nor.push(...normale); uv.push(...coordinate[i]); });
    ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  faccia([[-0.5, -0.5, 0], [-0.5, -0.5, -1], [-0.5, 0.5, -1], [-0.5, 0.5, 0]], [-1, 0, 0], [[e, 0], [e, 0], [e, 1], [e, 1]]);
  faccia([[0.5, -0.5, -1], [0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, -1]], [1, 0, 0], [[1 - e, 0], [1 - e, 0], [1 - e, 1], [1 - e, 1]]);
  faccia([[-0.5, 0.5, 0], [-0.5, 0.5, -1], [0.5, 0.5, -1], [0.5, 0.5, 0]], [0, 1, 0], [[0, 1 - e], [0, 1 - e], [1, 1 - e], [1, 1 - e]]);
  faccia([[-0.5, -0.5, -1], [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, -1]], [0, -1, 0], [[0, e], [0, e], [1, e], [1, e]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  return g;
}

// Colore dominante della foto: media pesata sulla saturazione (contano i pixel colorati), solo la tinta.
function coloreDominante(sorgente) {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(sorgente, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  let r = 0;
  let v = 0;
  let b = 0;
  let peso = 0;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]);
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    const p = (max ? (max - min) / max : 0) ** 2 * (max / 255) + 1e-3;
    r += d[i] * p; v += d[i + 1] * p; b += d[i + 2] * p; peso += p;
  }
  const colore = new THREE.Color().setRGB(r / peso / 255, v / peso / 255, b / peso / 255, THREE.SRGBColorSpace);
  return colore.multiplyScalar(1 / Math.max(colore.r, colore.g, colore.b, 1e-4));
}

function leggiImmagine(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img.decode().then(() => img);
}

// Crea il motore. `tela` e `contesto` (WebGL2) arrivano già pronti da apertura.js.
// rettangolo(rapporto) → { x, y, w, h } dell'opera rispetto alla sezione (px CSS); zonaTesto() → idem per il testo.
// Richiami: suSpegni() all'inizio di un cambio, suBuio(opera, rapporto) al buio, suPronto() al primo fotogramma,
// suGuasto(motivo) quando conviene tornare allo strato statico.
export function creaMotore({ radice, tela, contesto, rettangolo, zonaTesto, dettaglio = false, suSpegni, suBuio, suPronto, suGuasto }) {
  const renderer = new THREE.WebGLRenderer({
    canvas: tela, context: contesto, alpha: false, depth: false, stencil: false, antialias: false, powerPreference: 'default',
  });
  const sfondo = getComputedStyle(radice).backgroundColor;
  const muro = new THREE.Color(/^rgba\(.*,\s*0\)$/.test(sfondo) || !sfondo ? '#121010' : sfondo);
  renderer.setClearColor(muro, 1);
  let dpr = Math.min(window.devicePixelRatio || 1, (navigator.hardwareConcurrency || 8) <= 4 ? 1.25 : 1.5);
  renderer.setPixelRatio(dpr);
  const anisotropia = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 10000);

  // parete
  const uParete = {
    uMuro: { value: muro.clone() },
    uLuce: { value: new THREE.Vector3() },
    uProf: { value: 10 },
    uQ: { value: new THREE.Vector4() },
    uIntensita: { value: 0 },
    uRaggio: { value: 500 },
    uPozza: { value: POZZA },
    uCaldo: { value: new THREE.Color(...CALDO) },
    uTinta: { value: new THREE.Color(1, 1, 1) },
    uTesto: { value: new THREE.Vector4(0, 0, -1, -1) },
    uSfuma: { value: SFUMA_TESTO },
    uBordo: { value: new THREE.Vector2(1, 1) },
  };
  const pareteMat = new THREE.ShaderMaterial({ uniforms: uParete, vertexShader: PARETE_V, fragmentShader: PARETE_F, toneMapped: false });
  const piano = new THREE.PlaneGeometry(1, 1);
  const parete = new THREE.Mesh(piano, pareteMat);
  parete.renderOrder = 0;
  parete.frustumCulled = false;
  scena.add(parete);

  // quadro: fianchi e superficie dipinta in un gruppo che ruota appena (parallasse)
  const gruppo = new THREE.Group();
  scena.add(gruppo);
  const uFianchi = { mappa: { value: null }, uLuce: { value: new THREE.Vector3() }, uIntensita: { value: 1 } };
  const fianchiMat = new THREE.ShaderMaterial({
    uniforms: uFianchi, vertexShader: FIANCHI_V, fragmentShader: FIANCHI_F, side: THREE.DoubleSide, toneMapped: false,
  });
  const geoFianchi = geometriaFianchi();
  const fianchi = new THREE.Mesh(geoFianchi, fianchiMat);
  fianchi.renderOrder = 1;
  fianchi.frustumCulled = false;
  fianchi.visible = false;
  gruppo.add(fianchi);
  let materiale = null;     // materialeDipinto, creato con la prima texture
  const fronte = new THREE.Mesh(piano, pareteMat);
  fronte.renderOrder = 2;
  fronte.frustumCulled = false;
  fronte.visible = false;
  gruppo.add(fronte);

  // velo del buio: copre tutto col colore del muro mentre si cambia opera
  const uVelo = { uMuro: { value: muro.clone() }, uOpacita: { value: 0 } };
  const veloMat = new THREE.ShaderMaterial({
    uniforms: uVelo, vertexShader: VELO_V, fragmentShader: VELO_F, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const velo = new THREE.Mesh(piano, veloMat);
  velo.renderOrder = 3;
  velo.frustumCulled = false;
  velo.visible = false;
  scena.add(velo);

  // ---------------------------------------------------------------- stato

  let W = 0;
  let H = 0;
  let distanza = 1;
  let q = { x: 0, y: 0, w: 1, h: 1 };     // rettangolo dell'opera (px rispetto alla sezione)
  let misure = { w: 1, h: 1 };            // misure reali (m)
  let pxm = 1;                            // px per metro

  let voce = null;           // opera sul muro: { opera, chiave, texture, rapporto, tinta }
  let destinazione = null;   // { opera, verso }: dove vuole andare la regia
  let prossima = null;       // voce caricata della destinazione
  let fase = 'attesa';       // attesa → compila → intro → fermo ⇄ spegni → buio → accendi → fermo
  let livello = 1;           // luce: 0 = buio, 1 = piena
  let entrata = 1;           // 0 → 1 mentre la lampada entra dal lato
  let tBuio = 0;
  let arrivo = true;         // la prima entrata della luce (passata d'arrivo), fino al primo cambio d'opera
  let intensita = 1;         // intensità della lampada sul quadro, smorzata (nessun salto se un cambio ne interrompe un altro)
  let visto = false;         // il canvas è comparso
  let attese = [];           // promesse di vai() in attesa che la luce torni
  let fermato = false;
  let guastato = false;

  const ingresso = new THREE.Vector3(-LATO, 0.15, RASENTE);
  const lampada = new THREE.Vector3().copy(ingresso);   // posizione effettiva
  const inseguita = new THREE.Vector3(1, 0.4, ALTEZZA);  // segue il puntatore o la deriva, smorzata
  const meta = new THREE.Vector3();
  const vDeriva = new THREE.Vector3();
  const vPuntatore = new THREE.Vector3();
  const luceM = new THREE.Vector3();
  const luceMondo = new THREE.Vector3();
  let T = 0;                 // tempo della deriva (s)

  // puntatore (solo mouse e penna: col dito la lampada va da sola). Il tempo è sempre quello di
  // requestAnimationFrame: `mosso` segnala il movimento e il ciclo ne annota l'istante.
  const puntatore = { x: 0, y: 0, sx: 0, sy: 0, peso: 0, voluto: 0, mosso: false, ultimo: -1e9 };
  const suMuovi = (e) => {
    if (e.pointerType === 'touch') return;
    const s = radice.getBoundingClientRect();
    puntatore.x = e.clientX - s.left;
    puntatore.y = e.clientY - s.top;
    puntatore.sx = limita((puntatore.x / s.width) * 2 - 1, -1, 1);
    puntatore.sy = limita((puntatore.y / s.height) * 2 - 1, -1, 1);
    puntatore.voluto = 1;
    puntatore.mosso = true;
  };
  const suLascia = (e) => { if (e.pointerType !== 'touch') puntatore.voluto = 0; };
  radice.addEventListener('pointermove', suMuovi, { passive: true });
  radice.addEventListener('pointerleave', suLascia, { passive: true });

  const suPerso = () => guasto('context lost');
  tela.addEventListener('webglcontextlost', suPerso);

  // ---------------------------------------------------------------- texture (al massimo 3 vive)

  const voci = new Map();    // chiave → Promise<voce>
  const vive = new Set();    // voci con la texture creata, per liberarle subito
  let precaricata = null;
  const urlDi = (o) => (dettaglio && o.immagine.file) || o.immagine.miniatura;
  const chiaveDi = (o) => (o ? `${o.id}|${urlDi(o)}` : '');

  function creaVoce(opera, chiave, img) {
    if (fermato) return null;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const k = Math.min(1, (dettaglio ? 1600 : 1024) / Math.max(nw, nh));
    let sorgente = img;
    if (k < 1) {   // ridotta prima di andare sulla GPU
      sorgente = document.createElement('canvas');
      sorgente.width = Math.round(nw * k);
      sorgente.height = Math.round(nh * k);
      const g = sorgente.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, sorgente.width, sorgente.height);
    }
    const texture = new THREE.Texture(sorgente);
    texture.colorSpace = THREE.SRGBColorSpace;   // mipmap e LinearMipmapLinearFilter restano quelli predefiniti
    texture.anisotropy = anisotropia;
    texture.needsUpdate = true;
    const v = { opera, chiave, texture, rapporto: nw / nh, tinta: coloreDominante(sorgente) };
    vive.add(v);
    return v;
  }

  function carica(o) {
    const chiave = chiaveDi(o);
    let p = voci.get(chiave);
    if (!p) {
      p = leggiImmagine(urlDi(o)).then((img) => creaVoce(o, chiave, img));
      voci.set(chiave, p);
      p.catch(() => voci.delete(chiave));
    }
    return p;
  }

  function libera(v) {
    if (!v || !vive.has(v)) return;
    vive.delete(v);
    v.texture.dispose();
  }

  // Tiene solo l'opera sul muro, la destinazione e quella precaricata.
  function pulisci() {
    const tieni = new Set([voce?.chiave, prossima?.chiave, chiaveDi(destinazione?.opera), precaricata]);
    for (const [k, p] of voci) {
      if (tieni.has(k)) continue;
      voci.delete(k);
      p.then(libera, () => {});
    }
  }

  // ---------------------------------------------------------------- impaginazione

  function disponi() {
    const s = radice.getBoundingClientRect();
    if (!s.width || !s.height) return false;
    if (s.width !== W || s.height !== H) {
      W = s.width;
      H = s.height;
      renderer.setSize(W, H, false);
      distanza = H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      camera.aspect = W / H;
      camera.near = distanza * 0.25;
      camera.far = distanza * 2;
      camera.position.set(0, 0, distanza);
      camera.updateProjectionMatrix();
      parete.scale.set(W * 1.3, H * 1.3, 1);
      uParete.uBordo.value.set(W / 2, H / 2);
    }
    const t = zonaTesto?.();
    if (t) uParete.uTesto.value.set(t.x + t.w / 2 - W / 2, H / 2 - (t.y + t.h / 2), t.w / 2, t.h / 2);
    if (!voce) return true;
    q = rettangolo(voce.rapporto);
    misure = misureOpera(voce.opera, voce.rapporto);
    pxm = q.w / misure.w;
    gruppo.position.set(q.x + q.w / 2 - W / 2, H / 2 - (q.y + q.h / 2), 0);
    fronte.scale.set(q.w, q.h, 1);
    const prof = limita(0.02 * Math.max(q.w, q.h), 6, 16);
    fianchi.scale.set(q.w, q.h, prof);
    parete.position.z = -prof;
    uParete.uQ.value.set(gruppo.position.x, gruppo.position.y, q.w / 2, q.h / 2);
    uParete.uProf.value = prof;
    uParete.uRaggio.value = 0.7 * Math.max(q.w, q.h);
    materiale.uniforms.uDim.value.set(misure.w, misure.h);
    return true;
  }

  // L'opera v va sul muro (al buio, oppure la prima volta).
  function applica(v) {
    if (!materiale) {
      materiale = materialeDipinto({
        mappa: v.texture, larghezza: 1, altezza: 1, forza: forzaRilievo(v.opera),
        intensita: 1, portata: PORTATA, ambiente: AMBIENTE, radente: RADENTE, lucido: LUCIDO,
      });
      fronte.material = materiale;
      fronte.visible = true;
      fianchi.visible = true;
    } else cambiaMappa(materiale, v.texture);
    materiale.uniforms.uForza.value = forzaRilievo(v.opera);
    uFianchi.mappa.value = v.texture;
    uParete.uTinta.value.copy(v.tinta);
    voce = v;
    disponi();
  }

  // ---------------------------------------------------------------- lampada e fasi

  // Deriva lenta (Lissajous) attorno e sopra il quadro, quando nessuno muove il mouse.
  function deriva(v, t) {
    return v.set(1.05 * Math.cos((DUE_PI * t) / 17), 0.7 * Math.sin((DUE_PI * t) / 11 + 0.7), ALTEZZA + 0.025 * Math.sin((DUE_PI * t) / 13));
  }

  // Sopra il quadro la lampada segue il puntatore; fuori resta vicino al bordo da quel lato, più bassa (radente).
  function versoPuntatore(v) {
    const nx = (puntatore.x - (q.x + q.w / 2)) / (q.w / 2);
    const ny = -(puntatore.y - (q.y + q.h / 2)) / (q.h / 2);
    const fuori = Math.max(Math.abs(nx), Math.abs(ny));
    return v.set(limita(nx * 1.12, -1.3, 1.3), limita(ny * 1.12, -1.3, 1.3), ALTEZZA + (RASENTE * 1.2 - ALTEZZA) * liscio(limita((fuori - 0.7) / 0.5, 0, 1)));
  }

  const prossimaPronta = () => !!prossima && prossima !== voce;

  function risolvi(esito) {
    const a = attese;
    attese = [];
    for (const r of a) r(esito);
  }

  function scambia() {
    applica(prossima);
    ingresso.set(destinazione?.verso < 0 ? LATO : -LATO, 0.15, RASENTE);
    entrata = 0;
    arrivo = false;
    pulisci();
    suBuio?.(voce.opera, voce.rapporto);
  }

  function inizia() {   // la prima opera: si compila in parallelo, poi la luce entra da sinistra
    applica(prossima);
    fase = 'compila';
    const via = () => { if (!fermato && fase === 'compila') { fase = 'intro'; entrata = 0; livello = 1; } };
    // compilazione in parallelo dove il browser la offre (KHR_parallel_shader_compile), altrimenti al primo disegno
    const parallela = renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile');
    (parallela ? renderer.compileAsync(scena, camera) : Promise.resolve()).then(via, via);
  }

  function aggiorna(dt, ora) {
    T += dt;
    if (puntatore.mosso) { puntatore.mosso = false; puntatore.ultimo = ora; }
    if (ora - puntatore.ultimo > 4000) puntatore.voluto = 0;   // mouse fermo da 4 s: torna la deriva
    puntatore.peso += (puntatore.voluto - puntatore.peso) * (1 - Math.exp(-dt * (puntatore.voluto ? 4 : 0.8)));
    deriva(vDeriva, T);
    if (puntatore.peso > 0.001) meta.lerpVectors(vDeriva, versoPuntatore(vPuntatore), puntatore.peso);
    else meta.copy(vDeriva);
    inseguita.lerp(meta, 1 - Math.exp(-dt * 3.5));

    switch (fase) {
      case 'intro':
        entrata = Math.min(1, entrata + dt / INTRO);
        if (prossimaPronta()) { fase = 'spegni'; suSpegni?.(); } else if (entrata >= 1) { fase = 'fermo'; risolvi(true); }
        break;
      case 'fermo':
        if (prossimaPronta()) { fase = 'spegni'; suSpegni?.(); }
        break;
      case 'spegni':
        if (destinazione?.opera === voce.opera) { fase = 'accendi'; break; }   // si è tornati all'opera sul muro
        livello = Math.max(0, livello - dt / SPEGNI);
        if (livello === 0 && prossimaPronta()) { scambia(); fase = 'buio'; tBuio = 0; }
        break;
      case 'buio':
        tBuio += dt;
        if (prossimaPronta()) { scambia(); tBuio = 0; }
        if (tBuio >= BUIO && destinazione?.opera === voce.opera) fase = 'accendi';
        break;
      case 'accendi':
        if (prossimaPronta()) { fase = 'spegni'; suSpegni?.(); break; }
        livello = Math.min(1, livello + dt / ACCENDI);
        if (entrata < 1) entrata = Math.min(1, entrata + dt / ACCENDI);
        if (livello >= 1 && entrata >= 1) { fase = 'fermo'; risolvi(true); }
        break;
    }
    lampada.lerpVectors(ingresso, inseguita, entraEsce(entrata));
    // spegnendo, la lampada cala piano; riaccendendo, si accende presto ma illumina prima il lato vicino
    const voluta = fase === 'accendi' || fase === 'buio' ? liscio(Math.min(1, livello * 2.5)) : liscio(livello);
    intensita += (voluta - intensita) * (1 - Math.exp(-dt * 14));

    // parallasse col mouse, al massimo ±2°: chi guarda da destra vede il fianco destro della tela
    const k = 1 - Math.exp(-dt * 3);
    const peso = dettaglio ? puntatore.peso : 0;
    gruppo.rotation.y += (-0.0349 * puntatore.sx * peso - gruppo.rotation.y) * k;
    gruppo.rotation.x += (-0.026 * puntatore.sy * peso - gruppo.rotation.x) * k;
  }

  function luci() {
    const L = Math.max(misure.w, misure.h);
    luceM.set((lampada.x * misure.w) / 2, (lampada.y * misure.h) / 2, lampada.z * L);
    const u = materiale.uniforms;
    u.uLuce.value.copy(luceM);
    u.uOcchio.value.set(-gruppo.position.x / pxm, -gruppo.position.y / pxm, distanza / pxm);
    // la luce entra da un lato: all'inizio scende in fretta con la distanza dalla lampada, poi si distende
    const e = esce(entrata);
    u.uPortata.value = (PORTATA + (1 - e) * (arrivo ? PORTATA_INTRO : PORTATA_ENTRATA)) / (L * L);
    u.uAmbiente.value = AMBIENTE * (arrivo ? 1 : AMBIENTE_ENTRATA + (1 - AMBIENTE_ENTRATA) * e);
    u.uIntensita.value = intensita;
    const luce = liscio(livello);

    luceMondo.copy(luceM).multiplyScalar(pxm).applyQuaternion(gruppo.quaternion).add(gruppo.position);
    uParete.uLuce.value.copy(luceMondo);
    uParete.uIntensita.value = luce * (0.35 + 0.65 * esce(entrata));
    uFianchi.uLuce.value.copy(luceMondo);
    uFianchi.uIntensita.value = luce;
    // il velo del buio si alza prima che la lampada sia piena: così si vede la luce arrivare dal lato
    const velo1 = 1 - liscio(Math.min(1, livello * 1.6));
    uVelo.uOpacita.value = velo1;
    velo.visible = velo1 > 0.001;
  }

  // ---------------------------------------------------------------- ciclo di disegno

  let attivo = false;
  let richiesta = 0;
  let ultimo = -1;           // istante dell'ultimo fotogramma disegnato (-1 = appena riattivato)
  let tick = 0;
  let tickDisegno = 0;
  let riscaldamento = 0;
  const campioni = [];

  function disegna() {
    luci();
    renderer.render(scena, camera);
  }

  // Governatore: mediana dei fotogrammi oltre 22 ms → DPR 1; oltre 30 ms → si torna allo strato statico.
  function governa(intervallo) {
    if (++riscaldamento < RISCALDAMENTO) return;   // compilazione, caricamento della texture, comparsa del canvas
    campioni.push(intervallo);
    if (campioni.length < CAMPIONI) return;
    const mediana = campioni.sort((a, b) => a - b)[campioni.length >> 1];
    campioni.length = 0;
    if (mediana > 30) guasto(`slow: ${mediana.toFixed(1)} ms per frame`);
    else if (mediana > 22 && dpr > 1) {
      dpr = 1;
      renderer.setPixelRatio(dpr);   // svuota il canvas: si ridisegna subito
      disegna();
      riscaldamento = RISCALDAMENTO - 15;
    }
  }

  function ciclo(ora) {
    richiesta = requestAnimationFrame(ciclo);
    tick += 1;
    if (fase === 'attesa') {
      if (!prossima) return;
      inizia();
    }
    if (fase === 'compila') return;
    // a riposo (nessun cambio, mouse fermo) 30 fotogrammi al secondo
    if (visto && fase === 'fermo' && !puntatore.mosso && ora - puntatore.ultimo > 1500 && tick % 2) return;
    if (ultimo < 0) ultimo = ora;
    const passi = Math.max(1, tick - tickDisegno);
    tickDisegno = tick;
    const intervallo = (ora - ultimo) / passi;
    const dt = limita((ora - ultimo) / 1000, 0, 0.1);
    ultimo = ora;
    try {
      aggiorna(dt, ora);
      disegna();
    } catch (err) {
      console.error(err);
      guasto('error');
      return;
    }
    if (!visto) {
      visto = true;
      tela.classList.add('accesa');   // il primo fotogramma illuminato è pronto: il canvas entra in dissolvenza
      suPronto?.();
    }
    governa(intervallo);
  }

  function attiva(si) {
    si = !!si && !fermato && !guastato;
    if (si === attivo) return;
    attivo = si;
    if (si) {
      ultimo = -1;
      riscaldamento = Math.min(riscaldamento, RISCALDAMENTO - 15);
      campioni.length = 0;
      richiesta = requestAnimationFrame(ciclo);
    } else cancelAnimationFrame(richiesta);
  }

  // Lo strato statico prende il posto del canvas, senza rettangolo nero: il canvas sparisce subito.
  function guasto(motivo) {
    if (fermato || guastato) return;
    guastato = true;
    attiva(false);
    tela.style.transition = 'none';
    tela.classList.remove('accesa');
    setTimeout(() => suGuasto?.(motivo), 0);
  }

  // ---------------------------------------------------------------- interfaccia per la regia

  return {
    // Porta l'opera sul muro (la prima volta con la passata d'arrivo, poi con un cambio di luce).
    // Si risolve con true quando la luce è tornata piena su quell'opera, con false se superata da un'altra richiesta.
    vai(opera, verso = 1) {
      return new Promise((r) => {
        if (fermato || guastato) { r(false); return; }
        const precedenti = attese;
        attese = [r];
        for (const p of precedenti) p(false);
        destinazione = { opera, verso };
        if (voce?.opera === opera) {
          prossima = voce;
          if (fase === 'fermo') risolvi(true);
          return;
        }
        prossima = null;
        pulisci();
        carica(opera).then((v) => {
          if (!v || fermato || destinazione?.opera !== opera) return;
          prossima = v;
          pulisci();
        }, () => guasto('image not available'));
      });
    },
    precarica(opera) {
      if (fermato || guastato) return;
      precaricata = chiaveDi(opera);
      pulisci();
      carica(opera).then((v) => { if (v && vive.has(v) && !fermato) renderer.initTexture(v.texture); }, () => {});
    },
    attiva,
    ridimensiona() {
      if (fermato || guastato) return;
      // ridisegna subito: cambiare le misure del canvas lo svuota
      if (disponi() && voce && visto && materiale) disegna();
    },
    ferma() {
      if (fermato) return;
      fermato = true;
      attivo = false;
      cancelAnimationFrame(richiesta);
      risolvi(false);
      radice.removeEventListener('pointermove', suMuovi);
      radice.removeEventListener('pointerleave', suLascia);
      tela.removeEventListener('webglcontextlost', suPerso);
      for (const v of [...vive]) libera(v);
      voci.clear();
      for (const m of [materiale, fianchiMat, pareteMat, veloMat]) m?.dispose();
      piano.dispose();
      geoFianchi.dispose();
      renderer.dispose();
      // il contesto si libera subito, senza aspettare il garbage collector (mai più di 2 contesti vivi)
      if (!contesto.isContextLost()) renderer.forceContextLoss();
      tela.remove();
    },
  };
}
