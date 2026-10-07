// Costruisce il sito a partire da contenuti/sito.json.
// Il testo viene sempre inserito come testo semplice (textContent), mai come HTML.
// Le scritte rivolte ai visitatori sono in inglese, come il sito.

const FILE_CONTENUTI = 'contenuti/sito.json';
const ROTTA_OPERA = 'work/';
const ROTTA_TESTO = 'review/';
const ROTTA_SALA = 'virtual-gallery';

const $ = (sel, radice = document) => radice.querySelector(sel);
const $$ = (sel, radice = document) => [...radice.querySelectorAll(sel)];

let dati = null;
let elencoVisore = [];       // ciò che scorre nel visore: le opere filtrate, o le foto di una mostra
let sezioneVisore = 'portfolio';
let indiceVisore = -1;
let sala = null;             // controller della galleria 3D, se aperta
let pannelloDaStoria = false;

// ---------------------------------------------------------------- utilità

function crea(tag, attributi = {}, figli = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'testo') nodo.textContent = v;
    else if (k === 'classe') nodo.className = v;
    else if (/^su[A-Z]/.test(k)) nodo.addEventListener(k.slice(2).toLowerCase(), v);
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

// I nomi delle foto possono contenere spazi, virgole e lettere accentate: vanno codificati negli indirizzi.
function indirizzo(percorso) { return encodeURI(percorso); }

function immagine(v) {
  if (!v) return null;
  if (typeof v === 'string') return { file: indirizzo(v), miniatura: indirizzo(v) };
  if (!v.file) return null;
  return { file: indirizzo(v.file), miniatura: indirizzo(v.miniatura || v.file), larghezza: v.larghezza, altezza: v.altezza };
}

function linkSicuro(url) {
  const u = testo(url);
  return /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : null;
}

function documentoSicuro(percorso) {
  const p = testo(percorso);
  return /^(documenti|assets)\/[^<>"?#]+\.pdf$/i.test(p) && !p.includes('..') ? indirizzo(p) : null;
}

function bloccaScorrimento(si) {
  document.documentElement.style.overflow = si ? 'hidden' : '';
}

function annoNumerico(a) { const m = testo(a).match(/\d{4}/); return m ? Number(m[0]) : null; }

// «25/04/2025» → 20250425, per ordinare le voci dello stesso anno
function dataNumerica(d) {
  const m = testo(d).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}

function nascondiSezione(id, vuota) {
  const sezione = document.getElementById(id);
  if (sezione) sezione.hidden = vuota;
  const voce = $(`.testata__nav a[href="#${id}"]`);
  if (voce) voce.hidden = vuota;
}

// ---------------------------------------------------------------- testi

function riempiTesti() {
  for (const nodo of $$('[data-testo]')) nodo.textContent = testo(leggi(nodo.dataset.testo));
  for (const nodo of $$('[data-paragrafi]')) nodo.replaceChildren(...paragrafi(leggi(nodo.dataset.paragrafi)));
  $('[data-citazione]').hidden = !testo(dati.ricerca?.citazione);
  $('[data-piede]').replaceChildren(...paragrafi(dati.sito?.nota_piede));
  nascondiSezione('about', !testo(dati.biografia?.testo));
  nascondiSezione('research', !testo(dati.ricerca?.testo));

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
  const copertina = immagine(dati.sito?.immagine_apertura) || immagine(opere()[0]?.immagine);
  if (copertina) document.head.append(crea('meta', { property: 'og:image', content: new URL(copertina.file, location.href).href }));

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
      src: foto.miniatura, alt: nome ? `Portrait of ${nome}` : 'Portrait', loading: 'lazy', decoding: 'async',
      width: foto.larghezza, height: foto.altezza,
    }));
  }
  $('[data-biografia]').classList.toggle('biografia--con-foto', !!foto);
}

// ---------------------------------------------------------------- opere

function opere() { return Array.isArray(dati.opere) ? dati.opere.filter((o) => immagine(o.immagine)) : []; }

