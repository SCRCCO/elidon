// Costruisce il sito a partire da contenuti/sito.json.
// Il testo viene sempre inserito come testo semplice (textContent), mai come HTML.

const FILE_CONTENUTI = 'contenuti/sito.json';

const $ = (sel, radice = document) => radice.querySelector(sel);
const $$ = (sel, radice = document) => [...radice.querySelectorAll(sel)];

let dati = null;
let opereVisibili = [];   // opere dopo il filtro, nell'ordine della griglia
let indiceVisore = -1;
let sala = null;          // controller della galleria 3D, se aperta
let pannelloDaStoria = false;

// ---------------------------------------------------------------- utilità

function crea(tag, attributi = {}, figli = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'testo') nodo.textContent = v;
    else if (k === 'classe') nodo.className = v;
    else if (k.startsWith('su')) nodo.addEventListener(k.slice(2).toLowerCase(), v);
    else nodo.setAttribute(k, v === true ? '' : v);
  }
  for (const f of [].concat(figli)) if (f) nodo.append(f);
  return nodo;
}

function leggi(percorso) {
  return percorso.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dati);
}

function testo(v) { return typeof v === 'string' ? v.trim() : ''; }

// Riga vuota = nuovo paragrafo; a capo singolo = a capo nel paragrafo.
function paragrafi(contenuto) {
  return testo(contenuto).split(/\n\s*\n/).filter(Boolean).map((blocco) => {
    const p = document.createElement('p');
    blocco.split('\n').forEach((riga, i) => {
      if (i) p.append(document.createElement('br'));
      p.append(riga);
    });
    return p;
  });
}

function immagine(v) {
  if (!v) return null;
  if (typeof v === 'string') return { file: v, miniatura: v };
  if (!v.file) return null;
  return { file: v.file, miniatura: v.miniatura || v.file, larghezza: v.larghezza, altezza: v.altezza };
}

function linkSicuro(url) {
  const u = testo(url);
  return /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : null;
}

function bloccaScorrimento(si) {
  document.documentElement.style.overflow = si ? 'hidden' : '';
}

// ---------------------------------------------------------------- testi semplici

function riempiTesti() {
  for (const nodo of $$('[data-testo]')) {
    const v = testo(leggi(nodo.dataset.testo));
    nodo.textContent = v;
  }
  for (const nodo of $$('[data-paragrafi]')) nodo.replaceChildren(...paragrafi(leggi(nodo.dataset.paragrafi)));
  $('[data-anno]').textContent = new Date().getFullYear();

  const citazione = $('[data-citazione]');
  citazione.hidden = !testo(dati.biografia?.citazione);

  const nome = testo(dati.sito?.nome);
  const professione = testo(dati.sito?.professione);
  const descrizione = testo(dati.sito?.descrizione_seo);
  if (nome) {
    document.title = professione ? `${nome} — ${professione}` : nome;
    $('meta[property="og:title"]').setAttribute('content', document.title);
  }
  if (descrizione) {
    $('meta[name="description"]').setAttribute('content', descrizione);
    $('meta[property="og:description"]').setAttribute('content', descrizione);
  }
  const primaOpera = immagine(dati.opere?.[0]?.immagine);
  if (primaOpera) document.head.append(crea('meta', { property: 'og:image', content: new URL(primaOpera.file, location.href).href }));

  // Dati strutturati per i motori di ricerca
  const persona = { '@context': 'https://schema.org', '@type': 'Person', name: nome, jobTitle: professione, url: location.origin + location.pathname };
  const sameAs = ['instagram', 'facebook', 'youtube'].map((k) => linkSicuro(dati.contatti?.[k])).filter(Boolean);
  if (sameAs.length) persona.sameAs = sameAs;
  if (descrizione) persona.description = descrizione;
  document.head.append(crea('script', { type: 'application/ld+json', testo: JSON.stringify(persona) }));

  const foto = immagine(dati.biografia?.foto);
  const figura = $('[data-foto-biografia]');
  figura.replaceChildren();
  if (foto) {
    figura.append(crea('img', {
      src: foto.miniatura, alt: nome ? `Ritratto di ${nome}` : 'Ritratto', loading: 'lazy', decoding: 'async',
      width: foto.larghezza, height: foto.altezza,
    }));
  }
}

