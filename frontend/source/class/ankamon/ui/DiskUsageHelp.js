/**
 * Disk kullanımı sekmelerinin "?" yardım penceresi (bkz. ui.DiskUsageTab): o sekmedeki verinin ne
 * olduğu, nerede saklandığı, saklama politikası, otomatik silme/özetleme/sıkıştırma ve diskte
 * büyüme davranışı (yavaş birikim yalnız hatırlatılır, uyarı kutusu gerçek risk için). Süreler ve politika durumları sabit metin
 * değil — /api/storage/policy'den (o anki .env değerleri + TimescaleDB politikalarının gerçek ayarı ve
 * son çalışması + rsyslog kuyruk sınırları + /data diski, bkz. backend StoragePolicyApi) okunur.
 * Kodda karşılığı olmayan iddia yazılmaz: otomatik temizliği olmayan veri açıkça "yok" der.
 */
qx.Class.define("ankamon.ui.DiskUsageHelp", {
  type: "static",

  statics: {
    /**
     * @param spec {Map} sekme tanımı (ui.DiskUsage.specs — mode, label)
     * @param rows {Array?} sekmenin son yüklenen satırları ("Şu an" özeti için; yoksa atlanır)
     */
    open(spec, rows) {
      const win = ankamon.ui.Dialog.window(`${spec.label} — nedir, nerede, ne kadar saklanır?`, 820, { maximizable: true });
      const root = qx.core.Init.getApplication().getRoot().getBounds();
      win.setHeight(Math.max(420, Math.round((root ? root.height : 800) * 0.8)));
      const html = new qx.ui.embed.Html("<div style='padding:14px'>Yükleniyor…</div>").set({
        overflowX: "hidden", overflowY: "auto", backgroundColor: "surface", textColor: "text-primary-on-surface",
        decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 6 })
      });
      win.add(html, { flex: 1 });
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [close]);
      win.open();
      ankamon.io.Api.get("/storage/policy").then(p => {
        if (!win.isDisposed()) {
          html.setHtml(this.__render(spec.mode, p, rows || []));
        }
      }, e => {
        if (!win.isDisposed()) {
          html.setHtml(`<div style='padding:14px'>Saklama bilgisi alınamadı: ${qx.bom.String.escape(e.message)}</div>`);
        }
      });
    },

    /** "Şu an" satırındaki sayının birimi (tanımlı değilse "kayıt"). */
    UNIT: { queue: "dosya", backups: "dosya", jobs: "görev", diagnose: "tarama" },

    CSS: `<style>
      .dh{font:13px/1.55 sans-serif;padding:4px 14px 14px}
      .dh h3{font-size:14px;margin:16px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(128,128,128,.35)}
      .dh table{border-collapse:collapse;width:100%}
      .dh th,.dh td{border:1px solid rgba(128,128,128,.3);padding:5px 8px;text-align:left;vertical-align:top}
      .dh th{background:rgba(128,128,128,.12);font-weight:600;width:170px;white-space:nowrap}
      .dh code{font-family:monospace;font-size:12px;background:rgba(128,128,128,.15);padding:0 3px;border-radius:3px}
      .dh .muted{opacity:.7}
      .dh .v{border-left:5px solid;padding:8px 12px;margin:10px 0 4px;border-radius:3px}
      .dh .v .t{display:block;font-size:14px;font-weight:700;margin-bottom:2px}
      .dh .v.ok{border-color:#2e8b2e;background:rgba(46,139,46,.12)}
      .dh .v.mid{border-color:#e0a020;background:rgba(224,160,32,.13)}
      .dh .v.bad{border-color:#d9534f;background:rgba(217,83,79,.12)}
      .dh .v.note{border-color:rgba(128,128,128,.55);background:rgba(128,128,128,.08)}
      .dh p.intro{margin:10px 0 4px}
      .dh ul{margin:4px 0;padding-left:20px}
    </style>`,

    __render(mode, p, rows) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const env = (key, def) => (p.env && p.env[key]) || def;
      const pol = (table, kind) => (p.policies || []).find(x => x.table === table && x.kind === "policy_" + kind);
      // "her 1 day, son başarılı 19.10 14:55" — politika veritabanında yoksa açıkça söylenir.
      const run = x => !x ? "<span class='muted'>(politika veritabanında bulunamadı)</span>"
        : `<span class='muted'>— her ${esc(this.__interval(x.every))} çalışır; son başarılı: ${x.last_ok ? F.dateTime(x.last_ok) : "henüz yok"}` +
          `${x.status && x.status !== "Success" ? ", son durum: <b>" + esc(x.status) + "</b>" : ""}</span>`;
      const drop = (table, def) => {
        const x = pol(table, "retention");
        return `<b>${esc(this.__interval(x ? x.config.drop_after : def))}</b>`;
      };
      const compress = table => {
        const x = pol(table, "compression");
        return x ? `üzerinden ${esc(this.__interval(x.config.compress_after))} geçen günlük parçalar sıkıştırılır (kayıt silinmez, yalnız kapladığı yer azalır) ${run(x)}`
          : "yok";
      };
      const all = rows.find(r => r.all);
      const disk = p.disk && p.disk.free != null
        ? `/data diski: toplam ${F.bytes(p.disk.total)}, <b>boş ${F.bytes(p.disk.free)}</b>` : "";
      const now = all && all.bytes != null
        ? `Şu an (${esc(String(all.name).replace(/^—\s*|\s*—$/g, ""))}): <b>${F.bytes(all.bytes)}</b>` +
          `${all.n != null ? ` (${Number(all.n).toLocaleString("tr-TR")} ${this.UNIT[mode] || "kayıt"})` : ""}` +
          `${all.first ? `, en eski kayıt ${F.dateTime(all.first)}` : ""}.` : "";

      const T = this.__topics(mode, { env, pol, run, drop, compress, F, esc, p });
      if (!T) {
        return "<div class='dh'>Bu sekme için yardım yok.</div>";
      }
      let h = `<div class="dh">${this.CSS}`;
      if (T.intro) {
        h += `<p class="intro">${T.intro}</p>`;
      }
      if (T.verdict) {
        const [cls, title, text] = T.verdict;
        h += `<div class="v ${cls}">${title ? `<span class="t">${title}</span>` : ""}${text}</div>`;
      }
      if (now || disk) {
        h += `<div class="muted">${[now, disk].filter(Boolean).join(" · ")}</div>`;
      }
      h += "<h3>Ayrıntılar</h3><table>";
      T.rows.forEach(([k, v]) => {
        h += `<tr><th>${k}</th><td>${v}</td></tr>`;
      });
      h += "</table>";
      if (T.todo) {
        h += `<h3>Yer açmak / büyümeyi sınırlamak için</h3><ul>${T.todo.map(t => `<li>${t}</li>`).join("")}</ul>`;
      }
      h += "<p class='muted'>Süreler sunucudaki <code>.env</code> dosyasından gelir; değiştirmek için <code>.env</code> düzenlenip " +
        "konteyner yeniden başlatılır (arayüzden ayarlanmaz). Elle silme bu sekmedeki satırlardan yapılır ve geri alınamaz.</p>";
      return h + "</div>";
    },

    /**
     * Sekme başına içerik: {intro?: html (düz paragraf), verdict?: [sınıf, başlık (boşsa yok), açıklama],
     * rows: [[başlık, html]], todo?: [html]}. Sınıf: ok/mid/bad uyarı, note = yalnız hatırlatma (yavaş birikim).
     */
    __topics(mode, { env, pol, run, drop, compress, esc, p }) {
      const pg = "PostgreSQL/TimescaleDB veritabanı — sunucuda <code>data/postgres</code>";
      switch (mode) {
        case "system":
          return {
            verdict: ["mid", "Kontrolsüz büyüyüp diski doldurur mu? Süreyle sınırlı, boyutla değil.",
              `Üzerinden ${drop("logs", "90 days")} geçen loglar her gün kendiliğinden silinir; ama bu süre içinde ne kadar log geleceğine sınır yoktur. ` +
              "Sürekli hata basan bir tahta o süre içinde çok yer tutabilir — aşağıdaki tahta satırlarından en büyükleri izleyin."],
            rows: [
              ["Ne?", "Tahtaların rsyslog ile gönderdiği sistem günlükleri (TiHA'nın merkezi log sunucusu ayarı). Her satır bir log mesajı."],
              ["Nerede?", `${pg}, <code>logs</code> tablosu (1 günlük parçalara bölünmüş hypertable).`],
              ["Saklama", `${drop("logs", "90 days")} (<code>LOG_DAYS=${esc(env("LOG_DAYS", "90"))}</code>) — daha eski gün parçaları bütün olarak silinir ${run(pol("logs", "retention"))}`],
              ["Sıkıştırma", compress("logs").replace(/^ü/, "Ü")],
              ["Özetleme", "Yok — loglar özetlenmez, süre dolunca silinir."],
              ["Dışlanan mesajlar", "Loglar sayfasında \"dışla\" denen mesajlar yalnız grid'de gizlenir; kaydedilmeye devam eder, yer açmaz."]
            ],
            todo: [
              "Gürültülü tahtanın satırını seçip silin (yalnız o tahtanın logları gider).",
              "Daha kısa saklama için <code>LOG_DAYS</code> küçültülür (yeniden başlatmadan sonra en geç bir gün içinde eskiler silinir).",
              "Kalıcı çözüm, log basan hatayı tahtada gidermektir (Sorun tespiti / Bakım)."
            ]
          };
        case "command":
          return {
            rows: [
              ["Ne?", "Ankamon üzerinden tahtalarda çalıştırılan komutların kaydı: görevler, hazır işlemler, web terminal, " +
                "dosya yöneticisi ve ekran işlemleri — kim, ne zaman, hangi tahtada, ne çalıştırdı."],
              ["Nerede?", `${pg}, <code>command_log</code> tablosu (sıradan tablo).`],
              ["Saklama", "<b>Süresiz</b> — otomatik silme politikası yok."],
              ["Sıkıştırma / özetleme", "Yok."],
              ["Silme", "Yalnız elle, bu sekmeden (tahta başına ya da tümü)."]
            ],
            todo: ["Eski kayıtları tahta satırlarından silin (silinen kayıtlar denetim izinden de gider)."]
          };
        case "queue": {
          const q = Object.assign({}, p.queue);
          // rsyslog boyut yazımı ("4g", "512m") → "4 GB"
          q.maxDiskSpace = String(q.maxDiskSpace || "4g").replace(/^(\d+)\s*([kmgt])b?$/i, (m, n, u) => `${n} ${u.toUpperCase()}B`);
          return {
            intro: "Log kuyruğu, tahtalardan gelen logların veritabanı sunucusuna yazılmadan önce beklediği geçici konumdur: " +
              "rsyslog kabul ettiği her logu önce bu disk kuyruğuna yazar, veritabanına yazılan loglar da kuyruktan silinir. " +
              "Bu yüzden normalde boştur; yalnız veritabanı kapalı ya da yavaşken dolmaya başlar. " +
              `Canlı kuyruk en çok <b>${esc(q.maxDiskSpace || "4g")}</b> yer kaplayabilir. ` +
              "Açılışta okunamayan kuyruk ise <code>bozuk-…</code> klasörüne kenara alınır; bunlar bu sınırın dışındadır ve " +
              "otomatik silinmez — her bozuk açılışta bir tane eklenir.",
            rows: [
              ["Ne?", "rsyslog'un tahtalardan kabul edip veritabanına henüz yazamadığı loglar (Postgres kapalı/yavaşken birikir)."],
              ["Nerede?", "Sunucuda <code>data/rsyslog</code>: <code>ankamon_pg.*</code> parçaları + <code>ankamon_pg.qi</code> konum dosyası; " +
                "bozuklar <code>bozuk-YYYYAAGG-SSddss/</code>."],
              ["Sınırlar", `En çok ${esc(q.maxDiskSpace || "4g")} disk / ${Number(q.size || 5000000).toLocaleString("tr-TR")} kayıt. ` +
                `Dolarsa log atılmaz: gönderen tahta ${Math.round(Number(q.timeoutEnqueue || 600000) / 60000)} dk bekletilir ` +
                "(tahtalar kendi kuyruklarında tamponlar); süre dolarsa yeni kayıt düşer."],
              ["Otomatik temizlik", "Canlı kuyruk: loglar veritabanına yazılınca silinir. Bozuk klasörler: <b>yok</b>."],
              ["Uyarı", "Genel bakışta bekleyen kuyruk 50 MB'ı aşınca uyarı çıkar — büyüyorsa loglar veritabanına ulaşmıyor demektir."]
            ],
            todo: [
              "Bozuk klasörleri buradan silin (içlerindeki loglar zaten okunamamıştı).",
              "Canlı kuyruğu yalnız sorunu anladıktan sonra silin — içindeki, henüz yazılmamış loglar kaybolur."
            ]
          };
        }
        case "metrics":
          return {
            verdict: ["ok", "",
              `Ham ölçümler ${drop("metrics", "30 days")} sonra silinir; grafikler daha eski dönemler için özetlerden çizilir. ` +
              "Boyut tahta sayısı ve okuma aralığıyla orantılıdır, ham verinin süresi dolunca dengeye oturur; " +
              "yalnız saatlik özet süresi boyunca yavaşça büyür."],
            rows: [
              ["Ne?", `Tahtaların sensör ölçümleri (işlemci, bellek, disk, ağ, sıcaklık, fan, pil…) — Telegraf her ` +
                `<b>${esc(env("SCRAPE_INTERVAL", "60s"))}</b> okur.`],
              ["Nerede?", `${pg}: ham <code>metrics</code> (+ seri tanımları <code>metrics_tag</code>), özetler ` +
                "<code>metrics_5m</code>, <code>metrics_1h</code>."],
              ["Saklama", `Ham: ${drop("metrics", "30 days")} ${run(pol("metrics", "retention"))}<br>` +
                `5 dk özet: ${drop("metrics_5m", "180 days")} ${run(pol("metrics_5m", "retention"))}<br>` +
                `Saatlik özet: ${drop("metrics_1h", "1825 days")} ${run(pol("metrics_1h", "retention"))}`],
              ["Özetleme", "Her seri için ortalama/en düşük/en yüksek/son değer: 5 dk özeti " + run(pol("metrics_5m", "refresh_continuous_aggregate")) +
                "<br>saatlik özet (5 dk özetinden) " + run(pol("metrics_1h", "refresh_continuous_aggregate"))],
              ["Sıkıştırma", `Ham veri: ${compress("metrics")}. Özetler sıkıştırılmaz.`],
              ["Seri tanımları", "<code>metrics_tag</code> kendiliğinden silinmez (çok küçük); tahta silinince onunla gider."]
            ],
            todo: ["Kaldırılmış/eski tahtaların satırlarını silin.", "Daha kısa saklama için <code>METRICS_*_DAYS</code> küçültülür."]
          };
        case "jobs":
          return {
            verdict: ["note", "Zamanla yavaşça birikir.",
              "Görevler ve tahta sonuçları kendiliğinden silinmez. En büyük kalem olan canlı çıktı satırları 30 günden eskiyse " +
              "görev yürütücüsü başlarken (konteyner yeniden başlatma/güncelleme) silinir. Ara sıra eski görevleri silmek yeterlidir."],
            rows: [
              ["Ne?", "Ankamon'dan başlatılan işler (komut, hazır işlem, kapat/uyandır, oturum, yansıtma…): görev, tahta başına sonuç ve canlı çıktı satırları."],
              ["Nerede?", `${pg}: <code>jobs</code>, <code>job_targets</code>, <code>job_events</code>.`],
              ["Sınırlar", "Tahta başına en çok 20 000 çıktı satırı saklanır (fazlası yalnız sayılır), satır başına 2 000 karakter; " +
                "tahta sonucu özeti son 8 000 karakter."],
              ["Otomatik temizlik", "30 günden eski görevlerin çıktı satırları — yalnız yürütücü başlangıcında. Görev ve sonuçlar: <b>yok</b>."],
              ["Silme", "Bitmiş görevler buradan silinir; kuyrukta bekleyen/çalışan görev silinemez."]
            ],
            todo: ["\"Bitmiş tüm görevler\" satırıyla ya da en büyük görevleri seçerek silin."]
          };
        case "diagnose":
          return {
            verdict: ["note", "Çok yavaş birikir.",
              `Otomatik tarama tahta başına yaklaşık ${esc(env("DIAGNOSE_INTERVAL_DAYS", "7"))} günde bir küçük bir rapor üretir; ` +
              "raporlar kendiliğinden silinmez, eskileri ara sıra buradan silinebilir."],
            rows: [
              ["Ne?", "Sorun tespiti taramalarının raporları — haftalık otomatik tarama ve elle başlatılanlar."],
              ["Nerede?", `${pg}: <code>jobs</code> (tür <code>diagnose</code>), rapor <code>job_targets</code> içinde.`],
              ["Saklama", "<b>Süresiz</b>. Çıktı satırları görev kuyruğundaki 30 gün kuralına tabidir (yürütücü başlangıcında)."],
              ["Silme", "Elle, bu sekmeden. Silinen tahtalar bir sonraki otomatik taramada yeniden denetlenir."]
            ],
            todo: ["Eski taramaları \"Bitmiş tüm taramalar\" satırıyla silin; Bakım raporu yeni taramalarla dolar."]
          };
        case "backups":
          return {
            verdict: ["mid", "Kontrolsüz büyüyüp diski doldurur mu? Dosya sayısı sınırlı, boyut değil.",
              `En çok <b>${esc(env("BACKUP_KEEP_FULL", "7"))} tam</b> ve <b>${esc(env("BACKUP_KEEP_CONFIG", "28"))} yapılandırma</b> ` +
              "(ve Grafana) yedeği tutulur; yenisi alınınca en eskiler silinir. Ama tam yedek logları ve sensör verisini içerdiğinden " +
              "veriyle birlikte büyür; yer ≈ tam yedek sayısı × son tam yedek boyutu. Yedek almadan önce boş alan denetlenmez."],
            rows: [
              ["Ne?", "Veritabanı yedekleri (<code>pg_dump</code>, sıkıştırılmış). Tam: loglar + sensör dahil; Yapılandırma: tahtalar, " +
                "kullanıcılar, ayarlar (log/sensör hariç); Grafana: panolar."],
              ["Nerede?", "Sunucuda <code>data/backups</code>."],
              ["Ne zaman?", `Yapılandırma + Grafana her <b>${esc(env("BACKUP_CONFIG_EVERY_HOURS", "6"))} saatte</b>; ` +
                `tam yedek her gün <b>${esc(env("BACKUP_FULL_AT", "03:30"))}</b>'te (kaçırılırsa açılınca).`],
              ["Saklama", `Son ${esc(env("BACKUP_KEEP_FULL", "7"))} tam, son ${esc(env("BACKUP_KEEP_CONFIG", "28"))} yapılandırma ve ` +
                `son ${esc(env("BACKUP_KEEP_CONFIG", "28"))} Grafana yedeği (<code>BACKUP_KEEP_FULL</code>, <code>BACKUP_KEEP_CONFIG</code>).`]
            ],
            todo: [
              "Disk daralırsa eski tam yedekleri silin ya da <code>BACKUP_KEEP_FULL</code>'u küçültün.",
              "Yedeklerin başka bir diskte de durması önerilir (aynı diskteki yedek disk arızasına karşı korumaz)."
            ]
          };
        default:
          return null;
      }
    },

    /** TimescaleDB aralığı ("1 day", "7 days", "00:05:00", "24:00:00") → Türkçe. */
    __interval(text) {
      const s = String(text || "").trim();
      let m = /^(\d+) (day|days|mon|mons|year|years|hour|hours)$/.exec(s);
      if (m) {
        const n = Number(m[1]);
        const unit = { day: "gün", days: "gün", mon: "ay", mons: "ay", year: "yıl", years: "yıl", hour: "saat", hours: "saat" }[m[2]];
        return `${n} ${unit}` + (unit === "gün" && n >= 365 && n % 365 === 0 ? ` (≈${n / 365} yıl)` : "");
      }
      m = /^(\d+):(\d\d):(\d\d)$/.exec(s);
      if (m) {
        const h = Number(m[1]);
        const min = Number(m[2]);
        return h ? (h % 24 === 0 ? `${h / 24} gün` : `${h} saat`) + (min ? ` ${min} dk` : "") : `${min} dk`;
      }
      return s;
    }
  }
});
