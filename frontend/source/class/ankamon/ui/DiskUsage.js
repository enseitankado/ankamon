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

/**
 * "Disk kullanımı" sayfasının (bkz. page.DiskUsage — Sistem altında, 'logs.manage' yetkisiyle)
 * veri sekmeleri: log türleri (sistem, komut), rsyslog log kuyruğu, sensör
 * verileri, görev kuyruğu, bakım raporları ve yedekler (/data/backups).
 * Her sekme bir ui.DiskUsageTab'dır; burada yalnız türlere özgü sütunlar, yükleme ve silme istekleri
 * tanımlanır (backend: LogStatsApi, LogQueueStatsApi, MetricStatsApi, JobStatsApi, BackupStatsApi).
 */
qx.Class.define("ankamon.ui.DiskUsage", {
  type: "static",

  statics: {
    JOB_STATUS: { queued: "Kuyrukta", running: "Çalışıyor", done: "Tamamlandı", failed: "Hatalı" },
    BACKUP_KIND: { full: "Tam (loglar + sensör dahil)", config: "Yapılandırma", grafana: "Grafana" },
    BACKUP_GROUP: { full: "tam yedekler", config: "yapılandırma yedekleri", grafana: "Grafana yedekleri" },

    /**
     * Sekme tanımları, sayfadaki sırasıyla (bkz. page.DiskUsage). Her tanımın `mode`'u sekmenin
     * anahtarıdır (Shell OPEN_PAGE {diskUsage: mode}, Genel bakış kartları, Özet dilimleri) ve
     * `size()`'ı Özet sekmesi için o veri türünün diskteki toplam boyutunu döner.
     */
    specs() {
      return [
        this.__logSpec("system", "Sistem logları", "sistem log kaydı"),
        this.__logSpec("command", "Komut logları", "komut log kaydı"),
        this.__logQueueSpec(),
        this.__metricSpec(),
        this.__jobSpec(),
        this.__diagnoseSpec(),
        this.__backupSpec()
      ];
    },

    /** size(): uç noktanın "total.bytes" alanı + /data disk bilgisi (yükleme yapılmadan, Özet için). */
    __sizer(url, params) {
      return async () => {
        const data = await ankamon.io.Api.get(url, params);
        return { bytes: Number(data.total && data.total.bytes) || 0, disk: data.disk || null };
      };
    },

    /** Sekmenin son yüklemesindeki disk bilgisini saklayan ortak durum satırı. */
    __info(spec, data, text) {
      spec.disk = data.disk;
      const F = ankamon.util.Format;
      const disk = data.disk && data.disk.total != null && data.disk.free != null
        ? ` · Disk (/data): toplam ${F.bytes(data.disk.total)}, boş ${F.bytes(data.disk.free)}`
        : "";
      return text + disk;
    },

    __withDisk(spec) {
      spec.lastDisk = () => spec.disk;
      return spec;
    },

    __scopeColumns(countLabel) {
      return [
        { id: "name", label: "Tahta" },
        { id: "n", label: countLabel, width: 120 },
        { id: "first", label: "İlk kayıt", width: 160 },
        { id: "last", label: "Son kayıt", width: 160 },
        { id: "size", label: "Tahmini boyut (~)", width: 140 }
      ];
    },

    __size(bytes, estimated) {
      return (estimated ? "~" : "") + ankamon.util.Format.bytes(bytes);
    },

    /** Sistem / komut logları: tahta başına (+ eşleşmeyen + tümü), /api/logs/stats. */
    __logSpec(type, label, noun) {
      const F = ankamon.util.Format;
      const spec = this.__withDisk({
        mode: type, label, noun, size: this.__sizer("/logs/stats", { type }),
        columns: this.__scopeColumns("Kayıt sayısı"),
        load: async () => {
          const data = await ankamon.io.Api.get("/logs/stats", { type });
          const rows = [{
            all: true, scope: {}, name: "— Tüm tahtalar —",
            n: data.total.n, first: data.total.first, last: data.total.last, bytes: data.total.bytes, estimated: false
          }];
          if (data.unmatched) {
            rows.push({ scope: { board: "unmatched" }, name: "— Tahtasız / eşleşmeyen —", ...data.unmatched, bytes: data.unmatched.est_bytes, estimated: true });
          }
          data.boards.forEach(b => rows.push({ scope: { board: b.board_id }, ...b, bytes: b.est_bytes, estimated: true }));
          rows.forEach(r => {
            r.deletable = true;
            r.cells = [r.name, r.n, F.dateTime(r.first), F.dateTime(r.last), this.__size(r.bytes, r.estimated)];
          });
          return { rows, info: this.__info(spec, data, `${data.total.n} kayıt, ${F.bytes(data.total.bytes)}`) };
        },
        remove: async row => {
          const search = new URLSearchParams({ type, ...row.scope });
          return (await ankamon.io.Api.del("/logs?" + search.toString())).deleted;
        }
      });
      return spec;
    },

    /** Sensör verileri: tahta başına ham ölçüm + 5 dk/1 sa özetleri, /api/storage/metrics. */
    __metricSpec() {
      const F = ankamon.util.Format;
      const spec = this.__withDisk({
        mode: "metrics", size: this.__sizer("/storage/metrics"), label: "Sensör verileri", noun: "sensör ölçümü (ham + özet)",
        columns: [
          { id: "name", label: "Tahta" },
          { id: "series", label: "Seri", width: 70 },
          { id: "n", label: "Ham ölçüm", width: 110 },
          { id: "agg", label: "Özet (5 dk/1 sa)", width: 130 },
          { id: "first", label: "İlk ölçüm", width: 160 },
          { id: "last", label: "Son ölçüm", width: 160 },
          { id: "size", label: "Tahmini boyut (~)", width: 140 }
        ],
        load: async () => {
          const data = await ankamon.io.Api.get("/storage/metrics");
          const rows = [{ all: true, scope: {}, ...data.total, name: "— Tüm tahtalar —", bytes: data.total.bytes, estimated: false }];
          if (data.unmatched) {
            rows.push({ scope: { board: "unmatched" }, ...data.unmatched, name: "— Tahtasız / eşleşmeyen —", bytes: data.unmatched.est_bytes, estimated: true });
          }
          data.boards.forEach(b => rows.push({ scope: { board: b.board_id }, ...b, bytes: b.est_bytes, estimated: true }));
          rows.forEach(r => {
            r.records = r.n;
            r.n = r.records + r.agg; // onay metni ve silinebilirlik için toplam satır
            r.deletable = true;
            r.cells = [r.name, r.series, r.records, r.agg, F.dateTime(r.first), F.dateTime(r.last), this.__size(r.bytes, r.estimated)];
          });
          return {
            rows,
            info: this.__info(spec, data, `${data.total.n} ham ölçüm + ${data.total.agg} özet, ${F.bytes(data.total.bytes)}`)
          };
        },
        remove: async row => {
          const search = new URLSearchParams(row.scope);
          return (await ankamon.io.Api.del("/storage/metrics?" + search.toString())).deleted;
        }
      });
      return spec;
    },

    /** Görev kuyruğu: görev başına (çıktı + olay akışıyla), /api/storage/jobs. Yalnız bitmişler silinir. */
    __jobSpec() {
      const F = ankamon.util.Format;
      const status = ankamon.ui.DiskUsage.JOB_STATUS;
      const spec = this.__withDisk({
        mode: "jobs", size: this.__sizer("/storage/jobs"), label: "Görev kuyruğu", noun: "görev kaydı (tahta sonuçları ve çıktı akışıyla birlikte)",
        columns: [
          { id: "name", label: "Görev" },
          { id: "type", label: "Tür", width: 90 },
          { id: "status", label: "Durum", width: 100 },
          { id: "targets", label: "Hedef", width: 170 },
          { id: "by", label: "Oluşturan", width: 100 },
          { id: "created", label: "Oluşturma", width: 150 },
          { id: "events", label: "Çıktı satırı", width: 95 },
          { id: "size", label: "Tahmini boyut (~)", width: 130 }
        ],
        load: async () => {
          const data = await ankamon.io.Api.get("/storage/jobs");
          const rows = [{
            all: true, scope: { all: "1" }, name: "— Bitmiş tüm görevler —", n: data.finished.n,
            bytes: data.finished.est_bytes, estimated: true, deletable: true,
            cells: ["— Bitmiş tüm görevler —", "", "", "", "", "", "", this.__size(data.finished.est_bytes, true)]
          }];
          data.jobs.forEach(j => {
            const names = j.target_names.join(", ");
            const targets = j.targets > j.target_names.length ? `${j.targets} tahta (${names}…)` : names;
            const name = `#${j.id} ${j.title || j.type}`;
            rows.push({
              scope: { ids: String(j.id) }, name, n: 1, bytes: j.est_bytes, estimated: true,
              // Kuyrukta bekleyen/çalışan görev silinemez (runner sonucunu yazacak yer bulamaz).
              deletable: j.deletable,
              cells: [name, j.type, status[j.status] || j.status, targets, j.created_by || "",
                F.dateTime(j.created_at), j.events, this.__size(j.est_bytes, true)]
            });
          });
          return {
            rows,
            info: this.__info(spec, data,
              `${data.total.n} görev (${data.finished.n} bitmiş), ~${F.bytes(data.total.bytes)} — bekleyen/çalışan görevler silinemez; ` +
              "bakım raporları kendi sekmesinde")
          };
        },
        remove: async row => {
          const search = new URLSearchParams(row.scope);
          return (await ankamon.io.Api.del("/storage/jobs?" + search.toString())).deleted;
        }
      });
      return spec;
    },

    /**
     * Bakım raporları (eski adı "Sorun tespiti"): tarama ("diagnose" görevi) başına, /api/storage/diagnose. Görev kuyruğu
     * sekmesi bunları saymaz. Yalnız bitmiş taramalar silinir; silinen tahtalar otomatik zamanlayıcıca
     * (bkz. worker tasks/diagnose_schedule.py) bir sonraki uygun anda yeniden taranır.
     */
    __diagnoseSpec() {
      const F = ankamon.util.Format;
      const status = ankamon.ui.DiskUsage.JOB_STATUS;
      const spec = this.__withDisk({
        mode: "diagnose", size: this.__sizer("/storage/diagnose"), label: "Bakım raporları",
        noun: "bakım raporu (tahta sonuçlarıyla birlikte; silinen tahtalar otomatik taramada yeniden denetlenir)",
        columns: [
          { id: "name", label: "Tarama" },
          { id: "kind", label: "Başlatan", width: 120 },
          { id: "status", label: "Durum", width: 100 },
          { id: "targets", label: "Tahtalar", width: 220 },
          { id: "created", label: "Tarih", width: 150 },
          { id: "events", label: "Çıktı satırı", width: 95 },
          { id: "size", label: "Tahmini boyut (~)", width: 130 }
        ],
        load: async () => {
          const data = await ankamon.io.Api.get("/storage/diagnose");
          const rows = [{
            all: true, scope: { all: "1" }, name: "— Bitmiş tüm taramalar —", n: data.finished.n,
            bytes: data.finished.est_bytes, estimated: true, deletable: true,
            cells: ["— Bitmiş tüm taramalar —", "", "", "", "", "", this.__size(data.finished.est_bytes, true)]
          }];
          data.jobs.forEach(j => {
            const names = j.target_names.join(", ");
            const targets = j.targets > j.target_names.length ? `${j.targets} tahta (${names}…)` : names;
            const name = `#${j.id} Bakım raporu`;
            rows.push({
              scope: { ids: String(j.id) }, name, n: 1, bytes: j.est_bytes, estimated: true, deletable: j.deletable,
              cells: [name, j.auto ? "Otomatik" : (j.created_by || "Elle"), status[j.status] || j.status, targets,
                F.dateTime(j.created_at), j.events, this.__size(j.est_bytes, true)]
            });
          });
          return {
            rows,
            info: this.__info(spec, data,
              `${data.total.n} tarama (${data.finished.n} bitmiş), ~${F.bytes(data.total.bytes)} — süren taramalar silinemez`)
          };
        },
        remove: async row => {
          const search = new URLSearchParams(row.scope);
          return (await ankamon.io.Api.del("/storage/diagnose?" + search.toString())).deleted;
        }
      });
      return spec;
    },

    /**
     * Yedekler: /data/backups'taki döküm dosyaları (gerçek boyut), /api/storage/backups. Silme yedek
     * servisine (root) bir istekle yaptırılır — bkz. backend BackupStatsApi.
     */
    __backupSpec() {
      const F = ankamon.util.Format;
      const kinds = ankamon.ui.DiskUsage.BACKUP_KIND;
      const spec = this.__withDisk({
        mode: "backups", size: this.__sizer("/storage/backups"), label: "Yedekler", noun: "yedek dosyası",
        columns: [
          { id: "name", label: "Dosya" },
          { id: "kind", label: "Tür", width: 200 },
          { id: "time", label: "Alınma zamanı", width: 170 },
          { id: "size", label: "Boyut", width: 120 }
        ],
        load: async () => {
          const data = await ankamon.io.Api.get("/storage/backups");
          const rows = [{
            all: true, scope: { all: "1" }, name: "— Tüm yedekler —", n: data.total.n, bytes: data.total.bytes,
            estimated: false, deletable: true, cells: ["— Tüm yedekler —", "", "", F.bytes(data.total.bytes)]
          }];
          // Tür grupları: o türün tüm dosyalarını tek satırdan silmek için (sunucu kind= ile o anki
          // dosyaları siler).
          Object.keys(kinds).forEach(kind => {
            const files = data.files.filter(f => f.kind === kind);
            if (!files.length) {
              return;
            }
            const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
            const name = `— Tüm ${ankamon.ui.DiskUsage.BACKUP_GROUP[kind]} (${files.length}) —`;
            rows.push({
              groupAll: kind, scope: { kind }, name, n: files.length, bytes, estimated: false, deletable: true,
              cells: [name, kinds[kind], F.dateTime(Math.max(...files.map(f => f.mtime))), F.bytes(bytes)]
            });
          });
          data.files.forEach(f => rows.push({
            group: f.kind, scope: { names: f.name }, name: f.name, n: 1, bytes: f.bytes, estimated: false, deletable: true,
            cells: [f.name, kinds[f.kind] || f.kind, F.dateTime(f.mtime), F.bytes(f.bytes)]
          }));
          return {
            rows,
            info: this.__info(spec, data,
              `${data.total.n} dosya, ${F.bytes(data.total.bytes)} (${qx.bom.String.escape(data.dir)}; ` +
              `saklanan: ${data.keep_full} tam, ${data.keep_config} yapılandırma)`)
          };
        },
        remove: async row => {
          const search = new URLSearchParams(row.scope);
          return (await ankamon.io.Api.del("/storage/backups?" + search.toString())).deleted;
        }
      });
      return spec;
    },

    /**
     * Log kuyruğu: rsyslog'un /data/rsyslog'daki disk kuyruğu (veritabanına henüz yazılamamış loglar)
     * ve açılışta kenara alınmış bozuk kuyruk klasörleri, /api/storage/logqueue. Canlı kuyruk parça
     * parça silinemez (konum dosyası bozulur) — yalnız grup satırıyla bütün olarak silinir.
     */
    __logQueueSpec() {
      const F = ankamon.util.Format;
      const spec = this.__withDisk({
        mode: "queue", size: this.__sizer("/storage/logqueue"), label: "Log kuyruğu", noun: "kuyruk dosyası (içindeki, veritabanına henüz yazılmamış loglar kaybolur)",
        columns: [
          { id: "name", label: "Ad" },
          { id: "kind", label: "Tür", width: 330 },
          { id: "files", label: "Dosya", width: 70 },
          { id: "time", label: "Son değişiklik", width: 160 },
          { id: "size", label: "Boyut", width: 110 }
        ],
        load: async () => {
          const data = await ankamon.io.Api.get("/storage/logqueue");
          const live = data.live;
          const fileCount = live.files.length + data.quarantine.reduce((sum, q) => sum + q.files, 0);
          const rows = [{
            all: true, scope: { all: "1" }, name: "— Tümü —", n: fileCount, bytes: data.total.bytes,
            estimated: false, deletable: true,
            cells: ["— Tümü —", "Canlı kuyruk + bozuk kuyruk klasörleri", fileCount, "", F.bytes(data.total.bytes)]
          }];
          if (live.files.length) {
            const name = `— Bekleyen canlı kuyruk (${live.files.length} dosya) —`;
            rows.push({
              groupAll: "live", scope: { names: "live" }, name, n: live.files.length, bytes: live.bytes,
              estimated: false, deletable: true,
              cells: [name, "Canlı kuyruk — rsyslog kısa süre durdurulup silinir", live.files.length,
                F.dateTime(live.newest), F.bytes(live.bytes)]
            });
            live.files.forEach(f => rows.push({
              group: "live", name: f.name, n: 1, bytes: f.bytes, estimated: false, deletable: false,
              cells: [f.name, f.name.endsWith(".qi") ? "Kuyruk konum dosyası" : "Kuyruk parçası (yalnız grup olarak silinir)",
                1, F.dateTime(f.mtime), F.bytes(f.bytes)]
            }));
          }
          data.quarantine.forEach(q => rows.push({
            scope: { names: q.name }, name: q.name, n: q.files, bytes: q.bytes, estimated: false, deletable: true,
            cells: [q.name, "Bozuk kuyruk (açılışta kenara alınmış)", q.files, F.dateTime(q.mtime), F.bytes(q.bytes)]
          }));
          const state = live.bytes > 0
            ? `bekleyen kuyruk ${F.bytes(live.bytes)} — büyüyorsa loglar veritabanına ulaşmıyor`
            : "bekleyen kuyruk boş";
          return {
            rows,
            info: this.__info(spec, data, `${qx.bom.String.escape(data.dir)}: ${state}, ${data.quarantine.length} bozuk klasör`)
          };
        },
        remove: async row => {
          const search = new URLSearchParams(row.scope);
          return (await ankamon.io.Api.del("/storage/logqueue?" + search.toString())).deleted;
        }
      });
      return spec;
    }
  }
});