// Filtri come nel vecchio sito: opere scelte, gli anni più recenti, opere precedenti, tutte.
function filtri() {
  const tutte = opere();
  const anni = [...new Set(tutte.map((o) => annoNumerico(o.anno)).filter(Boolean))].sort((a, b) => b - a).slice(0, 4);
  const elenco = [];
  if (tutte.some((o) => o.selezionata)) elenco.push({ id: 'selected', nome: 'Selected works', prova: (o) => o.selezionata });
  for (const a of anni) elenco.push({ id: String(a), nome: String(a), prova: (o) => annoNumerico(o.anno) === a });
  const prima = (o) => !anni.includes(annoNumerico(o.anno));
  if (anni.length && tutte.some(prima)) elenco.push({ id: 'earlier', nome: 'Earlier works', prova: prima });
  elenco.push({ id: 'all', nome: 'All', prova: () => true });
  return elenco;
}

function costruisciFiltri() {
  const elenco = filtri();
  const contenitore = $('[data-filtri]');
  contenitore.replaceChildren();
  const scegli = (f) => {
    for (const b of $$('button', contenitore)) b.setAttribute('aria-pressed', String(b.dataset.filtro === f.id));
    disegnaGriglia(f.prova);
  };
  if (elenco.length > 1) {
    for (const f of elenco) contenitore.append(crea('button', { type: 'button', 'data-filtro': f.id, 'aria-pressed': 'false', testo: f.nome, suClick: () => scegli(f) }));
  }
  scegli(elenco[0]);
  new ResizeObserver(() => { if (vociGriglia.length && numeroColonne() !== colonneGriglia) impagina(); }).observe($('[data-griglia-opere]'));
}

// Griglia «a muratura» che conserva l'ordine di lettura: ogni opera va nella colonna più corta,
// così la prima riga mostra le prime opere dell'elenco (con le colonne CSS si leggerebbe dall'alto in basso).
let vociGriglia = [];
let colonneGriglia = 0;

function numeroColonne() {
  const w = $('[data-griglia-opere]').clientWidth;
  return w >= 900 ? 3 : w >= 540 ? 2 : 1;
}

function impagina() {
  const griglia = $('[data-griglia-opere]');
  colonneGriglia = numeroColonne();
  const colonne = Array.from({ length: colonneGriglia }, () => crea('ul', { classe: 'griglia__colonna' }));
  const altezze = new Array(colonneGriglia).fill(0);
  for (const li of vociGriglia) {
    const k = altezze.indexOf(Math.min(...altezze));
    colonne[k].append(li);
    altezze[k] += Number(li.dataset.proporzione) + 0.3; // 0.3: spazio della didascalia
  }
  griglia.replaceChildren(...colonne);
}

function disegnaGriglia(prova = () => true) {
  const visibili = opere().filter(prova);
  elencoVisore = visibili;
  sezioneVisore = 'portfolio';
  vociGriglia = [];
  if (!visibili.length) {
    $('[data-griglia-opere]').replaceChildren(crea('ul', { classe: 'griglia__colonna' }, [crea('li', { classe: 'vuoto', testo: 'New works coming soon.' })]));
    return;
  }
  for (const o of visibili) {
    const img = immagine(o.immagine);
    const foto = crea('img', {
      src: img.miniatura, alt: testo(o.titolo) || 'Untitled', loading: 'lazy', decoding: 'async', draggable: 'false',
      width: img.larghezza, height: img.altezza, 'data-caricata': 'no',
    });
    foto.addEventListener('load', () => foto.removeAttribute('data-caricata'), { once: true });
    foto.addEventListener('error', () => {
      if (img.file !== img.miniatura && !foto.dataset.riprova) { foto.dataset.riprova = '1'; foto.src = img.file; }
      else foto.closest('li')?.classList.add('opera--mancante');
    });
    const stato = testo(o.stato);
    const proporzione = img.larghezza && img.altezza ? img.altezza / img.larghezza : 1.2;
    vociGriglia.push(crea('li', { classe: 'compari', 'data-proporzione': proporzione.toFixed(3) }, [
      crea('button', { type: 'button', classe: 'opera', suClick: () => { elencoVisore = visibili; sezioneVisore = 'portfolio'; apriOpera(o.id); } }, [
        crea('span', { classe: 'opera__cornice' }, [foto, stato ? crea('span', { classe: 'opera__stato', testo: stato }) : null]),
        crea('span', { classe: 'opera__didascalia' }, [
          crea('span', {}, [
            crea('span', { classe: 'opera__titolo', testo: testo(o.titolo) || 'Untitled' }),
            [testo(o.tecnica), testo(o.dimensioni)].some(Boolean)
              ? crea('span', { classe: 'opera__tecnica', testo: [testo(o.tecnica), testo(o.dimensioni)].filter(Boolean).join(', ') }) : null,
          ]),
          crea('span', { classe: 'opera__anno', testo: testo(o.anno) }),
        ]),
      ]),
    ]));
  }
  impagina();
  osservaComparse();
}