// ---------------------------------------------------------------- opere

function opere() { return Array.isArray(dati.opere) ? dati.opere.filter((o) => immagine(o.immagine)) : []; }

function descriviOpera(o) {
  return [testo(o.anno), testo(o.tecnica), testo(o.dimensioni)].filter(Boolean).join(' · ');
}

function costruisciFiltri() {
  const tecniche = [...new Set(opere().map((o) => testo(o.tecnica)).filter(Boolean))];
  const contenitore = $('[data-filtri]');
  contenitore.replaceChildren();
  if (tecniche.length < 2) return;
  const voci = ['Tutte', ...tecniche];
  for (const voce of voci) {
    contenitore.append(crea('button', {
      type: 'button', 'aria-pressed': voce === 'Tutte' ? 'true' : 'false', testo: voce,
      suClick: (e) => {
        for (const b of $$('button', contenitore)) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        disegnaGriglia(voce === 'Tutte' ? null : voce);
      },
    }));
  }
}

function disegnaGriglia(tecnica = null) {
  opereVisibili = opere().filter((o) => !tecnica || testo(o.tecnica) === tecnica);
  const griglia = $('[data-griglia-opere]');
  griglia.replaceChildren();
  if (!opereVisibili.length) {
    griglia.append(crea('li', { classe: 'vuoto', testo: 'Le opere saranno pubblicate a breve.' }));
    return;
  }
  opereVisibili.forEach((o, i) => {
    const img = immagine(o.immagine);
    const foto = crea('img', {
      src: img.miniatura, alt: testo(o.titolo) || 'Opera', loading: 'lazy', decoding: 'async',
      width: img.larghezza, height: img.altezza, 'data-caricata': 'no',
    });
    foto.addEventListener('load', () => foto.removeAttribute('data-caricata'), { once: true });
    foto.addEventListener('error', () => { if (foto.src !== new URL(img.file, location.href).href) foto.src = img.file; }, { once: true });
    if (foto.complete) foto.removeAttribute('data-caricata');
    const stato = testo(o.stato);
    griglia.append(crea('li', { classe: 'compari' }, [
      crea('button', { type: 'button', classe: 'opera', suClick: () => apriOpera(o.id || String(i)) }, [
        crea('span', { classe: 'opera__cornice' }, [foto, stato ? crea('span', { classe: 'opera__stato', testo: stato }) : null]),
        crea('span', { classe: 'opera__didascalia' }, [
          crea('span', {}, [
            crea('span', { classe: 'opera__titolo', testo: testo(o.titolo) || 'Senza titolo' }),
            testo(o.tecnica) ? crea('span', { classe: 'opera__tecnica', testo: o.tecnica }) : null,
          ]),
          crea('span', { classe: 'opera__anno', testo: testo(o.anno) }),
        ]),
      ]),
    ]));
  });
  osservaComparse();
}

function trovaOpera(id) {
  let elenco = opereVisibili;
  let i = elenco.findIndex((o, k) => (o.id || String(k)) === id);
  if (i < 0) { elenco = opere(); i = elenco.findIndex((o, k) => (o.id || String(k)) === id); opereVisibili = elenco; }
  return i;
}

