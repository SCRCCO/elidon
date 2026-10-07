# elidonmucaj.art

Sito dell'artista Elidon Muçaj: galleria delle opere, galleria virtuale 3D, biografia, ricerca artistica, curriculum, critica e articoli, eventi, contatti.
Il sito pubblico è in inglese, come quello precedente; il pannello di gestione (`/admin`) è in italiano e permette al proprietario di modificare tutto senza toccare codice.

- **Nessun passaggio di build, nessun database.** Si carica su Aruba via FTP così com'è.
- **Tutti i contenuti stanno in un solo file**, `contenuti/sito.json`, che il pannello legge e scrive.
- **Le foto delle opere restano dove sono già sul server** (`assets/img/…`), come i PDF (`assets/…pdf`): il nuovo sito le usa senza spostarle.
- **Il pannello richiede PHP 7.4 o successivo** (incluso nei piani Hosting Linux di Aruba). Il sito pubblico è HTML + JavaScript statico.

La guida per il proprietario è in [GUIDA.md](GUIDA.md).

## Cosa c'è

| Sezione | Cosa fa |
|---|---|
| Prima schermata | Le opere scelte («Selected works») sospese in un anello 3D che ruota; si trascina per girarlo, un clic apre l'opera. |
| Paintings | Griglia con i filtri del vecchio sito: Selected works, gli ultimi quattro anni, Earlier works, All. Visore a tutto schermo con zoom, frecce, scorrimento col dito e «Ask about this work» (email già compilata). |
| 3D Gallery | Una sala virtuale con le opere appese in scala reale (dal campo «Dimensioni»), faretti, cartellini, visita guidata automatica. Si naviga trascinando, toccando il pavimento o un quadro, oppure con la tastiera (W A S D, frecce). |
| About, Research | Biografia e ricerca artistica, con la citazione. |
| Curriculum | Mostre, premi e pubblicazioni raggruppati per anno e ordinati per data; ogni voce può avere foto della mostra. |
| Reviews | Schede con immagine; lettore dedicato con pulsanti per il PDF e per l'articolo online. |
| Events | Post Instagram: si caricano solo dopo che il visitatore lo chiede (Instagram imposta propri cookie). Gli eventi con una foto diventano schede normali. |
| Contact | Email, telefono, portfolio PDF da scaricare, social. |

Altri dettagli:
- Funzionano ancora tutti gli indirizzi del vecchio sito (`#about`, `#portfolio`, `#resume`, `#pricing`, `#critica-articoli`, `#services`, `#contact`).
- Ogni opera e ogni testo ha un indirizzo proprio che si può condividere (`#work/…`, `#review/…`, `#virtual-gallery`), e il tasto «indietro» del telefono chiude le finestre.
- Tasto destro e trascinamento sono disattivati sulle immagini, come chiede la nota sui diritti nel piè di pagina.
- La scena 3D si ferma quando non è visibile, e lascia il posto a un'immagine fissa se il browser non supporta WebGL o se l'utente ha chiesto meno animazioni.

## Struttura

```
index.html              pagina pubblica (scheletro: i contenuti arrivano da contenuti/sito.json)
assets/css/style.css    aspetto del sito (i colori sono variabili in cima al file)
assets/js/main.js       costruisce le sezioni dai contenuti
assets/js/apertura3d.js anello 3D della prima schermata
assets/js/galleria3d.js sala virtuale 3D
assets/vendor/three/    Three.js r186 (licenza MIT), in un solo file
assets/fonts/           caratteri Cormorant Garamond e Inter, ospitati in locale (niente Google Fonts → nessun dato inviato a terzi)
assets/img/, assets/*.pdf   NON sono nel repository: sono le foto e i PDF già presenti sul server
contenuti/sito.json     TUTTI i testi e l'elenco delle opere
contenuti/backup/       copie automatiche a ogni salvataggio (ultime 30)
immagini/caricate/      foto e anteprime caricate dal pannello
documenti/              PDF caricati dal pannello
admin/                  pannello di gestione
  schema.json           elenco dei campi modificabili (il pannello costruisce i moduli da qui)
  api.php, lib.php      accesso, salvataggio, foto, PDF, copie
  privato/              password (cifrata) e tentativi di accesso; protetta
```

## Messa online su Aruba

