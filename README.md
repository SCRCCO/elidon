# elidonmucaj.art

Sito dell'artista Elidon Mucaj: galleria delle opere, galleria virtuale 3D, biografia, mostre, critica e articoli, contatti.
Il proprietario modifica tutto da un pannello (`/admin`) senza toccare codice.

- **Nessun passaggio di build, nessun database.** Si carica su Aruba via FTP così com'è.
- **Tutti i contenuti stanno in un solo file**, `contenuti/sito.json`, che il pannello legge e scrive.
- **Il pannello richiede PHP 7.4 o successivo** (incluso nei piani Hosting Linux di Aruba). Il sito pubblico è HTML + JavaScript statico.

La guida per il proprietario è in [GUIDA.md](GUIDA.md).

## Cosa c'è

| Sezione | Cosa fa |
|---|---|
| Prima schermata | Le opere «in evidenza» sospese in un anello 3D che ruota; si trascina per girarlo, un clic apre l'opera. |
| Opere | Griglia con filtri per tecnica; visore a tutto schermo con zoom, frecce, scorrimento col dito e pulsante «Chiedi informazioni» (email già compilata). |
| Galleria 3D | Una sala virtuale con le opere appese in scala reale (dal campo «Dimensioni»), faretti, cartellini, visita guidata automatica. Si naviga trascinando, toccando il pavimento o un quadro, oppure con tastiera (W A S D, frecce). |
| Biografia, Mostre, Critica e articoli, Contatti | Testi lunghi con lettore dedicato, mostre raggruppate per anno, link social. L'ancora `#critica-articoli` del vecchio sito continua a funzionare. |

Altri dettagli: ogni opera e ogni testo ha un indirizzo proprio (`#opera/…`, `#critica/…`, `#sala`) che si può condividere, e il tasto «indietro» del telefono chiude le finestre. Il tema scuro è automatico. La scena 3D si ferma quando non è visibile e lascia il posto a un'immagine fissa se il browser non supporta WebGL o se l'utente ha chiesto meno animazioni.

## Struttura

```
index.html              pagina pubblica (scheletro: i contenuti arrivano da contenuti/sito.json)
assets/css/style.css    aspetto del sito (i colori sono variabili in cima al file)
assets/js/main.js       costruisce le sezioni dai contenuti
assets/js/apertura3d.js anello 3D della prima schermata
assets/js/galleria3d.js sala virtuale 3D
assets/vendor/three/    Three.js r186 (licenza MIT), in un solo file
assets/fonts/           caratteri Cormorant Garamond e Inter, ospitati in locale (niente Google Fonts → nessun dato inviato a terzi)
contenuti/sito.json     TUTTI i testi e l'elenco delle opere
contenuti/backup/       copie automatiche a ogni salvataggio (ultime 30)
immagini/caricate/      foto caricate dal pannello
immagini/esempi/        immagini segnaposto: da eliminare quando non servono più
admin/                  pannello di gestione
  schema.json           elenco dei campi modificabili (il pannello costruisce i moduli da qui)
  api.php, lib.php      accesso, salvataggio, foto, copie
  privato/              password (cifrata) e tentativi di accesso; protetta
```

## Messa online su Aruba

1. Dal pannello Aruba, in **Hosting Linux → Gestione PHP**, verifica che la versione sia 7.4 o più recente (va bene l'ultima disponibile).
2. Collegati via FTP (o con il File Manager di Aruba) e carica **tutto il contenuto** di questa cartella nella radice del sito, compresi i file nascosti `.htaccess`.
3. **Subito dopo**, apri `https://www.elidonmucaj.art/admin/` e scegli la password del pannello. Finché non la scegli, chiunque apra quella pagina potrebbe farlo al posto tuo.
4. Se non è già attivo, attiva il certificato SSL dal pannello Aruba. Poi puoi forzare https togliendo il `#` dalle tre righe indicate in `.htaccess`.

Se dopo il caricamento il sito mostra «Errore 500», l'hosting non accetta qualche riga di `.htaccess`: prova a togliere la riga `Options -Indexes`.

Se il pannello risponde «Impossibile scrivere…» quando salvi o carichi una foto, dal client FTP imposta i permessi a `755` per le cartelle `contenuti/`, `contenuti/backup/`, `immagini/caricate/` e `admin/privato/`, e a `644` per `contenuti/sito.json`.

### Aggiornare il codice in futuro

Dopo la messa online, **i contenuti vivono sul server**: il proprietario li cambia dal pannello. Quando ricarichi file via FTP, **non sovrascrivere** queste cartelle, altrimenti cancelli il suo lavoro:

- `contenuti/` (testi, elenco opere, copie)
- `immagini/caricate/` (foto)
- `admin/privato/` (password)

Per aggiornare il sito basta ricaricare `index.html`, `assets/` e i file in `admin/` tranne `privato/`. Dopo una modifica a CSS o JS, aumenta il numero in `?v=1` nei link di `index.html` così i browser scaricano la versione nuova.

## Provarlo sul proprio computer

Serve PHP installato. Dalla cartella del progetto:

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
- Tutto ciò che arriva al server viene ripulito secondo `schema.json`: campi sconosciuti scartati, link solo `http(s)`, percorsi delle immagini solo dentro `immagini/`. Il sito inserisce sempre i testi come testo semplice, mai come HTML.
- Le foto vengono ridotte nel browser prima dell'invio (lato lungo 2400 px più un'anteprima da 900 px): caricamenti leggeri e niente dati EXIF (per esempio la posizione GPS dello scatto) sul server. Il server accetta solo JPEG, PNG e WebP veri e ne sceglie l'estensione.
- Se due finestre salvano in contemporanea, la seconda viene fermata invece di sovrascrivere la prima.

## Aggiungere un campo

1. Aggiungi il campo in `admin/schema.json` (tipi disponibili: `testo`, `testo_lungo`, `email`, `link`, `si_no`, `scelta`, `immagine`). Il pannello lo mostra subito.
2. Usalo nel sito: per un testo semplice basta un elemento con `data-testo="sezione.campo"` in `index.html`; per il resto, in `assets/js/main.js`.

## Contenuti attuali

I testi e le immagini presenti sono **segnaposto**: il vecchio sito non era raggiungibile durante la ristrutturazione, quindi biografia, opere, mostre e testi critici vanno inseriti dal pannello (o direttamente in `contenuti/sito.json`).
