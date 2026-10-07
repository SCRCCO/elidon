// Prima schermata: le opere in evidenza sospese in un anello che ruota lentamente.
// Trascinando si fa girare l'anello, cliccando un quadro lo si apre.
import * as THREE from 'three';

const SFONDO = 0x0f0e0d;

export function avvia(contenitore, opere, { suClic } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(SFONDO, 0);
  contenitore.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scena = new THREE.Scene();
  scena.fog = new THREE.Fog(SFONDO, 6, 15);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);

  // Con poche opere l'anello resterebbe vuoto: le ripetiamo fino ad almeno 9 posti.
  const posti = [];
  while (posti.length < Math.max(9, opere.length)) posti.push(opere[posti.length % opere.length]);
  const raggio = posti.length * 0.36;
  const anello = new THREE.Group();
  scena.add(anello);

  const caricatore = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const cache = new Map();
  const quadri = [];

  posti.forEach((opera, i) => {
    const img = opera.immagine;
    const rapporto = img.larghezza && img.altezza ? img.larghezza / img.altezza : 0.8;
    const lungo = 1.75;
    const w = rapporto >= 1 ? lungo : lungo * rapporto;
    const h = rapporto >= 1 ? lungo / rapporto : lungo;
    // Materiali propri per ogni quadro: servono a farlo svanire quando si gira di spalle.
    const fronte = new THREE.MeshBasicMaterial({ color: 0x2a2724, transparent: true });
    const lati = new THREE.MeshBasicMaterial({ color: 0x1d1b19, transparent: true });
    if (!cache.has(img.miniatura)) {
      cache.set(img.miniatura, caricatore.loadAsync(img.miniatura).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(4, maxAniso);
        return t;
      }));
    }
    cache.get(img.miniatura).then((t) => { fronte.map = t; fronte.color.set(0xffffff); fronte.needsUpdate = true; }).catch(() => {});
    const tela = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), [lati, lati, lati, lati, fronte, lati]);
    const angolo = (i / posti.length) * Math.PI * 2;
    const quadro = new THREE.Group();
    quadro.add(tela);
    quadro.position.set(Math.sin(angolo) * raggio, Math.sin(i * 1.7) * 0.32, Math.cos(angolo) * raggio);
    quadro.rotation.y = angolo;
    quadro.userData = { opera, base: quadro.position.y, fase: i * 0.9, scala: 1, materiali: [fronte, lati] };
    tela.userData.quadro = quadro;
    anello.add(quadro);
    quadri.push(quadro);
  });

  // Pulviscolo luminoso
  const nPolvere = 700;
  const posizioni = new Float32Array(nPolvere * 3);
  for (let i = 0; i < nPolvere; i++) {
    posizioni[i * 3] = (Math.random() - 0.5) * 22;
    posizioni[i * 3 + 1] = (Math.random() - 0.5) * 10;
    posizioni[i * 3 + 2] = (Math.random() - 0.5) * 18;
  }
  const geoPolvere = new THREE.BufferGeometry();
  geoPolvere.setAttribute('position', new THREE.BufferAttribute(posizioni, 3));
  const polvere = new THREE.Points(geoPolvere, new THREE.PointsMaterial({
    color: 0xf1d9b8, size: 0.028, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scena.add(polvere);

  // Inquadratura: su schermi larghi l'anello sta a destra, lasciando spazio al nome.
  let centro = new THREE.Vector3();
  function ridimensiona() {
    const { width, height } = contenitore.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const largo = camera.aspect > 1.1;
    centro = new THREE.Vector3(0, largo ? 0.2 : 0.6, 0);
    camera.position.set(0, centro.y + 0.9, raggio + (largo ? 7.2 : 8.4));
    camera.fov = largo ? 36 : 50;
    // l'inquadratura viene spostata: a destra su schermi larghi, in alto sui telefoni
    camera.setViewOffset(width, height, largo ? -width * 0.2 : 0, largo ? height * 0.04 : height * 0.16, width, height);
    camera.updateProjectionMatrix();
    anello.position.copy(centro);
  }

  const verso = new THREE.Vector3();
  const normale = new THREE.Vector3();
  const posMondo = new THREE.Vector3();

  // Interazione
  const mouse = new THREE.Vector2(0, 0);
  const puntatore = new THREE.Vector2(2, 2);
  const raggioClic = new THREE.Raycaster();
  let velocita = 0.0012;
  let trascina = null;
  let sopra = null;

  const tela = renderer.domElement;
  const coordinate = (e) => {
    const r = tela.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
  };
  const colpito = () => {
    raggioClic.setFromCamera(puntatore, camera);
    const hit = raggioClic.intersectObjects(quadri.filter((q) => q.visible), true)[0];
    return hit ? hit.object.userData.quadro : null;
  };

  tela.addEventListener('pointerdown', (e) => {
    trascina = { x: e.clientX, y: e.clientY, ultimo: e.clientX, mosso: 0 };
  });
  window.addEventListener('pointerup', (e) => {
    if (!trascina) return;
    const fermo = trascina.mosso < 6;
    trascina = null;
    if (fermo && e.target === tela) {
      [puntatore.x, puntatore.y] = coordinate(e);
      const q = colpito();
      if (q && suClic) suClic(q.userData.opera);
    }
  });
  tela.addEventListener('pointermove', (e) => {
    [puntatore.x, puntatore.y] = coordinate(e);
    [mouse.x, mouse.y] = [puntatore.x, puntatore.y];
    if (trascina) {
      const dx = e.clientX - trascina.ultimo;
      trascina.ultimo = e.clientX;
      trascina.mosso += Math.abs(dx);
      velocita = dx * 0.0022;
    }
  });
  tela.addEventListener('pointerleave', () => { puntatore.set(2, 2); mouse.set(0, 0); });
  tela.addEventListener('pointercancel', () => { trascina = null; });

  // Ciclo di disegno, sospeso quando la scena non è visibile
  let ultimo = performance.now();
  let t = 0;
  let attivo = false;
  let richiesta = 0;
  function fotogramma() {
    richiesta = requestAnimationFrame(fotogramma);
    const ora = performance.now();
    const dt = Math.min((ora - ultimo) / 1000, 0.05);
    ultimo = ora;
    t += dt;

    if (!trascina) velocita += (0.0012 - velocita) * 0.02;
    anello.rotation.y += velocita * dt * 60;

    camera.position.x += ((centro.x + mouse.x * 0.6) - camera.position.x) * 0.04;
    camera.position.y += ((centro.y + 0.9 + mouse.y * 0.35) - camera.position.y) * 0.04;
    camera.lookAt(centro.x, centro.y, centro.z);

    sopra = trascina ? null : colpito();
    tela.style.cursor = trascina ? 'grabbing' : sopra ? 'pointer' : 'grab';
    for (const q of quadri) {
      const d = q.userData;
      // quanto il quadro guarda verso la camera: di spalle svanisce
      q.getWorldPosition(posMondo);
      normale.set(0, 0, 1).applyQuaternion(q.getWorldQuaternion(new THREE.Quaternion()));
      verso.copy(camera.position).sub(posMondo).normalize();
      const fronte = THREE.MathUtils.smoothstep(normale.dot(verso), -0.05, 0.4);
      q.visible = fronte > 0.01;
      for (const m of d.materiali) m.opacity = fronte;
      q.position.y = d.base + Math.sin(t * 0.6 + d.fase) * 0.06;
      d.scala += ((q === sopra ? 1.07 : 1) - d.scala) * 0.12;
      q.scale.setScalar(d.scala);
    }
    polvere.rotation.y = t * 0.012;
    polvere.position.y = Math.sin(t * 0.2) * 0.15;

    renderer.render(scena, camera);
  }
  function aggiornaStato(visibile) {
    const deve = visibile && !document.hidden;
    if (deve && !attivo) { attivo = true; ultimo = performance.now(); fotogramma(); }
    if (!deve && attivo) { attivo = false; cancelAnimationFrame(richiesta); }
  }

  let visibile = true;
  const osservatore = new IntersectionObserver(([r]) => { visibile = r.isIntersecting; aggiornaStato(visibile); });
  osservatore.observe(contenitore);
  const suVisibilita = () => aggiornaStato(visibile);
  document.addEventListener('visibilitychange', suVisibilita);
  const ro = new ResizeObserver(ridimensiona);
  ro.observe(contenitore);
  ridimensiona();
  aggiornaStato(true);
  requestAnimationFrame(() => tela.classList.add('pronta'));

  return {
    ferma() {
      aggiornaStato(false);
      osservatore.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', suVisibilita);
      renderer.dispose();
      tela.remove();
    },
  };
}
