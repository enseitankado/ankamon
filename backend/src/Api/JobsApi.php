<?php
/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Actions;
use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Auth;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/** Görev kuyruğu: API yalnız kuyruğa yazar; tahtalara bağlanan worker'dır. */
final class JobsApi
{
    private const COLUMNS = "j.id, j.type, j.title, j.status, j.summary, u.username AS created_by,
        extract(epoch FROM j.created_at)::bigint AS created_at,
        extract(epoch FROM j.finished_at)::bigint AS finished_at";

    public function index(Request $request, array $user): array
    {
        $jobs = Db::all(
            'SELECT ' . self::COLUMNS . ',
                    (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id) AS targets,
                    (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id AND t.status = \'ok\') AS targets_ok
             FROM jobs j LEFT JOIN users u ON u.id = j.created_by
             WHERE ?::boolean OR j.created_by = ?
             ORDER BY j.id DESC LIMIT 100',
            [(bool) $user['is_admin'], $user['id']]
        );
        return ['jobs' => $jobs];
    }

    public function show(Request $request, array $user): array
    {
        $job = Db::one(
            'SELECT ' . self::COLUMNS . ', j.params, j.created_by AS created_by_id
             FROM jobs j LEFT JOIN users u ON u.id = j.created_by WHERE j.id = ?',
            [$request->arg('id')]
        ) ?? throw ApiError::notFound();
        if (!$user['is_admin'] && $job['created_by_id'] !== $user['id']) {
            throw ApiError::forbidden();
        }
        $job['params'] = json_decode((string) $job['params'], true);
        if (is_array($job['params'])) {
            unset($job['params']['current'], $job['params']['new']); // yönetici parolası görevleri (bkz. adminPasswordJob)
        }
        if ($job['type'] === 'action' && is_array($job['params'])) {
            $job['params'] = Actions::redactParams($job['params']); // gizli değerler (parola) dışarı verilmez
        }
        unset($job['created_by_id']);
        $job['targets'] = Db::all(
            "SELECT t.board_id, COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS board, host(b.ip) AS ip,
                    t.status, t.exit_code, t.output
             FROM job_targets t JOIN boards b ON b.id = t.board_id
             WHERE t.job_id = ? ORDER BY board",
            [$job['id']]
        );
        return ['job' => $job];
    }

    /**
     * Canlı çıktı penceresi için artımlı okuma: görev durumu + tahta başına durum + `after`'dan sonraki
     * olaylar (bağlanılıyor/bağlandı/çıktı satırları/çıkış kodu — bkz. worker/ankamon/runner).
     * Pencere bunu kısa aralıkla çağırır; yalnız yeni olaylar döner.
     */
    public function events(Request $request, array $user): array
    {
        $job = Db::one(
            'SELECT j.id, j.type, j.title, j.status, j.summary, j.created_by
             FROM jobs j WHERE j.id = ?',
            [$request->arg('id')]
        ) ?? throw ApiError::notFound();
        if (!$user['is_admin'] && $job['created_by'] !== $user['id']) {
            throw ApiError::forbidden();
        }
        unset($job['created_by']);
        $after = max(0, (int) $request->query('after', '0'));
        $events = Db::all(
            'SELECT id, board_id, kind, text, (extract(epoch FROM time) * 1000)::bigint AS t
             FROM job_events WHERE job_id = ? AND id > ? ORDER BY id LIMIT 2000',
            [$job['id'], $after]
        );
        $targets = Db::all(
            "SELECT t.board_id, COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS board, host(b.ip) AS ip,
                    t.status, t.exit_code
             FROM job_targets t JOIN boards b ON b.id = t.board_id
             WHERE t.job_id = ? ORDER BY board",
            [$job['id']]
        );
        return ['job' => $job, 'targets' => $targets, 'events' => $events];
    }

    public function create(Request $request, array $user): array
    {
        $type = (string) $request->input('type', '');
        [$feature, $title, $params, $needsBoards] = match ($type) {
            'action' => $this->actionJob($request),
            'command' => $this->commandJob($request),
            'wol' => ['power', 'Uyandır (Wake-on-LAN)', [], true],
            // "screen" yetkisiyle: Ekranlar sekmesindeki önizlemelerin sağ menüsünden tetiklenir
            // (bkz. worker/ankamon/executor/whoami.py) — tahtada o an oturum açmış GERÇEK kullanıcıyı
            // SSH ile anlık sorgular (board_sessions'ın log tabanlı, bazen bayat kaydına güvenmez).
            'whoami' => ['screen', 'Oturumları sorgula', [], true],
            // "Bilgi kartı" (Tahtalar grid'i VE Ekranlar sekmesi sağ menüsü — bkz. frontend
            // ui/BoardOps.js infoCard): donanım bilgisini (disk/RAM/BIOS/çekirdek/anakart) SSH ile
            // canlı toplar, 60dk önbellek (bkz. worker/ankamon/executor/hwfacts.py). Her iki girişten
            // de erişilebildiğinden yetki denetimi aşağıda özel: 'boards' YA DA 'screen' yeterli.
            'facts' => ['boards', 'Donanım bilgisi', [], true],
            // Sağ menü "Oturum aç" (bkz. frontend ui/BoardOps.js loginMenu, worker executor/accounts.py):
            // hesap listesi (24 sa önbellek, çoklu seçimde ilk tahtadan) ve seçilen hesapla oturum açma.
            // Hesap listesi hem "Oturum aç" hem "Yedekle" alt menüsünü besler: yetki aşağıda özel.
            'accounts' => ['boards.login', 'Tahtadaki hesaplar', [], true],
            // "Sorun tespiti" sayfası (bkz. frontend page/Diagnose.js, worker executor/diagnose.py).
            'diagnose' => ['diagnose', 'Sorun tespiti', [], true],
            'login' => $this->loginJob($request),
            // Sağ menü "Oturumu kapat" / "Oturumu kilitle" (bkz. worker executor/accounts.py logout/lock):
            // seat0'daki kullanıcı oturumunu sonlandırır / LightDM ile kilitler (oturum açık kalır) —
            // oturum açmayla aynı yetki. username isteğe bağlı: Oturumlar grid'i belirli kullanıcıyı hedefler.
            'logout' => $this->sessionJob($request, 'Oturumu kapat'),
            'lock' => $this->sessionJob($request, 'Oturumu kilitle'),
            // Sağ menü Ekran ▸ "Uyandır" (bkz. worker executor/display.py): güç tasarrufuna girmiş (siyah)
            // ekranı uyandırır — kilitli oturumun kilidini açmaz; ekran izleme yetkisiyle.
            'wake' => ['screen', 'Ekranı uyandır', [], true],
            // Sağ menü Ekran ▸ "Uyut": ekranı DPMS ile kapatır (dokunulunca açılır) — Uyandır'ın eşi.
            'sleep' => ['screen', 'Ekranı uyut', [], true],
            // Sağ menü Ekran ▸ "Kilitle" / "Kilidi aç" (bkz. worker executor/screenlock.py): "Kilidi aç"a dek tahtada
            // tam ekran "Kilitli", klavye/fare/dokunmatik yakalanır; yeniden açılışta da sürer.
            'screen_lock' => ['screen.lock', 'Ekranı kilitle', [], true],
            'screen_unlock' => ['screen.lock', 'Ekran kilidini aç', [], true],
            // Sağ menü "Yedekle/Geri al" (bkz. frontend ui/homebackup, worker executor/backup.py): seçilen
            // hesapların ev dizini izin/sahiplik + hesap bilgisi + PIN anahtarıyla tar.gz; indirme HomeBackupApi'den.
            'backup_home' => $this->backupJob($request),
            // Aynı pencerenin Geri al sekmesi (bkz. worker executor/home_restore.py): yüklenen yedekten hesap.
            'restore_home' => $this->restoreJob($request),
            // "Ekranımı yansıt" (bkz. docker/rootfs/cast/, worker executor/cast.py): yayın sayfası önce
            // ekranı MediaMTX'e yollar, sonra seçili tahtalarda oynatıcıyı başlatır / durdurur.
            'cast_start' => $this->castJob($request),
            'cast_stop' => ['cast', 'Yansıtmayı durdur', [], true],
            // Yansıtma penceresindeki "Tahta ses düzeyi" kaydırıcısı: sesli yansıtma sürerken tahta çıkışının
            // düzeyi (asıl düzey cast_start'ta kaydedildi, cast_stop geri yükler — bkz. executor/cast.py).
            'cast_volume' => $this->castVolumeJob($request),
            // Sağ menü Ekran ▸ Ekran görüntüsü al (bkz. worker executor/screenshot.py).
            'screenshot' => ['screen.screenshot', 'Ekran görüntüsü al', [], true],
            // Sağ menü Ekran ▸ Klavye/Fare/Dokunmatik kilitle (bkz. worker executor/inputlock.py).
            'input_lock' => $this->inputLockJob($request),
            // Sağ menü Ekran ▸ Ekranı başka bilgisayara aktar / durdur (bkz. worker executor/relay.py).
            'relay_start' => $this->relayJob($request),
            'relay_stop' => ['screen.relay', 'Ekran aktarımını durdur', [], true],
            // Yedekle/Geri al penceresindeki hesap boyutları (bkz. worker executor/homesize.py).
            'home_sizes' => ['boards.backup', 'Ev dizini boyutları', [], true],
            // Parola ayarla ▸ Yönetici hesapları (bkz. worker executor/board_password.py): yetki aşağıda hesaba göre.
            'password_status' => ['boards.passwords', 'Yönetici parolası durumu', [], true],
            'password_verify' => $this->adminPasswordJob($request, false),
            'password_change' => $this->adminPasswordJob($request, true),
            // Sağ menü "Web sitesi aç" (bkz. worker executor/open_url.py).
            'open_url' => $this->openUrlJob($request),
            // Sağ menü "Web Filtre" (bkz. worker executor/eta_kisit_webfilter.py, frontend ui/boards/EtaKisitWebFilter.js).
            'webfilter_status' => ['boards.webfilter', 'Web Filtre durumu', [], true],
            'webfilter_apply' => $this->webFilterJob($request),
            // Anomaliler ▸ Bildirimler ▸ Deneme gönder (tahtasız; bkz. worker executor/ntfy.py).
            'ntfy_test' => ['anomalies.notify', 'ntfy deneme bildirimi', [], false],
            // Anomaliler ▸ Tarama (bkz. worker/ankamon/anomaly/scan.py): seçilen kurallar seçilen tahtalarda anlık.
            'anomaly_scan' => $this->anomalyScanJob($request),
            default => throw ApiError::badRequest('Bilinmeyen görev türü.'),
        };
        if ($type === 'facts') {
            if (!Auth::can($user, 'boards') && !Auth::can($user, 'screen')) {
                throw ApiError::forbidden();
            }
        } elseif ($type === 'accounts') {
            // Hesap listesi: Oturum aç, Yedekle/Geri al, Kullanıcı sil ve Parola ayarla pencerelerini besler.
            $any = array_filter(['boards.login', 'boards.backup', 'boards.users', 'boards.passwords'],
                static fn(string $f) => Auth::can($user, $f));
            if (!$any) {
                throw ApiError::forbidden();
            }
        } elseif (!Auth::can($user, $feature)) {
            throw ApiError::forbidden();
        }
        // Parola ayarlama: tahtanın yönetici hesapları (etapadmin, root) ayrı yetki ister — sağ menü penceresi,
        // Komut çalıştır listesi ya da doğrudan API, hangi yoldan gelirse gelsin (bkz. actions/user-password).
        if ($type === 'action' && $params['action'] === 'user-password') {
            $names = preg_split('/[\s,]+/', strtolower((string) $params['values']['KULLANICILAR']), -1, PREG_SPLIT_NO_EMPTY);
            foreach (self::ADMIN_ACCOUNTS as $account) {
                if (in_array($account, $names, true) && !Auth::can($user, "boards.passwords.$account")) {
                    throw ApiError::forbidden("$account parolasını ayarlama yetkiniz yok.");
                }
            }
        }

        if (in_array($type, ['password_verify', 'password_change'], true)
            && !Auth::can($user, 'boards.passwords.' . $params['account'])) {
            throw ApiError::forbidden($params['account'] . ' parolasını ayarlama yetkiniz yok.');
        }

        $boardIds = array_values(array_unique(array_map('intval', (array) $request->input('board_ids', []))));
        // Sorun tespiti sayfasının "Şimdi tara"sı tahta seçmez: o an çevrimiçi TÜM tahtalar.
        if ($type === 'diagnose' && !$boardIds && $request->input('all_online')) {
            $boardIds = array_map('intval', array_column(
                Db::all('SELECT id FROM boards WHERE online AND ip IS NOT NULL'), 'id'));
            if (!$boardIds) {
                throw ApiError::badRequest('Şu an çevrimiçi tahta yok; denetim için tahtaların açık olması gerekir.');
            }
        }
        if ($needsBoards && !$boardIds) {
            throw ApiError::badRequest('En az bir tahta seçin.');
        }
        if (in_array($type, ['password_verify', 'password_change'], true) && count($boardIds) !== 1) {
            throw ApiError::badRequest('Yönetici parolası tahta başına ayrı ayarlanır: tek tahta seçin.');
        }
        if ($type === 'relay_start') {
            // Kaynak tahta hedef olamaz: kendi ekranını kendine aktarmak anlamsız (görüntü döngüye girer).
            $boardIds = array_values(array_diff($boardIds, [$params['source_board_id']]));
            if (!$boardIds) {
                throw ApiError::badRequest('Kaynak tahtadan başka en az bir hedef tahta seçin.');
            }
        }

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        $jobId = Db::value(
            'INSERT INTO jobs (type, title, params, created_by) VALUES (?, ?, ?::jsonb, ?) RETURNING id',
            [$type, $title, json_encode($params ?: new \stdClass(), JSON_UNESCAPED_UNICODE), $user['id']]
        );
        if ($needsBoards) {
            $added = Db::exec(
                'INSERT INTO job_targets (job_id, board_id) SELECT ?, id FROM boards WHERE id = ANY(?::int[])',
                [$jobId, '{' . implode(',', $boardIds) . '}']
            );
            if ($added === 0) {
                $pdo->rollBack();
                throw ApiError::badRequest('Seçilen tahtalar bulunamadı.');
            }
        }
        Db::exec("SELECT pg_notify('ankamon_jobs', ?)", [(string) $jobId]);
        $pdo->commit();

        $logged = $type === 'action' ? Actions::redactParams($params) : $params; // parola denetim kaydına yazılmaz
        unset($logged['current'], $logged['new']);                               // (yönetici parolası görevleri)
        Audit::log($user, $request, 'job.create', $title, ['job_id' => $jobId, 'boards' => $boardIds] + $logged);
        return ['id' => $jobId];
    }

    /** "Kullanıcı sil" ile asla silinmeyen tahta hesapları (bkz. actionJob, actions/user-delete/run.sh). */
    private const UNDELETABLE_USERS = ['etapadmin', 'root'];

    /** Parolası ayrı yetkiyle ("boards.passwords.<hesap>") ayarlanabilen tahta hesapları (bkz. create). */
    private const ADMIN_ACCOUNTS = ['etapadmin', 'root'];

    private function actionJob(Request $request): array
    {
        $action = Actions::all()[(string) $request->input('action', '')]
            ?? throw ApiError::badRequest('Bilinmeyen işlem.');
        $values = Actions::values($action, (array) $request->input('values', []));
        if ($action['id'] === 'user-delete') {
            // Barikat: tahtanın yönetici hesabı (ve root) hiçbir yoldan (sağ menü, Komut çalıştır listesi,
            // doğrudan API) silinemez — tahtada actions/user-delete/run.sh de aynı listeyi ayrıca reddeder.
            $names = preg_split('/[\s,]+/', strtolower((string) ($values['KULLANICILAR'] ?? '')), -1, PREG_SPLIT_NO_EMPTY);
            $blocked = array_values(array_intersect($names, self::UNDELETABLE_USERS));
            if ($blocked) {
                throw ApiError::badRequest(implode(', ', $blocked) . ' hesabı silinemez (tahta yönetimi için korunur).');
            }
        }
        return [$action['feature'], $action['title'], ['action' => $action['id'], 'values' => $values], true];
    }

    private function commandJob(Request $request): array
    {
        $command = trim((string) $request->input('command', ''));
        if ($command === '' || strlen($command) > 4000) {
            throw ApiError::badRequest('Komut boş ya da çok uzun.');
        }
        return ['shell', mb_strimwidth($command, 0, 80, '…'), ['command' => $command], true];
    }

    /** Kullanıcı adı tahtada betiğe gömülür: worker'daki accounts.USERNAME_RE ile AYNI kural. */
    private function loginJob(Request $request): array
    {
        $username = (string) $request->input('username', '');
        if (!preg_match('/^[a-z_][a-z0-9_.-]{0,31}$/', $username)) {
            throw ApiError::badRequest('Geçersiz kullanıcı adı.');
        }
        return ['boards.login', "Oturum aç: $username", ['username' => $username], true];
    }

    /** logout/lock: kullanıcı adı boş (= tahtadaki etkin oturum) ya da loginJob ile AYNI kurala uyan bir ad. */
    private function sessionJob(Request $request, string $title): array
    {
        $username = (string) $request->input('username', '');
        if ($username === '') {
            return ['boards.login', $title, [], true];
        }
        if (!preg_match('/^[a-z_][a-z0-9_.-]{0,31}$/', $username)) {
            throw ApiError::badRequest('Geçersiz kullanıcı adı.');
        }
        return ['boards.login', "$title: $username", ['username' => $username], true];
    }

    /** Yayın adı tahtadaki RTSP adresine girer: worker executor/cast.STREAM_RE ve MediaMTX okuma kuralıyla AYNI. */
    private function castJob(Request $request): array
    {
        $stream = (string) $request->input('stream', '');
        if (!preg_match('/^c-[A-Za-z0-9]{24,64}$/', $stream)) {
            throw ApiError::badRequest('Geçersiz yayın adı.');
        }
        $audio = (bool) $request->input('audio', false);
        // Sesli yansıtmada tahta çıkışının geçici düzeyi (0-100); boş/null = tahtanın düzeyine dokunma.
        $volume = $request->input('volume');
        $volume = $audio && $volume !== null && $volume !== '' ? max(0, min(100, (int) $volume)) : null;
        $title = 'Ekranı yansıt' . ($audio ? ' (sesli' . ($volume !== null ? ", ses %$volume" : '') . ')' : '');
        return ['cast', $title, ['stream' => $stream, 'audio' => $audio, 'volume' => $volume], true];
    }

    private function castVolumeJob(Request $request): array
    {
        $volume = $request->input('volume');
        if (!is_numeric($volume)) {
            throw ApiError::badRequest('Ses düzeyi verilmedi.');
        }
        $volume = max(0, min(100, (int) $volume));
        return ['cast', "Yansıtma ses düzeyi: %$volume", ['volume' => $volume], true];
    }

    /** Adres betiğe gömülür: worker open_url.URL_RE ile AYNI kural. */
    private function openUrlJob(Request $request): array
    {
        $url = trim((string) $request->input('url', ''));
        if (!preg_match('~^https?://[^\s"\'`<>\\\\]{1,2000}$~', $url)) {
            throw ApiError::badRequest('Adres http:// ya da https:// ile başlamalı, boşluk ve tırnak içermemeli.');
        }
        return ['screen.web', 'Web sitesi aç: ' . mb_strimwidth($url, 0, 80, '…'), ['url' => $url], true];
    }

    /** Alan adları tahtaya gider: worker eta_kisit_webfilter.DOMAIN_RE ile AYNI kural. Verilmeyen liste tahtada korunur. */
    private function webFilterJob(Request $request): array
    {
        $mode = (string) $request->input('mode', '');
        $labels = ['off' => 'Kapat', 'denylist' => 'Kara liste', 'allowlist' => 'Beyaz liste'];
        if (!isset($labels[$mode])) {
            throw ApiError::badRequest('Geçersiz filtre modu.');
        }
        $params = ['mode' => $mode, 'denylist' => null, 'allowlist' => null];
        foreach (['denylist', 'allowlist'] as $key) {
            $list = $request->input($key);
            if ($list === null) {
                continue;
            }
            if (!is_array($list)) {
                throw ApiError::badRequest('Geçersiz adres listesi.');
            }
            $clean = [];
            foreach ($list as $domain) {
                $domain = is_string($domain) ? strtolower(trim($domain)) : '';
                if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/D', $domain)) {
                    throw ApiError::badRequest('Geçersiz alan adı: ' . mb_strimwidth($domain, 0, 80, '…'));
                }
                $clean[$domain] = true;
            }
            if (count($clean) > 500) {
                throw ApiError::badRequest('Listede en çok 500 adres olabilir.');
            }
            $params[$key] = array_keys($clean);
        }
        if ($mode !== 'off' && !$params[$mode]) {
            throw ApiError::badRequest('Adres listesi boş.');
        }
        $title = 'Web Filtre: ' . $labels[$mode] . ($mode === 'off' ? '' : ' (' . count($params[$mode]) . ' adres)');
        return ['boards.webfilter', $title, $params, true];
    }

