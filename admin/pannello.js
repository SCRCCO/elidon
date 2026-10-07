// Pannello di gestione: costruisce i moduli a partire da schema.json e salva tramite api.php.

const API = 'api.php';
const LATO_GRANDE = 2400;   // pixel del lato lungo della foto pubblicata
const LATO_MINIATURA = 900; // pixel del lato lungo dell'anteprima

const stato = {
  csrf: '',
  limite: 2 * 1024 * 1024,
  schema: null,
  dati: null,
  versione: '',
  sporco: false,
  modifiche: 0,             // contatore: serve a non perdere ciò che si scrive durante un salvataggio
  sezione: '',
  aperti: new Set(),
  anteprimeInutili: new Set(), // foto già leggere o non raggiungibili: non si riprova
  salvataggio: false,
};

const app = document.getElementById('app');

// ---------------------------------------------------------------- utilità

function crea(tag, attributi = {}, figli = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'testo') nodo.textContent = v;
    else if (k === 'classe') nodo.className = v;
    else if (k.startsWith('su') && typeof v === 'function') nodo.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in nodo && typeof v !== 'string') nodo[k] = v;
    else nodo.setAttribute(k, v === true ? '' : v);
  }
  for (const f of [].concat(figli)) if (f !== null && f !== undefined && f !== false) nodo.append(f);
  return nodo;
}

let timerAvviso = 0;
function avvisa(testo, tipo = 'ok', durata = 4500) {
  const el = document.getElementById('avviso');
  el.textContent = testo;
  el.className = `avviso avviso--${tipo}`;
  el.hidden = false;
  clearTimeout(timerAvviso);
  if (durata) timerAvviso = setTimeout(() => { el.hidden = true; }, durata);
}