function mostraNelVisore(i) {
  const o = opereVisibili[i];
  if (!o) return;
  indiceVisore = i;
  const img = immagine(o.immagine);
  const visore = $('[data-visore]');
  const foto = $('[data-visore-img]');
  $('.visore__figura', visore).classList.remove('visore__figura--zoom');
  foto.src = img.miniatura;
  foto.alt = testo(o.titolo) || 'Opera';
  if (img.file !== img.miniatura) {
    const grande = new Image();
    grande.onload = () => { if (indiceVisore === i) foto.src = img.file; };
    grande.src = img.file;
  }
  $('[data-visore-conta]').textContent = `${i + 1} / ${opereVisibili.length}`;
  $('[data-visore-titolo]').textContent = testo(o.titolo) || 'Senza titolo';
  const voci = [['Anno', o.anno], ['Tecnica', o.tecnica], ['Dimensioni', o.dimensioni], ['Stato', o.stato]];
  $('[data-visore-dati]').replaceChildren(...voci.filter(([, v]) => testo(v)).flatMap(([k, v]) => [crea('dt', { testo: k }), crea('dd', { testo: testo(v) })]));
  $('[data-visore-descrizione]').replaceChildren(...paragrafi(o.descrizione));
  const email = testo(dati.contatti?.email);
  const richiesta = $('[data-visore-richiesta]');
  richiesta.hidden = !email;
  if (email) richiesta.href = `mailto:${email}?subject=${encodeURIComponent(`Informazioni sull'opera «${testo(o.titolo) || 'Senza titolo'}»`)}`;
  const piuDiUna = opereVisibili.length > 1;
  $('[data-visore-prec]').hidden = !piuDiUna;
  $('[data-visore-succ]').hidden = !piuDiUna;
}

function apriOpera(id) { naviga(`#opera/${encodeURIComponent(id)}`); }

function spostaVisore(passo) {
  const n = opereVisibili.length;
  const i = (indiceVisore + passo + n) % n;
  const o = opereVisibili[i];
  naviga(`#opera/${encodeURIComponent(o.id || String(i))}`, true);
}

// ---------------------------------------------------------------- mostre

function annoNumerico(a) { const m = testo(a).match(/\d{4}/); return m ? Number(m[0]) : -Infinity; }

function disegnaMostre() {
  const elenco = (Array.isArray(dati.mostre) ? dati.mostre : []).filter((m) => testo(m.titolo));
  const contenitore = $('[data-mostre]');
  contenitore.replaceChildren();
  if (!elenco.length) { $('#mostre').hidden = true; return; }
  const ordinate = elenco.map((m, i) => ({ m, i })).sort((a, b) => annoNumerico(b.m.anno) - annoNumerico(a.m.anno) || a.i - b.i);
  const gruppi = new Map();
  for (const { m } of ordinate) {
    const anno = testo(m.anno) || '—';
    if (!gruppi.has(anno)) gruppi.set(anno, []);
    gruppi.get(anno).push(m);
  }
  for (const [anno, voci] of gruppi) {
    contenitore.append(crea('div', { classe: 'mostre__anno compari' }, [
      crea('h3', { testo: anno }),
      crea('ul', { classe: 'mostre__lista' }, voci.map((m) => {
        const link = linkSicuro(m.link);
        const titolo = link
          ? crea('a', { href: link, target: '_blank', rel: 'noopener', testo: m.titolo })
          : document.createTextNode(m.titolo);
        return crea('li', { classe: 'mostra' }, [
          crea('p', { classe: 'mostra__titolo', style: 'margin:0' }, [titolo]),
          testo(m.tipo) ? crea('span', { classe: 'mostra__tipo', testo: m.tipo }) : null,
          testo(m.luogo) ? crea('span', { classe: 'mostra__luogo', testo: m.luogo }) : null,
          testo(m.descrizione) ? crea('p', { classe: 'mostra__note', testo: m.descrizione }) : null,
        ]);
      })),
    ]));
  }
}

// ---------------------------------------------------------------- critica e articoli