// Foto di una mostra, presentate nel visore come elementi «non opera».
function fotoMostra(m) {
  return (Array.isArray(m.foto) ? m.foto : []).map((f, i) => ({
    id: `photo-${m.id}-${i + 1}`,
    immagine: f,
    titolo: m.titolo,
    nonOpera: true,
    voci: [['Venue', [testo(m.luogo), testo(m.data) || testo(m.anno)].filter(Boolean).join(' · ')]],
  })).filter((f) => immagine(f.immagine));
}

function trovaNelVisore(id) {
  let i = elencoVisore.findIndex((o) => o.id === id);
  if (i >= 0) return i;
  const tutte = opere();
  i = tutte.findIndex((o) => o.id === id);
  if (i >= 0) { elencoVisore = tutte; sezioneVisore = 'portfolio'; return i; }
  for (const m of dati.mostre || []) {
    const foto = fotoMostra(m);
    i = foto.findIndex((f) => f.id === id);
    if (i >= 0) { elencoVisore = foto; sezioneVisore = 'curriculum'; return i; }
  }
  return -1;
}

function mostraNelVisore(i) {
  const o = elencoVisore[i];
  if (!o) return;
  indiceVisore = i;
  const img = immagine(o.immagine);
  const foto = $('[data-visore-img]');
  $('.visore__figura').classList.remove('visore__figura--zoom');
  foto.src = img.miniatura;
  foto.alt = testo(o.titolo) || 'Untitled';
  if (img.file !== img.miniatura) {
    const grande = new Image();
    grande.onload = () => { if (indiceVisore === i && elencoVisore[i] === o) foto.src = img.file; };
    grande.src = img.file;
  }
  $('[data-visore-conta]').textContent = `${i + 1} / ${elencoVisore.length}`;
  $('[data-visore-titolo]').textContent = testo(o.titolo) || 'Untitled';
  const voci = o.voci || [['Year', o.anno], ['Technique', o.tecnica], ['Size', o.dimensioni], ['Status', o.stato]];
  $('[data-visore-dati]').replaceChildren(...voci.filter(([, v]) => testo(v)).flatMap(([k, v]) => [crea('dt', { testo: k }), crea('dd', { testo: testo(v) })]));
  $('[data-visore-descrizione]').replaceChildren(...paragrafi(o.descrizione));
  const email = testo(dati.contatti?.email);
  const richiesta = $('[data-visore-richiesta]');
  richiesta.hidden = !email || o.nonOpera;
  if (email) richiesta.href = `mailto:${email}?subject=${encodeURIComponent(`Enquiry about "${testo(o.titolo) || 'Untitled'}"`)}`;
  const piuDiUna = elencoVisore.length > 1;
  $('[data-visore-prec]').hidden = !piuDiUna;
  $('[data-visore-succ]').hidden = !piuDiUna;
}

function apriOpera(id) { naviga(`#${ROTTA_OPERA}${encodeURIComponent(id)}`); }

function spostaVisore(passo) {
  const n = elencoVisore.length;
  if (n < 2) return;
  const o = elencoVisore[(indiceVisore + passo + n) % n];
  naviga(`#${ROTTA_OPERA}${encodeURIComponent(o.id)}`, true);
}

// ---------------------------------------------------------------- curriculum