function nuovoId(prefisso) {
  return `${prefisso}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Indirizzo dell'anteprima di una foto vista dalla cartella admin/ (i nomi possono contenere spazi e accenti).
function srcAnteprima(img) {
  return `../${encodeURI(img.miniatura || img.file)}`;
}

function testoBreve(v, n = 80) {
  const t = String(v || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ---------------------------------------------------------------- comunicazione con il server

async function chiama(azione, { metodo = 'GET', corpo, modulo, riprova = true } = {}) {
  const opzioni = { method: metodo, headers: {}, credentials: 'same-origin', cache: 'no-store' };
  if (metodo === 'POST') opzioni.headers['X-CSRF'] = stato.csrf;
  if (corpo !== undefined) {
    opzioni.headers['Content-Type'] = 'application/json';
    opzioni.body = JSON.stringify(corpo);
  }
  if (modulo) opzioni.body = modulo;

  let risposta;
  try {
    risposta = await fetch(`${API}?azione=${encodeURIComponent(azione)}`, opzioni);
  } catch {
    throw new Error('Connessione assente. Controlla internet e riprova.');
  }
  const testo = await risposta.text();
  let json;
  try {
    json = JSON.parse(testo);
  } catch {
    const senzaPhp = testo.includes('<?php') || risposta.status === 404 || risposta.status === 405;
    throw Object.assign(new Error(senzaPhp
      ? 'Il pannello ha bisogno di PHP: verifica che sia attivo sul tuo hosting.'
      : `Il server ha risposto in modo inatteso (codice ${risposta.status}).`), { codice: risposta.status, senzaPhp });
  }
  // Sessione scaduta mentre si lavora: si chiede la password senza perdere le modifiche, poi si riprova.
  if (risposta.status === 401 && riprova && stato.dati && !['accedi', 'cambia-password'].includes(azione)) {
    await chiediAccessoDiNuovo();
    return chiama(azione, { metodo, corpo, modulo, riprova: false });
  }
  if (!risposta.ok) throw Object.assign(new Error(json.errore || 'Operazione non riuscita.'), { codice: risposta.status });
  return json;
}

// ---------------------------------------------------------------- accesso

function campoPassword(etichetta, nome, autocompletamento) {
  const input = crea('input', { type: 'password', name: nome, id: `campo-${nome}`, autocomplete: autocompletamento, required: true });
  const mostra = crea('button', {
    type: 'button', classe: 'mostra-password', testo: 'Mostra',
    suClick: () => {
      const visibile = input.type === 'text';
      input.type = visibile ? 'password' : 'text';
      mostra.textContent = visibile ? 'Mostra' : 'Nascondi';
    },
  });
  return crea('div', { classe: 'campo' }, [
    crea('label', { for: `campo-${nome}`, testo: etichetta }),
    crea('div', { classe: 'password' }, [input, mostra]),
  ]);
}

function schermataAccesso({ primoAccesso, messaggio }) {
  const errore = crea('p', { classe: 'modulo__errore', role: 'alert', hidden: true });
  const invia = crea('button', { type: 'submit', classe: 'bottone bottone--primario bottone--largo', testo: primoAccesso ? 'Crea la password ed entra' : 'Entra' });
  const campi = primoAccesso
    ? [campoPassword('Nuova password (almeno 10 caratteri)', 'password', 'new-password'), campoPassword('Ripeti la password', 'conferma', 'new-password')]
    : [campoPassword('Password', 'password', 'current-password')];
  const modulo = crea('form', { classe: 'modulo-accesso' }, [
    crea('p', { classe: 'modulo-accesso__marchio', testo: 'Gestione del sito' }),
    crea('h1', { testo: primoAccesso ? 'Benvenuto!' : 'Bentornato' }),
    crea('p', {
      classe: 'modulo-accesso__intro',
      testo: primoAccesso
        ? 'È il primo accesso: scegli la password che userai per modificare il sito. Annotala in un posto sicuro.'
        : (messaggio || 'Inserisci la password per modificare il sito.'),
    }),
    ...campi,
    errore,
    invia,
  ]);
  return { modulo, errore, invia };
}

function mostraAccesso(primoAccesso, messaggio) {
  const { modulo, errore, invia } = schermataAccesso({ primoAccesso, messaggio });
  modulo.addEventListener('submit', async (e) => {
    e.preventDefault();
    errore.hidden = true;
    const password = modulo.elements.password.value;
    if (primoAccesso && password !== modulo.elements.conferma.value) {
      errore.textContent = 'Le due password non coincidono.';
      errore.hidden = false;
      return;
    }
    invia.disabled = true;
    try {
      const r = await chiama(primoAccesso ? 'imposta-password' : 'accedi', { metodo: 'POST', corpo: { password } });
      stato.csrf = r.csrf;
      await apriEditor();
    } catch (err) {
      errore.textContent = err.message;
      errore.hidden = false;
      invia.disabled = false;
    }
  });
  app.replaceChildren(crea('main', { classe: 'pagina-accesso' }, [modulo]));
  modulo.querySelector('input').focus();
}

function chiediAccessoDiNuovo() {
  return new Promise((risolvi) => {
    const { modulo, errore, invia } = schermataAccesso({ primoAccesso: false, messaggio: 'La sessione è scaduta. Inserisci di nuovo la password: le modifiche non salvate sono al sicuro.' });
    const finestra = crea('dialog', { classe: 'finestra' }, [modulo]);
    finestra.addEventListener('cancel', (e) => e.preventDefault());
    modulo.addEventListener('submit', async (e) => {
      e.preventDefault();
      invia.disabled = true;
      errore.hidden = true;
      try {
        const s = await chiama('stato');
        stato.csrf = s.csrf;
        const r = await chiama('accedi', { metodo: 'POST', corpo: { password: modulo.elements.password.value }, riprova: false });
        stato.csrf = r.csrf;
        finestra.close();
        finestra.remove();
        risolvi();
      } catch (err) {
        errore.textContent = err.message;
        errore.hidden = false;
        invia.disabled = false;
      }
    });
    document.body.append(finestra);
    finestra.showModal();
  });
}

// ---------------------------------------------------------------- foto: ridimensionate nel browser prima dell'invio

async function decodifica(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* si prova con <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(`«${file.name}» non è una foto leggibile. Usa file JPEG o PNG.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function larghezzaDi(s) { return s.naturalWidth || s.width; }
function altezzaDi(s) { return s.naturalHeight || s.height; }

// Riduce a metà più volte prima dell'ultimo passaggio: il risultato resta nitido.
function riduci(sorgente, lato) {
  let w = larghezzaDi(sorgente);
  let h = altezzaDi(sorgente);
  const scala = Math.min(1, lato / Math.max(w, h));
  const fw = Math.max(1, Math.round(w * scala));
  const fh = Math.max(1, Math.round(h * scala));
  let attuale = sorgente;
  while (w / 2 >= fw * 1.5) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const c = crea('canvas', { width: w, height: h });
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(attuale, 0, 0, w, h);
    attuale = c;
  }
  const finale = crea('canvas', { width: fw, height: fh });
  const g = finale.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, fw, fh);
  g.imageSmoothingQuality = 'high';
  g.drawImage(attuale, 0, 0, fw, fh);
  return finale;
}

async function comeJpeg(canvas, limite) {
  for (const qualita of [0.9, 0.85, 0.8, 0.72, 0.64]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', qualita));
    if (blob && blob.size <= limite) return blob;
  }
  // ancora troppo pesante per il server: si riduce la risoluzione
  return comeJpeg(riduci(canvas, Math.round(Math.max(canvas.width, canvas.height) * 0.8)), limite);
}

async function caricaFoto(file, suStato = () => {}) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) {
    throw new Error(`«${file.name}» non è una foto.`);
  }
  suStato('Preparo la foto…');
  const sorgente = await decodifica(file);
  const limite = Math.max(300 * 1024, stato.limite * 0.95);
  const grande = riduci(sorgente, LATO_GRANDE);
  const piccola = riduci(sorgente, LATO_MINIATURA);
  const [bGrande, bPiccola] = await Promise.all([comeJpeg(grande, limite), comeJpeg(piccola, limite)]);
  sorgente.close?.();
  suStato('Invio la foto…');
  const modulo = new FormData();
  modulo.append('nome', file.name);
  modulo.append('immagine', bGrande, 'foto.jpg');
  modulo.append('miniatura', bPiccola, 'foto-min.jpg');
  const r = await chiama('carica-immagine', { metodo: 'POST', modulo });
  return r.immagine;
}

// ---------------------------------------------------------------- campi dei moduli