    /** Klavye/fare/dokunmatik kilidi: aygıt ve yön (bkz. worker executor/inputlock.py). */
    private function inputLockJob(Request $request): array
    {
        $device = (string) $request->input('device', '');
        $names = ['keyboard' => 'Klavye', 'mouse' => 'Fare', 'touch' => 'Dokunmatik'];
        if (!isset($names[$device])) {
            throw ApiError::badRequest('Geçersiz aygıt.');
        }
        $lock = (bool) $request->input('lock', true);
        return ['screen.input', $names[$device] . ($lock ? ' kilitle' : ' kilidini aç'), ['device' => $device, 'lock' => $lock], true];
    }

    /** Ekran aktarımı: görev hedefleri gösterecek tahtalar; yayın adı burada üretilir (MediaMTX okuma/yazma kuralı r-…). */
    private function relayJob(Request $request): array
    {
        $source = (int) $request->input('source_board_id', 0);
        $board = Db::one("SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name, online FROM boards WHERE id = ?", [$source])
            ?? throw ApiError::badRequest('Kaynak tahta bulunamadı.');
        if (!$board['online']) {
            throw ApiError::badRequest('Kaynak tahta çevrimdışı.');
        }
        return ['screen.relay', 'Ekranı aktar: ' . $board['name'],
            ['source_board_id' => $source, 'stream' => 'r-' . bin2hex(random_bytes(16))], true];
    }