function disegnaMostre() {
  const elenco = (Array.isArray(dati.mostre) ? dati.mostre : []).filter((m) => testo(m.titolo));
  const contenitore = $('[data-mostre]');
  contenitore.replaceChildren();
  nascondiSezione('curriculum', !elenco.length);
  const ordinate = elenco.map((m, i) => ({ m, i })).sort((a, b) =>
    (annoNumerico(b.m.anno) || 0) - (annoNumerico(a.m.anno) || 0)
    || dataNumerica(b.m.data) - dataNumerica(a.m.data)
    || a.i - b.i);
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
        const foto = fotoMostra(m);
        return crea('li', { classe: 'mostra' }, [
          crea('p', { classe: 'mostra__titolo' }, [titolo]),
          testo(m.tipo) ? crea('span', { classe: 'mostra__tipo', testo: m.tipo }) : null,
          crea('span', { classe: 'mostra__luogo', testo: [testo(m.luogo), testo(m.data)].filter(Boolean).join(' · ') }),
          testo(m.descrizione) ? crea('p', { classe: 'mostra__note', testo: m.descrizione }) : null,
          foto.length ? crea('div', { classe: 'mostra__foto' }, foto.map((f) => crea('button', {
            type: 'button', 'aria-label': `Photo from ${m.titolo}`,
            suClick: () => { elencoVisore = foto; sezioneVisore = 'curriculum'; apriOpera(f.id); },
          }, [crea('img', { src: immagine(f.immagine).miniatura, alt: '', loading: 'lazy', draggable: 'false' })]))) : null,
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
  nascondiSezione('critica-articoli', !elenco.length);
  for (const c of elenco) {
    const esterno = linkSicuro(c.link) || documentoSicuro(c.documento);
    const haTesto = !!testo(c.testo);
    const img = immagine(c.immagine);
    const firma = [testo(c.autore), [testo(c.fonte), testo(c.data)].filter(Boolean).join(', ')].filter(Boolean);
    const contenuto = [
      img ? crea('span', { classe: 'scheda-critica__immagine' }, [crea('img', { src: img.miniatura, alt: '', loading: 'lazy', draggable: 'false' })]) : null,
      crea('span', { classe: 'scheda-critica__corpo' }, [
        crea('span', { classe: 'scheda-critica__tipo', testo: testo(c.tipo) || 'Text' }),
        crea('span', { classe: 'scheda-critica__titolo', testo: c.titolo }),
        haTesto ? crea('span', { classe: 'scheda-critica__estratto', testo: testo(c.testo).replace(/\s+/g, ' ') }) : null,
        firma.length ? crea('span', { classe: 'scheda-critica__firma' }, [firma[0], firma[1] ? crea('span', { testo: ` — ${firma[1]}` }) : null]) : null,
        crea('span', { classe: 'scheda-critica__leggi', testo: haTesto ? 'Read ›' : 'Open the article ↗' }),
      ]),
    ];
    const scheda = haTesto || !esterno
      ? crea('button', { type: 'button', classe: 'scheda-critica', suClick: () => naviga(`#${ROTTA_TESTO}${encodeURIComponent(c.id)}`) }, contenuto)
      : crea('a', { classe: 'scheda-critica', href: esterno, target: '_blank', rel: 'noopener' }, contenuto);
    lista.append(crea('li', { classe: 'compari' }, [scheda]));
  }
}

function mostraNelLettore(id) {
  const c = (Array.isArray(dati.critica) ? dati.critica : []).find((x) => x.id === id);
  if (!c) return false;
  $('[data-lettore-tipo]').textContent = testo(c.tipo) || 'Text';
  $('[data-lettore-titolo]').textContent = testo(c.titolo);
  $('[data-lettore-firma]').textContent = [testo(c.autore), testo(c.fonte), testo(c.data)].filter(Boolean).join(' · ');
  const img = immagine(c.immagine);
  $('[data-lettore-immagine]').replaceChildren(...(img ? [crea('img', { src: img.miniatura, alt: '', draggable: 'false' })] : []));
  $('[data-lettore-testo]').replaceChildren(...paragrafi(c.testo));
  for (const [sel, url] of [['[data-lettore-pdf]', documentoSicuro(c.documento)], ['[data-lettore-link]', linkSicuro(c.link)]]) {
    const a = $(sel);
    a.hidden = !url;
    if (url) a.href = url;
  }
  $('[data-lettore]').scrollTop = 0;
  return true;
}

// ---------------------------------------------------------------- eventi (con post Instagram caricati solo su richiesta)

const CHIAVE_CONSENSO = 'instagram-consenso';

function postInstagram(url) {
  const m = testo(url).match(/^https:\/\/(www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/);
  return m ? `https://www.instagram.com/${m[2]}/${m[3]}/` : null;
}

function consensoInstagram() {
  try { return localStorage.getItem(CHIAVE_CONSENSO) === 'si'; } catch { return false; }
}

function caricaInstagram() {
  for (const tessera of $$('[data-instagram]')) {
    const citazione = crea('blockquote', {
      classe: 'instagram-media', 'data-instgrm-permalink': tessera.dataset.instagram, 'data-instgrm-version': '14',
    }, [crea('a', { href: tessera.dataset.instagram, target: '_blank', rel: 'noopener', testo: 'View this post on Instagram' })]);
    tessera.replaceChildren(citazione);
    tessera.classList.add('evento--instagram-caricato');
  }
  $('[data-eventi]').classList.add('eventi--caricati');
  $('[data-consenso]').hidden = true;
  if (window.instgrm) { window.instgrm.Embeds.process(); return; }
  document.body.append(crea('script', { src: 'https://www.instagram.com/embed.js', async: true }));
}

const ICONA_INSTAGRAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r=".9" fill="currentColor" stroke="none"/></svg>';

function disegnaEventi() {
  const elenco = (Array.isArray(dati.eventi) ? dati.eventi : []).filter((e) => testo(e.titolo) || linkSicuro(e.link) || immagine(e.immagine));
  const lista = $('[data-eventi]');
  lista.replaceChildren();
  nascondiSezione('events', !elenco.length);
  let instagram = 0;
  for (const e of elenco) {
    const img = immagine(e.immagine);
    const link = linkSicuro(e.link);
    const post = postInstagram(e.link);
    if (post && !img) {
      instagram++;
      const icona = crea('span', { classe: 'evento__icona' });
      icona.innerHTML = ICONA_INSTAGRAM; // icona fissa definita qui, non contenuto
      lista.append(crea('li', { classe: 'evento evento--instagram compari', 'data-instagram': post }, [
        icona,
        crea('span', { classe: 'evento__titolo', testo: testo(e.titolo) || 'Instagram post' }),
        testo(e.data) ? crea('span', { classe: 'evento__data', testo: e.data }) : null,
        crea('a', { href: post, target: '_blank', rel: 'noopener', testo: 'Open on Instagram ↗' }),
      ]));
      continue;
    }
    lista.append(crea('li', { classe: 'evento compari' }, [
      img ? crea('span', { classe: 'evento__immagine' }, [crea('img', { src: img.miniatura, alt: '', loading: 'lazy', draggable: 'false' })]) : null,
      crea('span', { classe: 'evento__corpo' }, [
        testo(e.data) ? crea('span', { classe: 'evento__data', testo: e.data }) : null,
        crea('span', { classe: 'evento__titolo', testo: testo(e.titolo) || 'Event' }),
        testo(e.luogo) ? crea('span', { classe: 'evento__luogo', testo: e.luogo }) : null,
        testo(e.descrizione) ? crea('span', { classe: 'evento__descrizione', testo: e.descrizione }) : null,
        link ? crea('a', { href: link, target: '_blank', rel: 'noopener', testo: 'More ↗' }) : null,
      ]),
    ]));
  }
  const consenso = $('[data-consenso]');
  consenso.hidden = !instagram;
  if (instagram && consensoInstagram()) caricaInstagram();
}

// ---------------------------------------------------------------- contatti

const ICONE = {
  instagram: ICONA_INSTAGRAM,
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
  if (telefono) voci.append(crea('p', { classe: 'contatti__riga' }, ['Phone ', crea('a', { href: `tel:${telefono.replace(/[^\d+]/g, '')}`, testo: telefono })]));
  if (testo(c.studio)) voci.append(crea('p', { classe: 'contatti__riga', testo: c.studio }));
  const azioni = crea('div', { classe: 'contatti__social' });
  const portfolio = documentoSicuro(c.portfolio);
  if (portfolio) azioni.append(crea('a', { classe: 'contatti__portfolio', href: portfolio, download: true, testo: `${testo(c.portfolio_etichetta) || 'Download portfolio'} (PDF)` }));
  for (const [k, nome] of [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube']]) {
    const link = linkSicuro(c[k]);
    if (!link) continue;
    const a = crea('a', { href: link, target: '_blank', rel: 'noopener' });
    a.innerHTML = ICONE[k]; // icone fisse definite qui sopra, non contenuti
    a.append(nome);
    azioni.append(a);
  }
  if (azioni.childElementCount) voci.append(azioni);
}

// ---------------------------------------------------------------- anteprima galleria 3D

function opereSala() { return opere().filter((o) => o.in_galleria_3d !== false); }

function disegnaAnteprima3d() {
  const tre = opereSala().slice(0, 3);
  const pose = [
    'left:6%;transform:rotateY(38deg);transform-origin:left center',
    'left:50%;translate:-50% 0',
    'right:6%;transform:rotateY(-38deg);transform-origin:right center',
  ];
  $('[data-anteprima-3d]').replaceChildren(...tre.map((o, i) => crea('img', { src: immagine(o.immagine).miniatura, alt: '', loading: 'lazy', draggable: 'false', style: pose[i] })));
  nascondiSezione('gallery-3d', !tre.length);
}

// ---------------------------------------------------------------- navigazione e pannelli

// I pannelli (opera, testo critico, sala 3D) hanno un indirizzo proprio (#work/…, #review/…, #virtual-gallery):
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

function pannelloAperto() {
  return !!($('[data-visore]')?.open || $('[data-lettore]')?.open || sala);
}

function applicaIndirizzo() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const visore = $('[data-visore]');
  const lettore = $('[data-lettore]');

  if (hash.startsWith(ROTTA_OPERA)) {
    const i = trovaNelVisore(hash.slice(ROTTA_OPERA.length));
    if (i >= 0) {
      mostraNelVisore(i);
      if (!visore.open) visore.showModal();
    }
  } else if (visore.open) visore.close();

  if (hash.startsWith(ROTTA_TESTO) && mostraNelLettore(hash.slice(ROTTA_TESTO.length))) {
    if (!lettore.open) lettore.showModal();
  } else if (lettore.open) lettore.close();

  // #virtual-gallery oppure #virtual-gallery/<id opera> (apre la sala davanti a quell'opera)
  if (hash === ROTTA_SALA || hash.startsWith(`${ROTTA_SALA}/`)) apriSala(hash.slice(ROTTA_SALA.length + 1));
  else if (sala) chiudiSala();

  bloccaScorrimento(pannelloAperto());
  apertura?.sospendi(pannelloAperto()); // la prima schermata non disegna sotto visore, lettore o sala
}

function collegaPannelli() {
  const visore = $('[data-visore]');
  const lettore = $('[data-lettore]');
  const dopo = (sezione) => () => chiudiPannello(sala ? ROTTA_SALA : sezione());
  for (const [d, sezione] of [[visore, () => sezioneVisore], [lettore, () => 'critica-articoli']]) {
    const chiudi = dopo(sezione);
    d.addEventListener('cancel', (e) => { e.preventDefault(); chiudi(); });
    $('[data-chiudi]', d).addEventListener('click', chiudi);
    d.addEventListener('click', (e) => { if (e.target === d || e.target.classList.contains('visore__figura')) chiudi(); });
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

  // Uscita dalla sala 3D: pulsante ed Esc funzionano anche mentre la sala si sta allestendo.
  $('[data-sala-esci]').addEventListener('click', () => chiudiPannello('gallery-3d'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sala && !$('dialog[open]')) chiudiPannello('gallery-3d');
  });

  $('[data-consenso-si]').addEventListener('click', () => {
    try { localStorage.setItem(CHIAVE_CONSENSO, 'si'); } catch { /* il consenso vale per questa visita */ }
    caricaInstagram();
  });

  // Come chiede la nota sui diritti: niente menu «salva immagine» e niente trascinamento delle opere.
  document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('main img, dialog img, .sala')) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG') e.preventDefault(); });
}

function collegaTestata() {
  const testata = $('[data-testata]');
  const menu = $('[data-menu]');
  const apertura = $('#hero');
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

// Prima schermata: la gestisce apertura.js (strato statico sempre presente + motore WebGL facoltativo).
// Contratto: avvia({ radice, palco, opere, suApri }) → { sospendi(bool), ferma() }.
let apertura = null;

async function avviaApertura() {
  const scelte = opere().filter((o) => o.selezionata);
  const elenco = (scelte.length ? scelte : opere()).slice(0, 12)
    .map((o) => ({ ...o, immagine: immagine(o.immagine) }));
  try {
    const { avvia } = await import('./apertura.js?v=3');
    apertura = avvia({
      radice: $('#hero'),
      palco: $('[data-palco]'),
      opere: elenco,
      immagineRiserva: immagine(dati.sito?.immagine_apertura),
      suApri: (o) => { elencoVisore = opere(); sezioneVisore = 'hero'; apriOpera(o.id); },
    });
    apertura?.sospendi(pannelloAperto());
  } catch (err) {
    console.warn('Hero not available:', err);
  }
}

async function apriSala(idIniziale = '') {
  if (sala) { if (idIniziale) sala.vaiA?.(idIniziale); return; }
  const radice = $('[data-sala]');
  if (!webglDisponibile()) {
    alert('The 3D gallery needs a more recent browser. You can still see all the paintings in the Paintings section.');
    chiudiPannello('gallery-3d');
    return;
  }
  const segnaposto = { chiudi() {} }; // finché la sala si allestisce
  sala = segnaposto;
  radice.hidden = false;
  bloccaScorrimento(true);
  try {
    const { creaSala } = await import('./galleria3d.js?v=3');
    if (sala !== segnaposto) return; // chiusa durante il caricamento
    const elenco = opereSala().map((o) => ({ ...o, immagine: immagine(o.immagine) }));
    // Contratto: creaSala(radice, opere, opzioni) → Promise<{ chiudi(), vaiA(id) }>
    const pronta = await creaSala(radice, elenco, {
      colorePareti: testo(dati.sito?.colore_pareti),
      nome: testo(dati.sito?.nome),
      citazione: testo(dati.ricerca?.citazione),
      autoreCitazione: testo(dati.ricerca?.autore_citazione),
      idIniziale,
      suDettagli: (o) => { elencoVisore = opereSala(); sezioneVisore = 'gallery-3d'; apriOpera(o.id); },
      suTutteLeOpere: () => chiudiPannello('portfolio'),
    });
    if (sala !== segnaposto) { pronta.chiudi(); return; }
    sala = pronta;
  } catch (err) {
    console.error(err);
    if (sala === segnaposto) {
      sala = null;
      radice.hidden = true;
      bloccaScorrimento(false);
      alert('The 3D gallery could not be opened.');
    }
  }
}

function chiudiSala() {
  sala?.chiudi();
  sala = null;
  $('[data-sala]').hidden = true;
}

// Arrivando da un link a una sezione (es. #pricing), la pagina resta ferma lì mentre sopra si caricano le foto,
// finché il visitatore non inizia a scorrere da sé.
function mantieniAncora(elemento) {
  let fermo = false;
  const osservatore = new ResizeObserver(() => { if (!fermo) elemento.scrollIntoView({ behavior: 'instant' }); });
  const ferma = () => { fermo = true; osservatore.disconnect(); };
  osservatore.observe($('main'));
  for (const evento of ['wheel', 'touchstart', 'keydown', 'mousedown']) window.addEventListener(evento, ferma, { once: true, passive: true });
  setTimeout(ferma, 5000);
}

// ---------------------------------------------------------------- avvio

async function avvio() {
  try {
    const r = await fetch(FILE_CONTENUTI, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    dati = await r.json();
  } catch (err) {
    console.error('Cannot read the content:', err);
    document.body.append(crea('p', { classe: 'avviso', testo: 'The content could not be loaded. Please try again shortly.' }));
    return;
  }
  riempiTesti();
  costruisciFiltri();
  disegnaMostre();
  disegnaCritica();
  disegnaEventi();
  disegnaContatti();
  disegnaAnteprima3d();
  for (const s of $$('.sezione__testa, .sezione__sottotitolo, .biografia__lato, .biografia__testo, .ricerca__testo, .citazione, .invito-3d__testo, .invito-3d__anteprima, .contatti__invito, .contatti__voci')) s.classList.add('compari');
  osservaComparse();
  collegaTestata();
  collegaPannelli();
  for (const b of $$('[data-apri-galleria]')) b.addEventListener('click', () => naviga(`#${ROTTA_SALA}`));
  applicaIndirizzo();
  // se l'indirizzo puntava a una sezione, ci si arriva dopo che il contenuto è stato costruito
  const ancora = location.hash && !location.hash.includes('/') && location.hash !== `#${ROTTA_SALA}` && document.getElementById(location.hash.slice(1));
  if (ancora) { ancora.scrollIntoView({ behavior: 'instant' }); mantieniAncora(ancora); }
  avviaApertura(); // subito: la prima opera della prima schermata è l'immagine principale della pagina
}

avvio();
