<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Actions;
use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Auth;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

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
     * olaylar (bağlanılıyor/bağlandı/çıktı satırları/çıkış kodu — bkz. worker/tihamon/runner).
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
            // (bkz. worker/tihamon/executor/whoami.py) — tahtada o an oturum açmış GERÇEK kullanıcıyı
            // SSH ile anlık sorgular (board_sessions'ın log tabanlı, bazen bayat kaydına güvenmez).
            'whoami' => ['screen', 'Oturumları sorgula', [], true],
            // "Bilgi kartı" (Tahtalar grid'i VE Ekranlar sekmesi sağ menüsü — bkz. frontend
            // ui/BoardOps.js infoCard): donanım bilgisini (disk/RAM/BIOS/çekirdek/anakart) SSH ile
            // canlı toplar, 60dk önbellek (bkz. worker/tihamon/executor/hwfacts.py). Her iki girişten
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
            // Sağ menü "Yedekle" (bkz. frontend ui/BoardOps.js, worker executor/backup.py): seçilen
            // hesabın ev dizini izin/sahiplik bilgisiyle tar.gz; indirme HomeBackupApi'den.
            'backup_home' => $this->backupJob($request),
            // "Ekranımı yansıt" (bkz. docker/rootfs/cast/, worker executor/cast.py): yayın sayfası önce
            // ekranı MediaMTX'e yollar, sonra seçili tahtalarda oynatıcıyı başlatır / durdurur.
            'cast_start' => $this->castJob($request),
            'cast_stop' => ['cast', 'Yansıtmayı durdur', [], true],
            // Yansıtma penceresindeki "Tahta ses düzeyi" kaydırıcısı: sesli yansıtma sürerken tahta çıkışının
            // düzeyi (asıl düzey cast_start'ta kaydedildi, cast_stop geri yükler — bkz. executor/cast.py).
            'cast_volume' => $this->castVolumeJob($request),
            default => throw ApiError::badRequest('Bilinmeyen görev türü.'),
        };
        if ($type === 'facts') {
            if (!Auth::can($user, 'boards') && !Auth::can($user, 'screen')) {
                throw ApiError::forbidden();
            }
        } elseif ($type === 'accounts') {
            if (!Auth::can($user, 'boards.login') && !Auth::can($user, 'boards.backup')) {
                throw ApiError::forbidden();
            }
        } elseif (!Auth::can($user, $feature)) {
            throw ApiError::forbidden();
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
        Db::exec("SELECT pg_notify('tihamon_jobs', ?)", [(string) $jobId]);
        $pdo->commit();

        $logged = $type === 'action' ? Actions::redactParams($params) : $params; // parola denetim kaydına yazılmaz
        Audit::log($user, $request, 'job.create', $title, ['job_id' => $jobId, 'boards' => $boardIds] + $logged);
        return ['id' => $jobId];
    }

    /** "Kullanıcı sil" ile asla silinmeyen tahta hesapları (bkz. actionJob, actions/user-delete/run.sh). */
    private const UNDELETABLE_USERS = ['etapadmin', 'root'];

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

    /** Kullanıcı adı tahtada betiğe gömülür: loginJob ve worker accounts.USERNAME_RE ile AYNI kural. */
    private function backupJob(Request $request): array
    {
        $username = (string) $request->input('username', '');
        if (!preg_match('/^[a-z_][a-z0-9_.-]{0,31}$/', $username)) {
            throw ApiError::badRequest('Geçersiz kullanıcı adı.');
        }
        return ['boards.backup', "Yedekle: $username ev dizini", ['username' => $username], true];
    }
}
