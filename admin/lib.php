<?php
// Funzioni comuni del pannello di gestione. Compatibile con PHP 7.4 e successivi.

define('RADICE', dirname(__DIR__));
define('PRIVATO', __DIR__ . '/privato');
define('FILE_CONTENUTI', RADICE . '/contenuti/sito.json');
define('CARTELLA_COPIE', RADICE . '/contenuti/backup');
define('CARTELLA_CARICATE', RADICE . '/immagini/caricate');
define('FILE_SCHEMA', __DIR__ . '/schema.json');
define('COPIE_DA_TENERE', 30);
define('DURATA_SESSIONE', 8 * 3600);
define('TENTATIVI_MAX', 8);
define('BLOCCO_SECONDI', 15 * 60);
define('LUNGHEZZA_MIN_PASSWORD', 10);

// ------------------------------------------------------------ risposte

function rispondi($dati, int $codice = 200): void
{
    http_response_code($codice);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($dati, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function errore(string $messaggio, int $codice = 400): void
{
    rispondi(['errore' => $messaggio], $codice);
}

function corpo_json(): array
{
    $dati = json_decode((string) file_get_contents('php://input'), true);
    return is_array($dati) ? $dati : [];
}

// ------------------------------------------------------------ file

// Scrive un file in modo atomico: prima una copia temporanea, poi la sostituzione.
function scrivi_file(string $percorso, string $contenuto): void
{
    $cartella = dirname($percorso);
    if (!is_dir($cartella) && !mkdir($cartella, 0755, true)) {
        throw new RuntimeException("Impossibile creare la cartella $cartella");
    }
    $temporaneo = $cartella . '/.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($temporaneo, $contenuto, LOCK_EX) === false) {
        throw new RuntimeException("Impossibile scrivere in $cartella");
    }
    if (!rename($temporaneo, $percorso)) {
        @unlink($temporaneo);
        throw new RuntimeException("Impossibile aggiornare $percorso");
    }
}

// I dati privati sono file .php che iniziano con «exit»: anche se qualcuno li apre dal browser non vede nulla.
function leggi_privato(string $nome)
{
    $file = PRIVATO . "/$nome.php";
    if (!is_file($file)) {
        return null;
    }
    $testo = (string) file_get_contents($file);
    $testo = preg_replace('/^<\?php exit; \?>\R/', '', $testo);
    return json_decode($testo, true);
}

function scrivi_privato(string $nome, $dati): void
{
    scrivi_file(PRIVATO . "/$nome.php", "<?php exit; ?>\n" . json_encode($dati, JSON_UNESCAPED_SLASHES));
}

// ------------------------------------------------------------ sessione e accesso

function connessione_sicura(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
}

function avvia_sessione(): void
{
    $percorso = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/admin/api.php')), '/') . '/';
    session_name('pannello_sito');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $percorso,
        'secure' => connessione_sicura(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function configurato(): bool
{
    $accesso = leggi_privato('accesso');
    return is_array($accesso) && !empty($accesso['hash']);
}

function autenticato(): bool
{
    if (empty($_SESSION['dentro']) || ($_SESSION['scade'] ?? 0) < time()) {
        return false;
    }
    $_SESSION['scade'] = time() + DURATA_SESSIONE;
    return true;
}

function richiedi_accesso(): void
{
    if (!autenticato()) {
        errore('Sessione scaduta: accedi di nuovo.', 401);
    }
}

function controlla_csrf(): void
{
    $inviato = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($inviato) || !hash_equals($_SESSION['csrf'] ?? '', $inviato)) {
        errore('Richiesta non valida: ricarica la pagina.', 403);
    }
}

function entra(): void
{
    session_regenerate_id(true);
    $_SESSION['dentro'] = true;
    $_SESSION['scade'] = time() + DURATA_SESSIONE;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

// Limite ai tentativi sbagliati, per indirizzo IP (salvato solo come impronta).
function chiave_ip(): string
{
    return substr(hash('sha256', 'pannello|' . ($_SERVER['REMOTE_ADDR'] ?? '?')), 0, 24);
}

function secondi_di_blocco(): int
{
    $tentativi = leggi_privato('tentativi') ?: [];
    $voce = $tentativi[chiave_ip()] ?? null;
    if (!$voce || ($voce['fino'] ?? 0) <= time()) {
        return 0;
    }
    return (int) $voce['fino'] - time();
}

function registra_tentativo(bool $riuscito): void
{
    $tentativi = leggi_privato('tentativi') ?: [];
    $adesso = time();
    foreach ($tentativi as $k => $v) {
        if (($v['ultimo'] ?? 0) < $adesso - 86400) {
            unset($tentativi[$k]);
        }
    }
    $k = chiave_ip();
    if ($riuscito) {
        unset($tentativi[$k]);
    } else {
        $voce = $tentativi[$k] ?? ['n' => 0, 'fino' => 0];
        if (($voce['ultimo'] ?? 0) < $adesso - BLOCCO_SECONDI) {
            $voce['n'] = 0;
        }
        $voce['n']++;
        $voce['ultimo'] = $adesso;
        if ($voce['n'] >= TENTATIVI_MAX) {
            $voce['fino'] = $adesso + BLOCCO_SECONDI;
            $voce['n'] = 0;
        }
        $tentativi[$k] = $voce;
    }
    scrivi_privato('tentativi', $tentativi);
}

// ------------------------------------------------------------ contenuti

function schema(): array
{
    $schema = json_decode((string) file_get_contents(FILE_SCHEMA), true);
    if (!is_array($schema) || empty($schema['sezioni'])) {
        throw new RuntimeException('Schema dei contenuti non leggibile');
    }
    return $schema;
}

function leggi_contenuti(): array
{
    $dati = is_file(FILE_CONTENUTI) ? json_decode((string) file_get_contents(FILE_CONTENUTI), true) : null;
    return is_array($dati) ? $dati : [];
}

function versione_contenuti(): string
{
    return is_file(FILE_CONTENUTI) ? sha1_file(FILE_CONTENUTI) : '';
}

function salva_contenuti(array $dati): string
{
    if (is_file(FILE_CONTENUTI)) {
        crea_copia();
    }
    $json = json_encode($dati, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('Contenuti non validi');
    }
    scrivi_file(FILE_CONTENUTI, $json . "\n");
    clearstatcache();
    return versione_contenuti();
}

function crea_copia(): void
{
    if (!is_dir(CARTELLA_COPIE)) {
        mkdir(CARTELLA_COPIE, 0755, true);
    }
    $nome = 'sito-' . date('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.json';
    copy(FILE_CONTENUTI, CARTELLA_COPIE . '/' . $nome);
    $copie = elenco_copie();
    foreach (array_slice($copie, COPIE_DA_TENERE) as $vecchia) {
        @unlink(CARTELLA_COPIE . '/' . $vecchia['nome']);
    }
}

function elenco_copie(): array
{
    $file = glob(CARTELLA_COPIE . '/sito-*.json') ?: [];
    rsort($file);
    $copie = [];
    foreach ($file as $f) {
        $nome = basename($f);
        if (!preg_match('/^sito-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(-[a-f0-9]+)?\.json$/', $nome, $m)) {
            continue;
        }
        $copie[] = [
            'nome' => $nome,
            'quando' => "$m[3]/$m[2]/$m[1] $m[4]:$m[5]",
            'byte' => filesize($f),
        ];
    }
    return $copie;
}

// ------------------------------------------------------------ pulizia dei dati secondo lo schema

function testo_pulito($v, int $max, bool $piuRighe): string
{
    if (!is_string($v)) {
        $v = is_scalar($v) ? (string) $v : '';
    }
    if (!mb_check_encoding($v, 'UTF-8')) {
        $v = mb_convert_encoding($v, 'UTF-8', 'UTF-8');
    }
    $v = str_replace(["\r\n", "\r"], "\n", $v);
    // via i caratteri di controllo invisibili (a capo e tabulazioni restano nei testi lunghi)
    $v = $piuRighe
        ? preg_replace('/[^\P{Cc}\n\t]/u', '', $v)
        : preg_replace('/\p{Cc}+/u', ' ', $v);
    $v = trim((string) $v);
    return mb_substr($v, 0, $max);
}

function immagine_pulita($v): ?array
{
    if (is_string($v)) {
        $v = ['file' => $v, 'miniatura' => $v];
    }
    if (!is_array($v)) {
        return null;
    }
    $percorsoValido = function ($p) {
        return is_string($p)
            && preg_match('#^immagini/[A-Za-z0-9_\-/.]+\.(jpe?g|png|webp|gif)$#i', $p)
            && strpos($p, '..') === false;
    };
    if (!$percorsoValido($v['file'] ?? null)) {
        return null;
    }
    $immagine = ['file' => $v['file'], 'miniatura' => $percorsoValido($v['miniatura'] ?? null) ? $v['miniatura'] : $v['file']];
    foreach (['larghezza', 'altezza'] as $k) {
        if (isset($v[$k]) && is_numeric($v[$k]) && (int) $v[$k] > 0 && (int) $v[$k] < 20000) {
            $immagine[$k] = (int) $v[$k];
        }
    }
    return $immagine;
}

function campo_pulito(array $campo, $valore)
{
    $max = (int) ($campo['max'] ?? 1000);
    switch ($campo['tipo']) {
        case 'testo':
            return testo_pulito($valore, $max, false);
        case 'testo_lungo':
            return testo_pulito($valore, $max, true);
        case 'email':
            $v = testo_pulito($valore, 254, false);
            return ($v === '' || filter_var($v, FILTER_VALIDATE_EMAIL)) ? $v : '';
        case 'link':
            $v = testo_pulito($valore, 2000, false);
            return preg_match('#^https?://[^\s<>"]+$#i', $v) ? $v : '';
        case 'si_no':
            return (bool) $valore;
        case 'scelta':
            $opzioni = $campo['opzioni'] ?? [];
            return in_array($valore, $opzioni, true) ? $valore : ($opzioni[0] ?? '');
        case 'immagine':
            return immagine_pulita($valore);
    }
    return null;
}

function slug(string $testo): string
{
    $t = function_exists('iconv') ? (string) @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $testo) : $testo;
    $t = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $t));
    return trim(substr($t, 0, 48), '-');
}

function pulisci_contenuti(array $dati, array $schema): array
{
    $pulito = [];
    foreach ($schema['sezioni'] as $sezione) {
        $chiave = $sezione['chiave'];
        $origine = isset($dati[$chiave]) && is_array($dati[$chiave]) ? $dati[$chiave] : [];
        if ($sezione['tipo'] === 'oggetto') {
            $oggetto = [];
            foreach ($sezione['campi'] as $campo) {
                $oggetto[$campo['chiave']] = campo_pulito($campo, $origine[$campo['chiave']] ?? null);
            }
            $pulito[$chiave] = $oggetto;
            continue;
        }
        $elenco = [];
        $visti = [];
        foreach (array_slice(array_values($origine), 0, 1000) as $voce) {
            if (!is_array($voce)) {
                continue;
            }
            $elemento = [];
            $id = isset($voce['id']) && is_string($voce['id']) && preg_match('/^[a-z0-9-]{1,80}$/', $voce['id']) ? $voce['id'] : '';
            if ($id === '' || isset($visti[$id])) {
                $base = slug((string) ($voce[$sezione['campo_titolo'] ?? 'titolo'] ?? '')) ?: $sezione['elemento'];
                $id = $base . '-' . bin2hex(random_bytes(3));
            }
            $visti[$id] = true;
            $elemento['id'] = $id;
            foreach ($sezione['campi'] as $campo) {
                $elemento[$campo['chiave']] = campo_pulito($campo, $voce[$campo['chiave']] ?? null);
            }
            $elenco[] = $elemento;
        }
        $pulito[$chiave] = $elenco;
    }
    return $pulito;
}

// ------------------------------------------------------------ caricamento immagini

function byte_da_ini(string $valore): int
{
    $valore = trim($valore);
    if ($valore === '') {
        return 0;
    }
    $numero = (float) $valore;
    switch (strtolower(substr($valore, -1))) {
        case 'g': $numero *= 1024;
        // no break
        case 'm': $numero *= 1024;
        // no break
        case 'k': $numero *= 1024;
    }
    return (int) $numero;
}

// Dimensione massima di ogni file inviato, compatibile con i limiti del server.
function limite_caricamento(): int
{
    $file = byte_da_ini((string) ini_get('upload_max_filesize')) ?: 2 * 1024 * 1024;
    $richiesta = byte_da_ini((string) ini_get('post_max_size')) ?: 8 * 1024 * 1024;
    return (int) min($file, $richiesta / 2.3, 12 * 1024 * 1024);
}

// Salva la foto caricata in $base + estensione corretta e ne restituisce percorso e misure.
function salva_immagine_caricata(array $file, string $base): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        $codice = $file['error'] ?? -1;
        throw new RuntimeException($codice === UPLOAD_ERR_INI_SIZE || $codice === UPLOAD_ERR_FORM_SIZE
            ? 'La foto è troppo grande per il server.'
            : 'Caricamento non riuscito, riprova.');
    }
    $info = @getimagesize($file['tmp_name']);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
        throw new RuntimeException('Il file non è una foto JPEG, PNG o WebP.');
    }
    if ($info[0] > 8000 || $info[1] > 8000) {
        throw new RuntimeException('Foto troppo grande (massimo 8000 pixel per lato).');
    }
    $estensioni = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
    $destinazione = $base . '.' . $estensioni[$info[2]];
    if (!is_dir(dirname($destinazione))) {
        mkdir(dirname($destinazione), 0755, true);
    }
    if (!move_uploaded_file($file['tmp_name'], $destinazione)) {
        throw new RuntimeException('Impossibile salvare la foto sul server.');
    }
    @chmod($destinazione, 0644);
    return ['percorso' => $destinazione, 'larghezza' => (int) $info[0], 'altezza' => (int) $info[1]];
}