function campo(def, oggetto, { suCambio } = {}) {
  const id = `c-${Math.random().toString(36).slice(2, 9)}`;
  const aggiorna = (valore) => {
    oggetto[def.chiave] = valore;
    segnaModificato();
    suCambio?.(valore);
  };
  const aiuto = def.aiuto ? crea('p', { classe: 'campo__aiuto', id: `${id}-aiuto`, testo: def.aiuto }) : null;
  const descritto = def.aiuto ? `${id}-aiuto` : null;
  let controllo;

  switch (def.tipo) {
    case 'testo_lungo':
      controllo = crea('textarea', { id, rows: def.righe || 4, maxlength: def.max, 'aria-describedby': descritto });
      controllo.value = oggetto[def.chiave] ?? '';
      controllo.addEventListener('input', () => aggiorna(controllo.value));
      break;
    case 'si_no': {
      const casella = crea('input', { type: 'checkbox', id, 'aria-describedby': descritto });
      casella.checked = oggetto[def.chiave] ?? !!def.predefinito;
      casella.addEventListener('change', () => aggiorna(casella.checked));
      return crea('div', { classe: 'campo campo--interruttore' }, [
        crea('label', { classe: 'interruttore', for: id }, [casella, crea('span', { classe: 'interruttore__pista', 'aria-hidden': 'true' }), crea('span', { testo: def.etichetta })]),
        aiuto,
      ]);
    }
    case 'scelta':
      controllo = crea('select', { id, 'aria-describedby': descritto }, def.opzioni.map((o) => crea('option', { value: o, testo: o || '— nessuno —' })));
      controllo.value = oggetto[def.chiave] ?? def.opzioni[0];
      controllo.addEventListener('change', () => aggiorna(controllo.value));
      break;
    case 'immagine':
      return campoImmagine(def, oggetto, aggiorna);
    case 'immagini':
      return campoImmagini(def, oggetto, aggiorna);
    case 'documento':
      return campoDocumento(def, oggetto, aggiorna);
    default: {
      const tipi = { email: 'email', link: 'url' };
      controllo = crea('input', {
        id, type: tipi[def.tipo] || 'text', maxlength: def.max, 'aria-describedby': descritto,
        placeholder: def.tipo === 'link' ? 'https://…' : null,
        inputmode: def.tipo === 'link' ? 'url' : null,
      });
      controllo.value = oggetto[def.chiave] ?? '';
      controllo.addEventListener('input', () => aggiorna(controllo.value));
      if (def.tipo === 'link') {
        controllo.addEventListener('blur', () => {
          const v = controllo.value.trim();
          // «www.sito.it/pagina» diventa «https://www.sito.it/pagina»
          if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) { controllo.value = `https://${v}`; aggiorna(controllo.value); }
        });
      }
    }
  }
  return crea('div', { classe: 'campo' }, [crea('label', { for: id, testo: def.etichetta }), controllo, aiuto]);
}

function campoImmagine(def, oggetto, aggiorna) {
  const anteprima = crea('div', { classe: 'foto__anteprima' });
  const messaggio = crea('p', { classe: 'foto__stato', role: 'status' });
  const scegli = crea('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', classe: 'sr' });
  const rimuovi = crea('button', { type: 'button', classe: 'bottone bottone--leggero', testo: 'Rimuovi' });
  const disegna = () => {
    const img = oggetto[def.chiave];
    anteprima.replaceChildren(img?.file
      ? crea('img', { src: srcAnteprima(img), alt: '' })
      : crea('span', { testo: 'Nessuna foto' }));
    rimuovi.hidden = !img?.file;
  };
  const usa = async (file) => {
    if (!file) return;
    radice.classList.add('foto--attesa');
    try {
      const immagine = await caricaFoto(file, (t) => { messaggio.textContent = t; });
      aggiorna(immagine);
      messaggio.textContent = 'Foto caricata. Ricorda di salvare.';
      disegna();
    } catch (err) {
      messaggio.textContent = err.message;
    } finally {
      radice.classList.remove('foto--attesa');
      scegli.value = '';
    }
  };
  scegli.addEventListener('change', () => usa(scegli.files[0]));
  rimuovi.addEventListener('click', () => { aggiorna(null); messaggio.textContent = ''; disegna(); });
  const radice = crea('div', { classe: 'campo foto' }, [
    crea('span', { classe: 'campo__etichetta', testo: def.etichetta }),
    crea('div', { classe: 'foto__riga' }, [
      anteprima,
      crea('div', { classe: 'foto__azioni' }, [
        crea('label', { classe: 'bottone' }, ['Scegli foto…', scegli]),
        rimuovi,
        crea('p', { classe: 'campo__aiuto', testo: 'Puoi anche trascinare qui la foto. Viene ridotta automaticamente per il web.' }),
        messaggio,
      ]),
    ]),
  ]);
  radice.addEventListener('dragover', (e) => { e.preventDefault(); radice.classList.add('foto--sopra'); });
  radice.addEventListener('dragleave', () => radice.classList.remove('foto--sopra'));
  radice.addEventListener('drop', (e) => { e.preventDefault(); radice.classList.remove('foto--sopra'); usa(e.dataTransfer.files[0]); });
  disegna();
  return radice;
}

