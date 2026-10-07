<?php
// Interfaccia del pannello di gestione: accesso, lettura e salvataggio dei contenuti, foto, copie di sicurezza.
require __DIR__ . '/lib.php';

header('X-Robots-Tag: noindex, nofollow');
avvia_sessione();

$azione = (string) ($_GET['azione'] ?? '');
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Tutto ciò che modifica qualcosa arriva solo in POST, con il gettone anti-falsificazione.
$soloPost = ['imposta-password', 'accedi', 'esci', 'cambia-password', 'salva', 'carica-immagine', 'ripristina'];
if (in_array($azione, $soloPost, true)) {
    if ($metodo !== 'POST') {
        errore('Metodo non consentito', 405);
    }
    controlla_csrf();
}

try {
    switch ($azione) {
        case 'stato':
            rispondi([
                'configurato' => configurato(),
                'autenticato' => configurato() && autenticato(),
                'csrf' => $_SESSION['csrf'],
                'https' => connessione_sicura(),
                'limite_caricamento' => limite_caricamento(),
            ]);
            // no break

        case 'imposta-password':
            // Solo al primo accesso, finché non esiste una password.
            if (configurato()) {
                errore('La password è già stata impostata.', 403);
            }
            $password = (string) (corpo_json()['password'] ?? '');
            if (mb_strlen($password) < LUNGHEZZA_MIN_PASSWORD) {
                errore('La password deve avere almeno ' . LUNGHEZZA_MIN_PASSWORD . ' caratteri.');
            }
            scrivi_privato('accesso', ['hash' => password_hash($password, PASSWORD_DEFAULT), 'creata' => date('c')]);
            entra();
            rispondi(['ok' => true, 'csrf' => $_SESSION['csrf']]);
            // no break

        case 'accedi':
            if (!configurato()) {
                errore('Prima scegli una password.', 409);
            }
            $attesa = secondi_di_blocco();
            if ($attesa > 0) {
                errore('Troppi tentativi sbagliati. Riprova tra ' . ceil($attesa / 60) . ' minuti.', 429);
            }
            $accesso = leggi_privato('accesso');
            $password = (string) (corpo_json()['password'] ?? '');
            if (!password_verify($password, $accesso['hash'])) {
                registra_tentativo(false);
                usleep(random_int(200000, 500000));
                errore('Password sbagliata.', 401);
            }
            registra_tentativo(true);
            if (password_needs_rehash($accesso['hash'], PASSWORD_DEFAULT)) {
                $accesso['hash'] = password_hash($password, PASSWORD_DEFAULT);
                scrivi_privato('accesso', $accesso);
            }
            entra();
            rispondi(['ok' => true, 'csrf' => $_SESSION['csrf']]);
            // no break

        case 'esci':
            $_SESSION = [];
            session_destroy();
            rispondi(['ok' => true]);
            // no break

        case 'cambia-password':
            richiedi_accesso();
            $corpo = corpo_json();
            $accesso = leggi_privato('accesso');
            if (!password_verify((string) ($corpo['attuale'] ?? ''), $accesso['hash'])) {
                errore('La password attuale non è corretta.', 401);
            }
            $nuova = (string) ($corpo['nuova'] ?? '');
            if (mb_strlen($nuova) < LUNGHEZZA_MIN_PASSWORD) {
                errore('La nuova password deve avere almeno ' . LUNGHEZZA_MIN_PASSWORD . ' caratteri.');
            }
            scrivi_privato('accesso', ['hash' => password_hash($nuova, PASSWORD_DEFAULT), 'creata' => date('c')]);
            rispondi(['ok' => true]);
            // no break

        case 'contenuti':
            richiedi_accesso();
            rispondi(['dati' => leggi_contenuti(), 'versione' => versione_contenuti(), 'schema' => schema()]);
            // no break

        case 'salva':
            richiedi_accesso();
            $corpo = corpo_json();
            if (!isset($corpo['dati']) || !is_array($corpo['dati'])) {
                errore('Nessun contenuto ricevuto.');
            }
            // Se qualcuno ha salvato da un'altra finestra nel frattempo, non sovrascriviamo il suo lavoro.
            if (($corpo['versione'] ?? '') !== versione_contenuti()) {
                errore('I contenuti sono stati modificati da un\'altra finestra o da un altro dispositivo. Ricarica la pagina prima di salvare.', 409);
            }
            $dati = pulisci_contenuti($corpo['dati'], schema());
            rispondi(['ok' => true, 'versione' => salva_contenuti($dati), 'dati' => $dati]);
            // no break

        case 'carica-immagine':
            richiedi_accesso();
            if (empty($_FILES['immagine'])) {
                errore('Nessuna foto ricevuta. Se la foto è molto grande, il server potrebbe averla rifiutata.');
            }
            $nome = slug(pathinfo((string) ($_POST['nome'] ?? ''), PATHINFO_FILENAME)) ?: 'foto';
            $base = CARTELLA_CARICATE . '/' . date('Y') . '/' . $nome . '-' . bin2hex(random_bytes(3));
            $grande = salva_immagine_caricata($_FILES['immagine'], $base);
            $piccola = !empty($_FILES['miniatura']) ? salva_immagine_caricata($_FILES['miniatura'], $base . '-min') : $grande;
            $relativo = function ($p) {
                return ltrim(substr($p, strlen(RADICE)), '/');
            };
            rispondi([
                'ok' => true,
                'immagine' => [
                    'file' => $relativo($grande['percorso']),
                    'miniatura' => $relativo($piccola['percorso']),
                    'larghezza' => $grande['larghezza'],
                    'altezza' => $grande['altezza'],
                ],
            ]);
            // no break

        case 'copie':
            richiedi_accesso();
            rispondi(['copie' => elenco_copie()]);
            // no break

        case 'ripristina':
            richiedi_accesso();
            $nome = (string) (corpo_json()['nome'] ?? '');
            $trovata = null;
            foreach (elenco_copie() as $copia) {
                if (hash_equals($copia['nome'], $nome)) {
                    $trovata = $copia['nome'];
                }
            }
            if ($trovata === null) {
                errore('Copia non trovata.', 404);
            }
            $dati = json_decode((string) file_get_contents(CARTELLA_COPIE . '/' . $trovata), true);
            if (!is_array($dati)) {
                errore('La copia è danneggiata.');
            }
            $dati = pulisci_contenuti($dati, schema());
            rispondi(['ok' => true, 'versione' => salva_contenuti($dati), 'dati' => $dati]);
            // no break

        default:
            errore('Azione sconosciuta.', 404);
    }
} catch (Throwable $e) {
    error_log('[pannello] ' . $e->getMessage());
    errore($e instanceof RuntimeException ? $e->getMessage() : 'Errore del server.', 500);
}