function disegnaCritica() {
  const elenco = (Array.isArray(dati.critica) ? dati.critica : []).filter((c) => testo(c.titolo));
  const lista = $('[data-critica]');
  lista.replaceChildren();
  if (!elenco.length) { $('#critica-articoli').hidden = true; return; }
  elenco.forEach((c, i) => {
    const link = linkSicuro(c.link);
    const haTesto = !!testo(c.testo);
    const firma = [testo(c.autore), [testo(c.fonte), testo(c.data)].filter(Boolean).join(', ')].filter(Boolean);
    const contenuto = [
      crea('span', { classe: 'scheda-critica__tipo', testo: testo(c.tipo) || 'Testo' }),
      crea('span', { classe: 'scheda-critica__titolo', testo: c.titolo }),
      haTesto ? crea('span', { classe: 'scheda-critica__estratto', testo: testo(c.testo).replace(/\s+/g, ' ') }) : null,
      firma.length ? crea('span', { classe: 'scheda-critica__firma' }, [firma[0], firma[1] ? crea('span', { testo: ` — ${firma[1]}` }) : null]) : null,
      crea('span', { classe: 'scheda-critica__leggi', testo: haTesto ? 'Leggi ›' : 'Apri l’articolo ↗' }),
    ];
    const scheda = haTesto || !link
      ? crea('button', { type: 'button', classe: 'scheda-critica', suClick: () => naviga(`#critica/${encodeURIComponent(c.id || String(i))}`) }, contenuto)
      : crea('a', { classe: 'scheda-critica', href: link, target: '_blank', rel: 'noopener' }, contenuto);
    lista.append(crea('li', { classe: 'compari' }, [scheda]));
  });
}

function mostraNelLettore(id) {
  const elenco = Array.isArray(dati.critica) ? dati.critica : [];
  const c = elenco.find((x, i) => (x.id || String(i)) === id);
  if (!c) return false;
  $('[data-lettore-tipo]').textContent = testo(c.tipo) || 'Testo';
  $('[data-lettore-titolo]').textContent = testo(c.titolo);
  $('[data-lettore-firma]').textContent = [testo(c.autore), testo(c.fonte), testo(c.data)].filter(Boolean).join(' · ');
  $('[data-lettore-testo]').replaceChildren(...paragrafi(c.testo));
  const link = linkSicuro(c.link);
  const a = $('[data-lettore-link]');
  a.hidden = !link;
  if (link) a.href = link;
  $('[data-lettore]').scrollTop = 0;
  return true;
}

// ---------------------------------------------------------------- contatti

const ICONE = {
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r=".9" fill="currentColor" stroke="none"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg>',
};

function disegnaContatti() {
  const c = dati.contatti || {};
  const voci = $('[data-contatti]');
  voci.replaceChildren();
  const email = testo(c.email);
  if (email) voci.append(crea('a', { classe: 'contatti__email', href: `mailto:${email}`, testo: email }));
  const telefono = testo(c.telefono);
  if (telefono) voci.append(crea('p', { classe: 'contatti__riga' }, ['Telefono ', crea('a', { href: `tel:${telefono.replace(/[^\d+]/g, '')}`, testo: telefono })]));
  if (testo(c.studio)) voci.append(crea('p', { classe: 'contatti__riga', testo: c.studio }));
  const social = crea('div', { classe: 'contatti__social' });
  for (const [k, nome] of [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube']]) {
    const link = linkSicuro(c[k]);
    if (!link) continue;
    const a = crea('a', { href: link, target: '_blank', rel: 'noopener' });
    a.innerHTML = ICONE[k]; // icone fisse definite qui sopra, non contenuti
    a.append(nome);
    social.append(a);
  }
  if (social.childElementCount) voci.append(social);
}

// ---------------------------------------------------------------- anteprima galleria 3D

function disegnaAnteprima3d() {
  const nelle3d = opere().filter((o) => o.in_galleria_3d !== false).slice(0, 3);
  const box = $('[data-anteprima-3d]');
  const pose = [
    'left:6%;transform:rotateY(38deg);transform-origin:left center',
    'left:50%;translate:-50% 0',
    'right:6%;transform:rotateY(-38deg);transform-origin:right center',
  ];
  box.replaceChildren(...nelle3d.map((o, i) => crea('img', { src: immagine(o.immagine).miniatura, alt: '', loading: 'lazy', style: pose[i] })));
  if (!nelle3d.length) $('#galleria-3d').hidden = true;
}

// ---------------------------------------------------------------- navigazione e pannelli

// I pannelli (opera, testo critico, sala 3D) hanno un indirizzo proprio (#opera/…, #critica/…, #sala):
// si possono condividere e il tasto «indietro» del telefono li chiude.
function naviga(hash, sostituisci = false) {
  if (location.hash === hash) return applicaIndirizzo();
  if (sostituisci) history.replaceState({ pannello: true }, '', hash);
  else { history.pushState({ pannello: true }, '', hash); pannelloDaStoria = true; }
  applicaIndirizzo();
}

function chiudiPannello(sezione) {
  if (pannelloDaStoria && history.state?.pannello) { pannelloDaStoria = false; history.back(); return; }
  history.replaceState(null, '', sezione ? `#${sezione}` : location.pathname + location.search);
  applicaIndirizzo();
}

function applicaIndirizzo() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const visore = $('[data-visore]');
  const lettore = $('[data-lettore]');

  if (hash.startsWith('opera/')) {
    const i = trovaOpera(hash.slice(6));
    if (i >= 0) {
      mostraNelVisore(i);
      if (!visore.open) visore.showModal();
    }
  } else if (visore.open) visore.close();

  if (hash.startsWith('critica/') && mostraNelLettore(hash.slice(8))) {
    if (!lettore.open) lettore.showModal();
  } else if (lettore.open) lettore.close();

  if (hash === 'sala' || hash.startsWith('sala/')) apriSala();
  else if (sala) chiudiSala();

  bloccaScorrimento(visore.open || lettore.open || !!sala);
}