    /**
     * Tahtaya özel yönetici parolası: doğrulama ya da değiştirme. Parolalar görev parametresinde yalnız görev bitene
     * dek durur (runner siler), denetim kaydına ve görev okumasına girmez.
     */
    private function adminPasswordJob(Request $request, bool $change): array
    {
        $account = (string) $request->input('account', '');
        if (!in_array($account, self::ADMIN_ACCOUNTS, true)) {
            throw ApiError::badRequest('Geçersiz hesap.');
        }
        $current = (string) $request->input('current', '');
        $new = (string) $request->input('new', '');
        foreach ([$current, $new] as $value) {
            if (strlen($value) > 128 || preg_match('/[\x00-\x1f\x7f]/', $value)) {
                throw ApiError::badRequest('Parola en çok 128 karakter olabilir ve denetim karakteri içeremez.');
            }
        }
        if ($change) {
            if ($new === '' || $new !== trim($new)) {
                throw ApiError::badRequest('Yeni parola boş olamaz, boşlukla başlayıp bitemez.');
            }
            return ['boards.passwords', "Yönetici parolasını değiştir: $account", ['account' => $account, 'current' => $current, 'new' => $new], true];
        }
        if ($current === '') {
            throw ApiError::badRequest('Mevcut parolayı girin.');
        }
        return ['boards.passwords', "Mevcut parolayı doğrula: $account", ['account' => $account, 'current' => $current], true];
    }