function campoImmagini(def, oggetto, aggiorna) {
  const elenco = () => (Array.isArray(oggetto[def.chiave]) ? oggetto[def.chiave] : []);
  const griglia = crea('div', { classe: 'galleria-campo__foto' });
  const messaggio = crea('p', { classe: 'foto__stato', role: 'status' });
  const scegli = crea('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', multiple: true, classe: 'sr' });
  const cambia = (nuovo) => { aggiorna(nuovo); disegna(); };
  const disegna = () => {
    const foto = elenco();
    griglia.replaceChildren(...foto.map((img, i) => crea('div', { classe: 'galleria-campo__voce' }, [
      crea('img', { src: srcAnteprima(img), alt: '' }),
      crea('div', { classe: 'galleria-campo__azioni' }, [
        crea('button', { type: 'button', classe: 'icona', 'aria-label': 'Sposta a sinistra', title: 'Sposta a sinistra', testo: '←', disabled: i === 0,
          suClick: () => { const n = [...foto]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; cambia(n); } }),
        crea('button', { type: 'button', classe: 'icona', 'aria-label': 'Sposta a destra', title: 'Sposta a destra', testo: '→', disabled: i === foto.length - 1,
          suClick: () => { const n = [...foto]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; cambia(n); } }),
        crea('button', { type: 'button', classe: 'icona icona--pericolo', 'aria-label': 'Togli la foto', title: 'Togli', testo: '✕',
          suClick: () => cambia(foto.filter((_, k) => k !== i)) }),
      ]),
    ])));
    if (!foto.length) griglia.append(crea('span', { classe: 'campo__aiuto', testo: 'Nessuna foto.' }));
  };
  scegli.addEventListener('change', async () => {
    const file = [...scegli.files];
    scegli.value = '';
    const errori = [];
    for (const [i, f] of file.entries()) {
      messaggio.textContent = `Carico la foto ${i + 1} di ${file.length}…`;
      try { cambia([...elenco(), await caricaFoto(f)]); } catch (err) { errori.push(err.message); }
    }
    messaggio.textContent = errori.length ? errori.join(' ') : 'Foto aggiunte. Ricorda di salvare.';
  });
  disegna();
  return crea('div', { classe: 'campo foto' }, [
    crea('span', { classe: 'campo__etichetta', testo: def.etichetta }),
    griglia,
    crea('div', { classe: 'foto__azioni' }, [crea('label', { classe: 'bottone' }, ['Aggiungi foto…', scegli]), messaggio]),
  ]);
}

function campoDocumento(def, oggetto, aggiorna) {
  const nome = crea('span', { classe: 'documento__nome' });
  const messaggio = crea('p', { classe: 'foto__stato', role: 'status' });
  const scegli = crea('input', { type: 'file', accept: 'application/pdf,.pdf', classe: 'sr' });
  const rimuovi = crea('button', { type: 'button', classe: 'bottone bottone--leggero', testo: 'Rimuovi' });
  const disegna = () => {
    const percorso = oggetto[def.chiave];
    nome.replaceChildren(percorso
      ? crea('a', { href: `../${encodeURI(percorso)}`, target: '_blank', rel: 'noopener', testo: percorso.split('/').pop() })
      : crea('span', { classe: 'campo__aiuto', testo: 'Nessun PDF.' }));
    rimuovi.hidden = !percorso;
  };
  scegli.addEventListener('change', async () => {
    const file = scegli.files[0];
    scegli.value = '';
    if (!file) return;
    if (file.size > stato.limite) {
      messaggio.textContent = `Il PDF pesa ${(file.size / 1048576).toFixed(1)} MB: il server ne accetta al massimo ${(stato.limite / 1048576).toFixed(1)}. Riducilo (per esempio esportandolo «per il web») e riprova.`;
      return;
    }
    messaggio.textContent = 'Invio il PDF…';
    try {
      const modulo = new FormData();
      modulo.append('nome', file.name);
      modulo.append('documento', file, 'documento.pdf');
      const r = await chiama('carica-documento', { metodo: 'POST', modulo });
      aggiorna(r.documento);
      messaggio.textContent = 'PDF caricato. Ricorda di salvare.';
      disegna();
    } catch (err) {
      messaggio.textContent = err.message;
    }
  });
  rimuovi.addEventListener('click', () => { aggiorna(''); messaggio.textContent = ''; disegna(); });
  disegna();
  return crea('div', { classe: 'campo foto' }, [
    crea('span', { classe: 'campo__etichetta', testo: def.etichetta }),
    crea('div', { classe: 'foto__azioni' }, [nome, crea('label', { classe: 'bottone' }, ['Scegli PDF…', scegli]), rimuovi, messaggio]),
  ]);
}

// ---------------------------------------------------------------- anteprime leggere per le foto che ne sono prive

// Le foto importate dal vecchio sito non hanno una versione ridotta: il sito scaricherebbe sempre l'originale.
// Qui il browser le scarica una per volta, ne crea una copia da 900 pixel e la carica sul server.
function fotoSenzaAnteprima() {
  const trovate = [];
  const cerca = (v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.file === 'string') {
      if (!v.miniatura || v.miniatura === v.file) trovate.push(v);
      return;
    }
    for (const figlio of Object.values(v)) cerca(figlio);
  };
  cerca(stato.dati);
  return trovate.filter((img) => !stato.anteprimeInutili.has(img.file));
}