function collegaPannelli() {
  const visore = $('[data-visore]');
  const lettore = $('[data-lettore]');
  for (const [d, sezione] of [[visore, 'opere'], [lettore, 'critica-articoli']]) {
    d.addEventListener('cancel', (e) => { e.preventDefault(); chiudiPannello(sala ? 'sala' : sezione); });
    $('[data-chiudi]', d).addEventListener('click', () => chiudiPannello(sala ? 'sala' : sezione));
    d.addEventListener('click', (e) => { if (e.target === d || e.target.classList.contains('visore__figura')) chiudiPannello(sala ? 'sala' : sezione); });
  }
  $('[data-visore-prec]').addEventListener('click', () => spostaVisore(-1));
  $('[data-visore-succ]').addEventListener('click', () => spostaVisore(1));
  $('[data-visore-img]').addEventListener('click', (e) => {
    e.stopPropagation();
    $('.visore__figura').classList.toggle('visore__figura--zoom');
  });
  visore.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') spostaVisore(-1);
    if (e.key === 'ArrowRight') spostaVisore(1);
  });
  // scorrimento col dito sul telefono
  let x0 = null;
  visore.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  visore.addEventListener('touchend', (e) => {
    if (x0 === null || $('.visore__figura--zoom')) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) spostaVisore(dx < 0 ? 1 : -1);
    x0 = null;
  });
  window.addEventListener('popstate', () => { pannelloDaStoria = !!history.state?.pannello; applicaIndirizzo(); });
}

