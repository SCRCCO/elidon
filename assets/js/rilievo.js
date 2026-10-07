// Luce radente sulla materia: il rilievo della pittura ricavato dalla foto e illuminato da una lampada bassa.
// Condiviso da prima schermata (apertura3d.js) e galleria 3D (galleria3d.js).
//
// Principi (decisi con la «giuria» di progetto, da non tradire):
// - la foto resta la verità: con la luce frontale e piena il risultato è identico al JPEG;
// - l'effetto è contenuto (±MODULAZIONE) e la lucentezza compare solo sulle creste;
// - il rilievo si legge su un livello di mipmap leggermente sfocato e con gradiente «saturato»,
//   così i blocchi JPEG e i grandi contorni delle figure non diventano un finto bassorilievo;
// - nessun render target, nessuna marcia d'ombra: 5 letture di texture per pixel, adatto ai telefoni medi.
import * as THREE from 'three';

export const MODULAZIONE = 0.18;   // escursione massima della luce radente (±18%)
export const FORZA = 1;            // intensità del rilievo per le opere con campo «Rilievo» vuoto

// Campo facoltativo dell'opera «Rilievo nella luce radente»: '' = automatico, 'Leggero', 'Nessuno'.
export function forzaRilievo(opera) {
  const v = typeof opera?.rilievo === 'string' ? opera.rilievo.trim().toLowerCase() : '';
  if (v === 'nessuno') return 0;
  if (v === 'leggero') return FORZA * 0.5;
  return FORZA;
}

const VERTICE = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAMMENTO = /* glsl */ `
  precision highp float;
  uniform sampler2D mappa;
  uniform vec2 uTexel;        // 1 / dimensione della texture in pixel
  uniform vec2 uDim;          // misure reali della superficie (m), larghezza × altezza
  uniform vec3 uLuce;         // posizione della lampada nello spazio della superficie (m): centro = 0, z verso chi guarda
  uniform vec3 uOcchio;       // posizione dell'osservatore nello stesso spazio (m)
  uniform float uForza;       // 0 = nessun rilievo
  uniform float uIntensita;   // 0 = spento, 1 = luce piena
  uniform float uPortata;     // attenuazione con la distanza: 1 / (1 + d² · uPortata)
  uniform float uAmbiente;    // luce che resta anche lontano dalla lampada (0–1)
  uniform float uRadente;     // quanto conta la luce radente (0 = foto piatta)
  uniform float uModulazione; // limite dell'escursione (es. 0.18)
  uniform float uLucido;      // lucentezza sulle creste (0–0.3)
  uniform float uBias;        // livello di mipmap in più per leggere il rilievo (≈ 0.8)
  varying vec2 vUv;

  float luminanza(vec2 uv) {
    return dot(texture2D(mappa, uv, uBias).rgb, vec3(0.2126, 0.7152, 0.0722));
  }

  // rumore senza sin(): niente strisce sulle GPU mobili
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec4 colore = texture2D(mappa, vUv);
    vec3 albedo = colore.rgb;

    // normale dal gradiente di luminanza, saturato: le pennellate emergono, i grandi contorni no
    vec2 e = uTexel * 1.5;
    float gx = luminanza(vUv + vec2(e.x, 0.0)) - luminanza(vUv - vec2(e.x, 0.0));
    float gy = luminanza(vUv + vec2(0.0, e.y)) - luminanza(vUv - vec2(0.0, e.y));
    vec2 g = vec2(gx, gy) * uForza * 6.0;
    g /= 1.0 + 4.0 * length(g);
    vec3 n = normalize(vec3(-g, 1.0));

    vec3 P = vec3((vUv - 0.5) * uDim, 0.0);
    vec3 Lv = uLuce - P;
    float d = length(Lv);
    vec3 L = Lv / max(d, 1e-4);

    // termine radente che vale 1 sulle zone piatte: la media resta quella della foto
    float radente = dot(n, L) / max(L.z, 0.2);
    radente = clamp(radente, 1.0 - uModulazione, 1.0 + uModulazione);
    float att = uIntensita / (1.0 + d * d * uPortata);
    float luce = uAmbiente + (1.0 - uAmbiente) * att * mix(1.0, radente, uRadente);

    // lucentezza solo dove la pasta è in rilievo (gradiente forte)
    vec3 V = normalize(uOcchio - P);
    vec3 H = normalize(L + V);
    float cresta = smoothstep(0.08, 0.35, length(g));
    float lucido = pow(max(dot(n, H), 0.0), 48.0) * uLucido * cresta * att;

    vec3 risultato = albedo * luce + vec3(1.0, 0.96, 0.9) * lucido;
    risultato += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(risultato, colore.a);
    #include <colorspace_fragment>
  }
`;

// Materiale della superficie dipinta. `mappa` è una THREE.Texture con colorSpace SRGB e mipmap attive.
// Le uniform si possono cambiare a ogni fotogramma (es. materiale.uniforms.uLuce.value.set(x, y, z)).
export function materialeDipinto({
  mappa,
  larghezza = 1,
  altezza = 1,
  forza = FORZA,
  intensita = 1,
  portata = 0.6,
  ambiente = 0.45,
  radente = 0.85,
  modulazione = MODULAZIONE,
  lucido = 0.12,
  bias = 0.8,
} = {}) {
  const img = mappa?.image;
  const w = img?.naturalWidth || img?.width || 1024;
  const h = img?.naturalHeight || img?.height || 1024;
  return new THREE.ShaderMaterial({
    uniforms: {
      mappa: { value: mappa },
      uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
      uDim: { value: new THREE.Vector2(larghezza, altezza) },
      uLuce: { value: new THREE.Vector3(-larghezza, altezza * 0.3, Math.max(larghezza, altezza) * 0.35) },
      uOcchio: { value: new THREE.Vector3(0, 0, Math.max(larghezza, altezza) * 2) },
      uForza: { value: forza },
      uIntensita: { value: intensita },
      uPortata: { value: portata },
      uAmbiente: { value: ambiente },
      uRadente: { value: radente },
      uModulazione: { value: modulazione },
      uLucido: { value: lucido },
      uBias: { value: bias },
    },
    vertexShader: VERTICE,
    fragmentShader: FRAMMENTO,
    toneMapped: false,
  });
}

// Da chiamare quando la texture del materiale cambia (aggiorna anche le dimensioni in pixel).
export function cambiaMappa(materiale, mappa) {
  const img = mappa?.image;
  const w = img?.naturalWidth || img?.width || 1024;
  const h = img?.naturalHeight || img?.height || 1024;
  materiale.uniforms.mappa.value = mappa;
  materiale.uniforms.uTexel.value.set(1 / w, 1 / h);
}