1. Dal pannello Aruba, in **Hosting Linux → Gestione PHP**, verifica che la versione sia 7.4 o più recente (va bene l'ultima disponibile).
2. **Fai una copia di sicurezza del sito attuale**: scarica via FTP tutta la cartella del sito sul tuo computer.
3. Carica via FTP (o con il File Manager di Aruba) **tutto il contenuto** di questa cartella nella radice del sito, compresi i file nascosti `.htaccess`, sovrascrivendo quando richiesto.
   - **Non cancellare** `assets/img/` né i PDF in `assets/`: il nuovo sito li usa.
   - I file del vecchio modello grafico (`assets/css/main.css`, `assets/vendor/bootstrap/`, `assets/vendor/aos/`…) non servono più: puoi lasciarli o cancellarli.
4. **Subito dopo**, apri `https://www.elidonmucaj.art/admin/` e scegli la password del pannello. Finché non la scegli, chiunque apra quella pagina potrebbe farlo al posto tuo.
5. Nel pannello, scheda **Opere**, premi **Crea anteprime leggere**. Il pannello crea una copia piccola di ogni foto del vecchio sito: senza, la pagina scaricherebbe sempre le foto originali. Si fa una volta sola e richiede qualche minuto.
6. Se non è già attivo, attiva il certificato SSL dal pannello Aruba. Poi puoi forzare https togliendo il `#` dalle tre righe indicate in `.htaccess`.

Se dopo il caricamento il sito mostra «Errore 500», l'hosting non accetta qualche riga di `.htaccess`: prova a togliere la riga `Options -Indexes`.

Se il pannello risponde «Impossibile scrivere…» quando salvi o carichi una foto, dal client FTP imposta i permessi a `755` per le cartelle `contenuti/`, `contenuti/backup/`, `immagini/caricate/`, `documenti/` e `admin/privato/`, e a `644` per `contenuti/sito.json`.

### Aggiornare il codice in futuro

Dopo la messa online, **i contenuti vivono sul server**: il proprietario li cambia dal pannello. Quando ricarichi file via FTP, **non sovrascrivere** queste cartelle, altrimenti cancelli il suo lavoro:

- `contenuti/` (testi, elenco opere, copie)
- `immagini/caricate/` e `documenti/` (foto e PDF)
- `assets/img/` (foto del vecchio sito)
- `admin/privato/` (password)

Per aggiornare il sito basta ricaricare `index.html`, `assets/css`, `assets/js`, `assets/vendor/three`, `assets/fonts` e i file in `admin/` tranne `privato/`. Dopo una modifica a CSS o JS, aumenta il numero in `?v=2` nei link di `index.html` così i browser scaricano la versione nuova.

## Provarlo sul proprio computer

Serve PHP installato. Per vedere le foto, copia anche `assets/img/` e i PDF dal server. Dalla cartella del progetto:

```sh
php -S localhost:8000
```

Poi apri <http://localhost:8000> per il sito e <http://localhost:8000/admin/> per il pannello. Aprire `index.html` con un doppio clic non basta: il browser blocca la lettura di `contenuti/sito.json` dai file locali.

## Password dimenticata

Cancella via FTP il file `admin/privato/accesso.php`. Al successivo accesso a `/admin` il pannello chiederà di sceglierne una nuova.

## Sicurezza del pannello

- Password salvata solo come impronta (`password_hash`), dentro un file `.php` che dal browser risulta vuoto; la cartella è comunque bloccata da `.htaccess`.
- Dopo 8 tentativi sbagliati l'indirizzo IP viene bloccato per 15 minuti.
- Cookie di sessione `HttpOnly` e `SameSite=Strict`; ogni richiesta che modifica qualcosa richiede un gettone anti-falsificazione (CSRF).
- Tutto ciò che arriva al server viene ripulito secondo `schema.json`: campi sconosciuti scartati, link solo `http(s)`, immagini solo dentro `immagini/` o `assets/img/`, PDF solo dentro `documenti/` o `assets/`, mai percorsi con `..`. Il sito inserisce sempre i testi come testo semplice, mai come HTML.
- Le foto vengono ridotte nel browser prima dell'invio (lato lungo 2400 px più un'anteprima da 900 px): caricamenti leggeri e niente dati EXIF (per esempio la posizione GPS dello scatto) sul server. Il server accetta solo JPEG, PNG e WebP veri (e PDF veri) e ne sceglie l'estensione.
- Se due finestre salvano in contemporanea, la seconda viene fermata invece di sovrascrivere la prima.

## Aggiungere un campo

1. Aggiungi il campo in `admin/schema.json` (tipi disponibili: `testo`, `testo_lungo`, `email`, `link`, `si_no`, `scelta`, `immagine`, `immagini`, `documento`). Il pannello lo mostra subito.
2. Usalo nel sito: per un testo semplice basta un elemento con `data-testo="sezione.campo"` in `index.html`; per il resto, in `assets/js/main.js`.

## Contenuti importati dal vecchio sito

Testi, 83 opere (17 scelte, che sono anche quelle esposte nella galleria 3D), 17 voci di curriculum, 3 testi critici, 8 post Instagram e contatti vengono dal codice del vecchio sito. Alcuni titoli contenevano anche la tecnica, ed è stata spostata nel campo giusto. Da verificare con l'artista:

- «Dove», «Io», «Loro», «Loro 2» (prima «Dove Olio su tela», «Io-olio-su-tela»…).
- «Auturitratto» corretto in «Autoritratto»; «Camminare-in-consapevolezza» senza trattini.
- Opere dei primi anni: «Jolly», «fanculosièrotto», «Scusi», «Ti prego», «Si prega di chiudere il cancello per spedizione e ricevimento» hanno ora i materiali nel campo Tecnica; quella intitolata «Miele, macerie, chiodi da muratore, vetro e legno» è diventata «Senza titolo» con quei materiali come tecnica.
- Nel vecchio sito «Studio di Lucian Freud» e «Studio di un ritratto» comparivano sia nel 2024 sia nel 2023, e c'erano due opere «Lui 2» (2024 e 2023): sono state lasciate tutte, vanno controllate.
- Per «Lui» (2023) l'anteprima e la versione ingrandita del vecchio sito erano due file diversi (`Lui---Olio-su-tela---124,5x142-cm.jpg` e `Lui-è-grande-Olio-su-tela.jpg`): è stata usata la prima.