function collegaTestata() {
  const testata = $('[data-testata]');
  const menu = $('[data-menu]');
  const apertura = $('#home');
  const aggiorna = () => testata.classList.toggle('testata--piena', apertura.getBoundingClientRect().bottom < 80);
  aggiorna();
  window.addEventListener('scroll', aggiorna, { passive: true });
  const chiudiMenu = () => { testata.classList.remove('testata--aperta'); menu.setAttribute('aria-expanded', 'false'); bloccaScorrimento(false); };
  menu.addEventListener('click', () => {
    const aperto = testata.classList.toggle('testata--aperta');
    menu.setAttribute('aria-expanded', String(aperto));
    bloccaScorrimento(aperto);
  });
  for (const a of $$('.testata__nav a')) a.addEventListener('click', chiudiMenu);

  const voci = new Map($$('.testata__nav a').map((a) => [a.getAttribute('href').slice(1), a]));
  const osservatore = new IntersectionObserver((righe) => {
    for (const r of righe) {
      if (!r.isIntersecting) continue;
      for (const a of voci.values()) a.removeAttribute('aria-current');
      voci.get(r.target.id)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of voci.keys()) { const s = document.getElementById(id); if (s) osservatore.observe(s); }
}

let osservatoreComparse = null;
function osservaComparse() {
  osservatoreComparse ??= new IntersectionObserver((righe) => {
    for (const r of righe) if (r.isIntersecting) { r.target.classList.add('compari--visibile'); osservatoreComparse.unobserve(r.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const n of $$('.compari:not(.compari--visibile)')) osservatoreComparse.observe(n);
}

// ---------------------------------------------------------------- 3D

function webglDisponibile() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

async function avviaApertura() {
  const contenitore = $('[data-scena-apertura]');
  const scelte = opere().filter((o) => o.in_evidenza);
  const elenco = (scelte.length >= 3 ? scelte : opere()).slice(0, 12);
  const statica = () => {
    const prima = elenco[0] && immagine(elenco[0].immagine);
    if (prima) { contenitore.classList.add('apertura__scena--statica'); contenitore.style.backgroundImage = `url("${encodeURI(prima.miniatura)}")`; }
  };
  if (!elenco.length) return;
  if (!webglDisponibile() || matchMedia('(prefers-reduced-motion: reduce)').matches) return statica();
  try {
    const { avvia } = await import('./apertura3d.js?v=1');
    avvia(contenitore, elenco.map((o) => ({ ...o, immagine: immagine(o.immagine) })), {
      suClic: (o) => apriOpera(o.id),
    });
  } catch (err) {
    console.warn('Scena 3D non disponibile:', err);
    statica();
  }
}

async function apriSala() {
  if (sala) return;
  const radice = $('[data-sala]');
  if (!webglDisponibile()) {
    alert('La galleria 3D richiede un browser più recente. Puoi comunque vedere tutte le opere nella sezione Opere.');
    chiudiPannello('galleria-3d');
    return;
  }
  sala = { chiudi() {} }; // segnaposto mentre il modulo si carica
  radice.hidden = false;
  bloccaScorrimento(true);
  try {
    const { creaSala } = await import('./galleria3d.js?v=1');
    if (!sala) return; // chiusa durante il caricamento
    const elenco = opere().filter((o) => o.in_galleria_3d !== false).map((o) => ({ ...o, immagine: immagine(o.immagine) }));
    sala = creaSala(radice, elenco, {
      colorePareti: testo(dati.sito?.colore_pareti),
      nome: testo(dati.sito?.nome),
      suDettagli: (o) => apriOpera(o.id),
      suEsci: () => chiudiPannello('galleria-3d'),
    });
  } catch (err) {
    console.error(err);
    sala = null;
    radice.hidden = true;
    alert('Non è stato possibile aprire la galleria 3D.');
  }
}

function chiudiSala() {
  sala?.chiudi();
  sala = null;
  $('[data-sala]').hidden = true;
}

// ---------------------------------------------------------------- avvio

async function avvio() {
  try {
    const r = await fetch(FILE_CONTENUTI, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    dati = await r.json();
  } catch (err) {
    console.error('Impossibile leggere i contenuti:', err);
    document.body.append(crea('p', { classe: 'avviso', testo: 'Non è stato possibile caricare i contenuti del sito. Riprova tra poco.' }));
    return;
  }
  riempiTesti();
  costruisciFiltri();
  disegnaGriglia();
  disegnaMostre();
  disegnaCritica();
  disegnaContatti();
  disegnaAnteprima3d();
  for (const s of $$('.sezione__testa, .biografia__foto, .biografia__testo, .citazione, .invito-3d__testo, .invito-3d__anteprima, .contatti__invito, .contatti__voci')) s.classList.add('compari');
  osservaComparse();
  collegaTestata();
  collegaPannelli();
  for (const b of $$('[data-apri-galleria]')) b.addEventListener('click', () => naviga('#sala'));
  applicaIndirizzo();
  // se l'indirizzo puntava a una sezione, ci si arriva dopo che il contenuto è stato costruito
  if (location.hash && !location.hash.includes('/') && location.hash !== '#sala') document.getElementById(location.hash.slice(1))?.scrollIntoView();
  if (window.requestIdleCallback) requestIdleCallback(() => avviaApertura(), { timeout: 1200 });
  else setTimeout(avviaApertura, 200);
}

avvio();