async function creaAnteprime(bottone) {
  const elenco = fotoSenzaAnteprima();
  if (!elenco.length) return;
  bottone.classList.add('bottone--attesa');
  let fatte = 0;
  const errori = [];
  for (const [i, img] of elenco.entries()) {
    avvisa(`Anteprima ${i + 1} di ${elenco.length}…`, 'info', 0);
    try {
      const r = await fetch(`../${encodeURI(img.file)}`, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`${img.file.split('/').pop()}: file non trovato`);
      const blob = await r.blob();
      const sorgente = await decodifica(new File([blob], img.file.split('/').pop(), { type: blob.type || 'image/jpeg' }));
      img.larghezza = larghezzaDi(sorgente);
      img.altezza = altezzaDi(sorgente);
      if (Math.max(img.larghezza, img.altezza) <= LATO_MINIATURA * 1.15 && blob.size < 350 * 1024) {
        stato.anteprimeInutili.add(img.file); // già leggera: va bene così
      } else {
        const piccola = await comeJpeg(riduci(sorgente, LATO_MINIATURA), Math.max(300 * 1024, stato.limite * 0.95));
        const modulo = new FormData();
        modulo.append('nome', img.file.split('/').pop());
        modulo.append('immagine', piccola, 'anteprima.jpg');
        const caricata = await chiama('carica-immagine', { metodo: 'POST', modulo });
        img.miniatura = caricata.immagine.file;
        fatte++;
      }
      sorgente.close?.();
      segnaModificato();
    } catch (err) {
      errori.push(err.message);
      stato.anteprimeInutili.add(img.file);
    }
  }
  bottone.classList.remove('bottone--attesa');
  if (stato.sporco) await salva();
  avvisa(`${fatte} anteprime create e salvate.${errori.length ? ` Non riuscite: ${errori.join('; ')}` : ''}`, errori.length ? 'errore' : 'ok', errori.length ? 0 : 7000);
  disegnaSezione();
}

// ---------------------------------------------------------------- sezioni

function sezioneOggetto(sezione) {
  stato.dati[sezione.chiave] ??= {};
  const oggetto = stato.dati[sezione.chiave];
  return crea('section', { classe: 'scheda' }, [
    intestazione(sezione),
    crea('div', { classe: 'scheda__campi' }, sezione.campi.map((def) => campo(def, oggetto))),
  ]);
}

function intestazione(sezione, azioni = []) {
  return crea('header', { classe: 'scheda__testa' }, [
    crea('div', {}, [crea('h2', { testo: sezione.titolo }), sezione.descrizione ? crea('p', { testo: sezione.descrizione }) : null]),
    azioni.length ? crea('div', { classe: 'scheda__azioni' }, azioni) : null,
  ]);
}

function infoVoce(sezione, voce) {
  if (sezione.chiave === 'opere') return [voce.anno, voce.tecnica, voce.dimensioni].filter(Boolean).join(' · ');
  if (sezione.chiave === 'mostre') return [voce.anno, voce.luogo, voce.tipo].filter(Boolean).join(' · ');
  if (sezione.chiave === 'critica') return [voce.tipo, voce.autore, voce.fonte].filter(Boolean).join(' · ');
  return '';
}

function nuovaVoce(sezione) {
  const voce = { id: nuovoId(sezione.elemento) };
  for (const def of sezione.campi) {
    if (def.tipo === 'si_no') voce[def.chiave] = !!def.predefinito;
    else if (def.tipo === 'scelta') voce[def.chiave] = def.opzioni[0];
    else if (def.tipo === 'immagine') voce[def.chiave] = null;
    else if (def.tipo === 'immagini') voce[def.chiave] = [];
    else voce[def.chiave] = '';
  }
  return voce;
}