    /** Taranacak anomali türleri: yalnız anlık taranabilenler (AnomaliesApi::scannable). */
    private function anomalyScanJob(Request $request): array
    {
        $known = AnomaliesApi::scannable();
        $kinds = array_values(array_intersect(array_keys($known),
            array_map('strval', (array) $request->input('kinds', []))));
        if (!$kinds) {
            throw ApiError::badRequest('En az bir anomali türü seçin.');
        }
        $labels = implode(', ', array_map(static fn(string $k) => $known[$k]['label'], $kinds));
        return ['anomalies', "Anomali taraması: $labels", ['kinds' => $kinds], true];
    }

    /** Kullanıcı adı tahtada betiğe gömülür: loginJob ve worker accounts.USERNAME_RE ile AYNI kural. */
    private function backupJob(Request $request): array
    {
        $usernames = $request->input('usernames', []);
        if (!is_array($usernames) || !$usernames || count($usernames) > 200) {
            throw ApiError::badRequest('Yedeklenecek hesap seçilmedi.');
        }
        foreach ($usernames as $username) {
            if (!is_string($username) || !preg_match('/^[a-z_][a-z0-9_.-]{0,31}$/', $username)) {
                throw ApiError::badRequest('Geçersiz kullanıcı adı.');
            }
        }
        $usernames = array_values(array_unique($usernames));
        $shown = implode(', ', array_slice($usernames, 0, 5)) . (count($usernames) > 5 ? ' …' : '');
        return ['boards.backup', "Yedekle: $shown ev dizini", ['usernames' => $usernames], true];
    }

    /** Dosyanın içeriği (hesap, güvenlik denetimleri) worker'da doğrulanır (bkz. executor/home_restore.py). */
    private function restoreJob(Request $request): array
    {
        $token = (string) $request->input('token', '');
        if (!preg_match('/^[0-9a-f]{32}$/', $token)) {
            throw ApiError::badRequest('Geçersiz yedek dosyası.');
        }
        $username = (string) $request->input('username', '');
        if (!preg_match('/^[a-z_][a-z0-9_.-]{0,31}$/', $username)) {
            throw ApiError::badRequest('Geçersiz kullanıcı adı.');
        }
        return ['boards.restore', "Geri al: $username", ['token' => $token, 'overwrite' => (bool) $request->input('overwrite', false)], true];
    }
}