function titoloDaFile(nome) {
  const base = nome.replace(/\.[^.]+$/, '');
  if (/^(img|dsc|dscn|dcim|pxl|photo|foto|image|immagine|whatsapp|screenshot)[\s_-]*\d/i.test(base) || /^\d[\d\s_-]*$/.test(base)) return '';
  const t = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sezioneLista(sezione) {
  stato.dati[sezione.chiave] ??= [];
  const elenco = stato.dati[sezione.chiave];
  const nome = sezione.elemento;
  const aggiungi = crea('button', {
    type: 'button', classe: 'bottone bottone--primario', testo: `+ Aggiungi ${nome}`,
    suClick: () => {
      const voce = nuovaVoce(sezione);
      elenco.unshift(voce);
      stato.aperti.add(voce.id);
      segnaModificato();
      disegnaSezione();
      document.querySelector('.voce--aperta input, .voce--aperta textarea')?.focus();
    },
  });
  const azioni = [aggiungi];

  if (sezione.campo_immagine) {
    const multiplo = crea('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', multiple: true, classe: 'sr' });
    const etichetta = crea('label', { classe: 'bottone' }, ['Aggiungi opere da più foto…', multiplo]);
    multiplo.addEventListener('change', async () => {
      const file = [...multiplo.files];
      multiplo.value = '';
      if (!file.length) return;
      etichetta.classList.add('bottone--attesa');
      let riuscite = 0;
      const errori = [];
      for (const [i, f] of file.entries()) {
        avvisa(`Carico la foto ${i + 1} di ${file.length}…`, 'info', 0);
        try {
          const immagine = await caricaFoto(f);
          const voce = nuovaVoce(sezione);
          voce[sezione.campo_immagine] = immagine;
          voce[sezione.campo_titolo] = titoloDaFile(f.name);
          elenco.splice(riuscite, 0, voce);
          riuscite++;
        } catch (err) {
          errori.push(err.message);
        }
      }
      etichetta.classList.remove('bottone--attesa');
      if (riuscite) segnaModificato();
      disegnaSezione();
      if (errori.length) avvisa(`${riuscite} foto aggiunte. Problemi: ${errori.join(' ')}`, 'errore', 0);
      else avvisa(`${riuscite} opere aggiunte in cima all'elenco. Completa titoli e dati, poi salva.`, 'ok', 7000);
    });
    azioni.push(etichetta);
  }
  const senzaAnteprima = sezione.chiave === 'opere' ? fotoSenzaAnteprima().length : 0;
  if (senzaAnteprima) {
    const bottone = crea('button', { type: 'button', classe: 'bottone', testo: `Crea anteprime leggere (${senzaAnteprima})`, suClick: () => creaAnteprime(bottone) });
    bottone.title = 'Le foto importate dal vecchio sito non hanno una versione ridotta: crearla rende il sito molto più veloce. Si fa una volta sola.';
    azioni.push(bottone);
  }

  const lista = crea('ol', { classe: 'voci' });
  if (!elenco.length) lista.append(crea('li', { classe: 'voci__vuoto', testo: `Ancora nessun elemento. Usa «Aggiungi ${nome}».` }));

  elenco.forEach((voce, i) => {
    voce.id ||= nuovoId(nome);
    const aperta = stato.aperti.has(voce.id);
    const titolo = crea('span', { classe: 'voce__titolo', testo: testoBreve(voce[sezione.campo_titolo]) || '(senza titolo)' });
    const info = crea('span', { classe: 'voce__info', testo: infoVoce(sezione, voce) });
    const img = sezione.campo_immagine ? voce[sezione.campo_immagine] : null;
    const miniatura = sezione.campo_immagine
      ? crea('span', { classe: 'voce__miniatura' }, img?.file ? crea('img', { src: srcAnteprima(img), alt: '', loading: 'lazy' }) : crea('span', { testo: 'senza foto' }))
      : null;
    const corpo = crea('div', { classe: 'voce__corpo', hidden: !aperta });
    const apri = crea('button', {
      type: 'button', classe: 'voce__apri', 'aria-expanded': String(aperta),
      suClick: () => {
        const ora = corpo.hidden;
        corpo.hidden = !ora;
        apri.setAttribute('aria-expanded', String(ora));
        voceEl.classList.toggle('voce--aperta', ora);
        if (ora) { stato.aperti.add(voce.id); if (!corpo.childElementCount) riempi(); } else stato.aperti.delete(voce.id);
      },
    }, [miniatura, crea('span', { classe: 'voce__testi' }, [titolo, info])]);

    const sposta = (d) => {
      const j = i + d;
      if (j < 0 || j >= elenco.length) return;
      [elenco[i], elenco[j]] = [elenco[j], elenco[i]];
      segnaModificato();
      disegnaSezione();
      document.querySelector(`[data-voce="${CSS.escape(voce.id)}"] [data-sposta="${d}"]`)?.focus();
    };
    const voceEl = crea('li', { classe: `voce${aperta ? ' voce--aperta' : ''}`, 'data-voce': voce.id }, [
      crea('div', { classe: 'voce__testa' }, [
        apri,
        crea('div', { classe: 'voce__azioni' }, [
          crea('button', { type: 'button', classe: 'icona', 'data-sposta': '-1', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, testo: '↑', suClick: () => sposta(-1) }),
          crea('button', { type: 'button', classe: 'icona', 'data-sposta': '1', title: 'Sposta giù', 'aria-label': 'Sposta giù', disabled: i === elenco.length - 1, testo: '↓', suClick: () => sposta(1) }),
          crea('button', {
            type: 'button', classe: 'icona icona--pericolo', title: 'Elimina', 'aria-label': 'Elimina', testo: '✕',
            suClick: () => {
              const quale = testoBreve(voce[sezione.campo_titolo], 50) || `questo elemento`;
              if (!confirm(`Eliminare «${quale}»?\n\nL'eliminazione diventa definitiva solo quando salvi.`)) return;
              elenco.splice(i, 1);
              segnaModificato();
              disegnaSezione();
            },
          }),
        ]),
      ]),
      corpo,
    ]);
    const riempi = () => {
      corpo.replaceChildren(...sezione.campi.map((def) => campo(def, voce, {
        suCambio: () => {
          titolo.textContent = testoBreve(voce[sezione.campo_titolo]) || '(senza titolo)';
          info.textContent = infoVoce(sezione, voce);
          if (def.tipo === 'immagine' && miniatura) {
            const im = voce[def.chiave];
            miniatura.replaceChildren(im?.file ? crea('img', { src: srcAnteprima(im), alt: '' }) : crea('span', { testo: 'senza foto' }));
          }
        },
      })));
    };
    if (aperta) riempi();
    lista.append(voceEl);
  });

  return crea('section', { classe: 'scheda' }, [
    intestazione(sezione, azioni),
    crea('p', { classe: 'scheda__conta', testo: `${elenco.length} ${elenco.length === 1 ? nome : plurale(nome)} · l'ordine qui è l'ordine sul sito` }),
    lista,
  ]);
}

function plurale(nome) {
  return { opera: 'opere', mostra: 'mostre', testo: 'testi' }[nome] || nome;
}

async function sezioneCopie() {
  const contenitore = crea('section', { classe: 'scheda' }, [
    intestazione({
      titolo: 'Copie di sicurezza',
      descrizione: 'A ogni salvataggio il sito conserva la versione precedente (le ultime 30). Se qualcosa va storto, puoi tornare indietro.',
    }, [
      crea('button', {
        type: 'button', classe: 'bottone', testo: 'Scarica i contenuti attuali',
        suClick: () => {
          const blob = new Blob([JSON.stringify(stato.dati, null, 2)], { type: 'application/json' });
          const a = crea('a', { href: URL.createObjectURL(blob), download: `contenuti-sito-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        },
      }),
    ]),
  ]);
  const lista = crea('ol', { classe: 'copie' }, [crea('li', { testo: 'Caricamento…' })]);
  contenitore.append(lista);
  try {
    const { copie } = await chiama('copie');
    lista.replaceChildren();
    if (!copie.length) lista.append(crea('li', { classe: 'voci__vuoto', testo: 'Nessuna copia per ora: la prima viene creata al primo salvataggio.' }));
    for (const c of copie) {
      lista.append(crea('li', { classe: 'copia' }, [
        crea('span', {}, [crea('strong', { testo: c.quando }), crea('span', { classe: 'voce__info', testo: ` · ${Math.max(1, Math.round(c.byte / 1024))} kB` })]),
        crea('button', {
          type: 'button', classe: 'bottone bottone--leggero', testo: 'Ripristina',
          suClick: async () => {
            const avviso = stato.sporco ? '\n\nAttenzione: le modifiche non salvate in questa pagina andranno perse.' : '';
            if (!confirm(`Tornare alla versione del ${c.quando}?\n\nLa versione attuale viene comunque conservata tra le copie.${avviso}`)) return;
            try {
              const r = await chiama('ripristina', { metodo: 'POST', corpo: { nome: c.nome } });
              stato.dati = r.dati;
              stato.versione = r.versione;
              stato.sporco = false;
              aggiornaBarra();
              avvisa(`Ripristinata la versione del ${c.quando}. Il sito è già aggiornato.`);
              disegnaSezione();
            } catch (err) {
              avvisa(err.message, 'errore', 0);
            }
          },
        }),
      ]));
    }
  } catch (err) {
    lista.replaceChildren(crea('li', { classe: 'modulo__errore', testo: err.message }));
  }
  return contenitore;
}

function sezioneAccount() {
  const errore = crea('p', { classe: 'modulo__errore', role: 'alert', hidden: true });
  const modulo = crea('form', { classe: 'scheda__campi' }, [
    campoPassword('Password attuale', 'attuale', 'current-password'),
    campoPassword('Nuova password (almeno 10 caratteri)', 'nuova', 'new-password'),
    campoPassword('Ripeti la nuova password', 'conferma', 'new-password'),
    errore,
    crea('button', { type: 'submit', classe: 'bottone bottone--primario', testo: 'Cambia password' }),
  ]);
  modulo.addEventListener('submit', async (e) => {
    e.preventDefault();
    errore.hidden = true;
    const { attuale, nuova, conferma } = modulo.elements;
    if (nuova.value !== conferma.value) { errore.textContent = 'Le due password nuove non coincidono.'; errore.hidden = false; return; }
    try {
      await chiama('cambia-password', { metodo: 'POST', corpo: { attuale: attuale.value, nuova: nuova.value } });
      modulo.reset();
      avvisa('Password cambiata.');
    } catch (err) {
      errore.textContent = err.message;
      errore.hidden = false;
    }
  });
  return crea('section', { classe: 'scheda' }, [
    intestazione({ titolo: 'Password', descrizione: 'Se dimentichi la password, chi gestisce l\'hosting può azzerarla cancellando il file admin/privato/accesso.php: al primo accesso successivo ne sceglierai una nuova.' }),
    modulo,
  ]);
}

// ---------------------------------------------------------------- struttura del pannello

function vociMenu() {
  return [
    ...stato.schema.sezioni.map((s) => ({ chiave: s.chiave, titolo: s.titolo, conta: s.tipo === 'lista' ? (stato.dati[s.chiave] || []).length : null })),
    { chiave: 'copie', titolo: 'Copie di sicurezza' },
    { chiave: 'account', titolo: 'Password' },
  ];
}

function disegnaMenu() {
  const menu = document.querySelector('[data-menu]');
  menu.replaceChildren(...vociMenu().map((v) => crea('a', {
    href: `#${v.chiave}`, 'aria-current': v.chiave === stato.sezione ? 'page' : null,
  }, [v.titolo, v.conta !== null && v.conta !== undefined ? crea('span', { classe: 'menu__conta', testo: String(v.conta) }) : null])));
}

async function disegnaSezione() {
  const area = document.querySelector('[data-area]');
  const chiave = stato.sezione;
  const sezione = stato.schema.sezioni.find((s) => s.chiave === chiave);
  let contenuto;
  if (sezione) contenuto = sezione.tipo === 'lista' ? sezioneLista(sezione) : sezioneOggetto(sezione);
  else if (chiave === 'copie') contenuto = await sezioneCopie();
  else contenuto = sezioneAccount();
  if (stato.sezione !== chiave) return;
  const scorrimento = window.scrollY;
  area.replaceChildren(contenuto);
  window.scrollTo(0, scorrimento);
  disegnaMenu();
}

function vaiA(chiave) {
  const valide = vociMenu().map((v) => v.chiave);
  stato.sezione = valide.includes(chiave) ? chiave : (valide.includes('opere') ? 'opere' : valide[0]);
  disegnaSezione();
  window.scrollTo(0, 0);
}

function segnaModificato() {
  stato.modifiche++;
  if (!stato.sporco) { stato.sporco = true; aggiornaBarra(); }
}

function aggiornaBarra() {
  const etichetta = document.querySelector('[data-stato]');
  const salva = document.querySelector('[data-salva]');
  if (!etichetta) return;
  etichetta.textContent = stato.salvataggio ? 'Salvataggio…' : stato.sporco ? 'Modifiche non salvate' : 'Tutto salvato';
  etichetta.dataset.tipo = stato.sporco ? 'sporco' : 'pulito';
  salva.disabled = !stato.sporco || stato.salvataggio;
  document.body.classList.toggle('con-modifiche', stato.sporco);
}

function avvertenze() {
  const senzaFoto = (stato.dati.opere || []).filter((o) => !o.immagine?.file).length;
  return senzaFoto ? ` Nota: ${senzaFoto === 1 ? "un'opera senza foto non compare" : `${senzaFoto} opere senza foto non compaiono`} sul sito.` : '';
}

async function salva() {
  if (!stato.sporco || stato.salvataggio) return;
  stato.salvataggio = true;
  aggiornaBarra();
  const primaDelSalvataggio = stato.modifiche;
  try {
    const r = await chiama('salva', { metodo: 'POST', corpo: { dati: stato.dati, versione: stato.versione } });
    stato.versione = r.versione;
    if (stato.modifiche === primaDelSalvataggio) {
      stato.dati = r.dati;
      stato.sporco = false;
      disegnaSezione();
    }
    avvisa(`Salvato! Il sito è già aggiornato.${avvertenze()}`, 'ok', 6000);
  } catch (err) {
    avvisa(err.message, 'errore', 0);
  } finally {
    stato.salvataggio = false;
    aggiornaBarra();
  }
}

async function esci() {
  if (stato.sporco && !confirm('Ci sono modifiche non salvate. Uscire comunque?')) return;
  try { await chiama('esci', { metodo: 'POST' }); } catch { /* si esce comunque */ }
  stato.sporco = false;
  location.replace(location.pathname);
}

async function apriEditor() {
  const { dati, versione, schema } = await chiama('contenuti');
  stato.dati = dati;
  stato.versione = versione;
  stato.schema = schema;
  stato.sporco = false;

  const nome = dati.sito?.nome || 'il tuo sito';
  app.replaceChildren(
    crea('header', { classe: 'barra' }, [
      crea('div', { classe: 'barra__titolo' }, [crea('strong', { testo: 'Gestione del sito' }), crea('span', { testo: nome })]),
      crea('div', { classe: 'barra__azioni' }, [
        crea('a', { classe: 'bottone bottone--leggero', href: '../', target: '_blank', rel: 'noopener', testo: 'Vedi il sito ↗' }),
        crea('button', { type: 'button', classe: 'bottone bottone--leggero', testo: 'Esci', suClick: esci }),
      ]),
    ]),
    crea('div', { classe: 'corpo' }, [
      crea('nav', { classe: 'menu', 'aria-label': 'Sezioni', 'data-menu': true }),
      crea('main', { classe: 'area', 'data-area': true }),
    ]),
    crea('div', { classe: 'salvataggio' }, [
      crea('span', { classe: 'salvataggio__stato', 'data-stato': true }),
      crea('button', { type: 'button', classe: 'bottone bottone--primario', 'data-salva': true, testo: 'Salva modifiche', suClick: salva }),
    ]),
  );
  aggiornaBarra();
  vaiA(location.hash.slice(1));
}

// ---------------------------------------------------------------- avvio

document.getElementById('avviso').addEventListener('click', (e) => { e.currentTarget.hidden = true; });
window.addEventListener('hashchange', () => { if (stato.schema && stato.dati) vaiA(location.hash.slice(1)); });
window.addEventListener('beforeunload', (e) => { if (stato.sporco) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && stato.dati) { e.preventDefault(); salva(); }
});

(async function avvio() {
  try {
    const s = await chiama('stato');
    stato.csrf = s.csrf;
    stato.limite = s.limite_caricamento || stato.limite;
    if (!s.https && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      avvisa('Attenzione: il pannello non usa una connessione sicura (https). Attiva il certificato SSL dal pannello Aruba.', 'errore', 0);
    }
    if (!s.configurato) mostraAccesso(true);
    else if (!s.autenticato) mostraAccesso(false);
    else await apriEditor();
  } catch (err) {
    app.replaceChildren(crea('main', { classe: 'pagina-accesso' }, [
      crea('div', { classe: 'modulo-accesso' }, [crea('h1', { testo: 'Pannello non disponibile' }), crea('p', { testo: err.message })]),
    ]));
  }
})();
