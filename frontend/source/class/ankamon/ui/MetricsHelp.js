/**
 * Sensörler sayfasının yardım penceresi: sensör verisinin kim tarafından, ne sıklıkla, hangi
 * süzgeçle toplandığı; nasıl saklanıp özetlendiği ve nerede sunulduğu. Metin sabit değil — her açılışta
 * ve pencere açıkken REFRESH_MS'de bir /api/metrics/info'dan (canlı yapılandırma + veritabanı +
 * Telegraf süreç ölçümleri, bkz. backend MetricsInfoApi) yeniden kurulur.
 */
qx.Class.define("ankamon.ui.MetricsHelp", {
  type: "static",

  statics: {
    REFRESH_MS: 30000,

    /** reshape.star KEEP listesindeki her ölçümün grubu ve Türkçe açıklaması (liste dosyadan gelir). */
    METRIC_INFO: {
      node_load1: ["İşlemci", "1 dk yük ortalaması"],
      node_load5: ["İşlemci", "5 dk yük ortalaması"],
      node_load15: ["İşlemci", "15 dk yük ortalaması"],
      node_cpu_seconds_total: ["İşlemci", "çekirdek başına mod süreleri (sayaç) — kullanım % buradan türetilir"],
      node_procs_running: ["İşlemci", "çalışan süreç sayısı"],
      node_memory_MemTotal_bytes: ["Bellek", "toplam RAM"],
      node_memory_MemAvailable_bytes: ["Bellek", "kullanılabilir RAM — kullanım % buradan"],
      node_memory_SwapTotal_bytes: ["Bellek", "toplam swap"],
      node_memory_SwapFree_bytes: ["Bellek", "boş swap"],
      node_filesystem_size_bytes: ["Disk", "dosya sistemi boyutu (bağlama noktası başına)"],
      node_filesystem_avail_bytes: ["Disk", "boş alan — doluluk % buradan"],
      node_disk_read_bytes_total: ["Disk", "okunan bayt (sayaç, cihaz başına)"],
      node_disk_written_bytes_total: ["Disk", "yazılan bayt (sayaç, cihaz başına)"],
      node_disk_io_time_seconds_total: ["Disk", "G/Ç'de geçen süre (sayaç)"],
      node_network_receive_bytes_total: ["Ağ", "alınan bayt (sayaç, arayüz başına)"],
      node_network_transmit_bytes_total: ["Ağ", "gönderilen bayt (sayaç, arayüz başına)"],
      node_network_up: ["Ağ", "arayüz bağlantı durumu"],
      node_hwmon_temp_celsius: ["Sıcaklık", "donanım algılayıcı sıcaklıkları (çip/algılayıcı başına)"],
      node_hwmon_fan_rpm: ["Sıcaklık", "fan devri"],
      node_thermal_zone_temp: ["Sıcaklık", "termal bölge sıcaklıkları"],
      node_hwmon_in_volts: ["Sıcaklık", "CMOS pil gerilimi (Super I/O yongası, in8 = Vbat)"],
      smartmon_temperature_celsius_raw_value: ["Sıcaklık", "disk sıcaklığı (SMART 194)"],
      smartmon_airflow_temperature_cel_raw_value: ["Sıcaklık", "disk sıcaklığı (SMART 190, hava akışı)"],
      nvme_temperature_celsius: ["Sıcaklık", "NVMe disk sıcaklığı"],
      node_boot_time_seconds: ["Sistem", "açılış zamanı — çalışma süresi buradan"],
      node_time_seconds: ["Sistem", "tahtanın saati"],
      node_timex_offset_seconds: ["Sistem", "saat (NTP) sapması"]
    },

    open() {
      const win = ankamon.ui.Dialog.window("Sensör verisi — nasıl toplanıyor, saklanıyor, sunuluyor?", 900, { maximizable: true });
      const root = qx.core.Init.getApplication().getRoot().getBounds();
      win.setHeight(Math.max(420, Math.round((root ? root.height : 800) * 0.85)));

      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      const status = new qx.ui.basic.Label("Yükleniyor…").set({ textColor: "app-muted" });
      const refresh = new qx.ui.form.Button("Yenile");
      bar.add(status, { flex: 1 });
      bar.add(refresh);
      win.add(bar);

      const html = new qx.ui.embed.Html("").set({
        overflowX: "hidden", overflowY: "auto", backgroundColor: "surface", textColor: "text-primary-on-surface",
        decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 6 })
      });
      win.add(html, { flex: 1 });

      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [close]);

      const load = async () => {
        status.setValue("Ölçülüyor…");
        try {
          const data = await ankamon.io.Api.get("/metrics/info");
          if (win.isDisposed()) {
            return;
          }
          html.setHtml(this.__render(data));
          status.setValue("Canlı değerler · " + new Date(data.generated_at * 1000).toLocaleTimeString("tr-TR") +
            ` · pencere açıkken ${this.REFRESH_MS / 1000} sn'de bir yenilenir`);
        } catch (e) {
          if (!win.isDisposed()) {
            status.setValue("Alınamadı: " + e.message);
          }
        }
      };
      refresh.addListener("execute", load);
      const timer = new qx.event.Timer(this.REFRESH_MS);
      timer.addListener("interval", load);
      timer.start();
      win.addListener("close", () => {
        timer.stop();
        timer.dispose();
      });
      win.open();
      load();
    },

    /** "60s" / "1m" / "2h" → saniye */
    __seconds(text) {
      const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(String(text || "").trim());
      if (!m) {
        return null;
      }
      const n = parseFloat(m[1]);
      return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] || "s"];
    },

    /** PostgreSQL interval metni ("30 days", "12:00:00", "1 day 02:00:00") → Türkçe */
    __interval(text) {
      if (!text) {
        return "—";
      }
      const parts = [];
      let rest = String(text);
      const d = /(\d+) days?/.exec(rest);
      if (d) {
        const days = +d[1];
        parts.push(days % 365 === 0 && days >= 365 ? `${days / 365} yıl` : `${days} gün`);
        rest = rest.replace(d[0], "");
      }
      const mo = /(\d+) mons?/.exec(rest);
      if (mo) {
        parts.push(`${mo[1]} ay`);
        rest = rest.replace(mo[0], "");
      }
      const t = /(\d+):(\d+):(\d+)/.exec(rest);
      if (t) {
        const [h, mi, s] = [+t[1], +t[2], +t[3]];
        if (h) {
          parts.push(`${h} sa`);
        }
        if (mi) {
          parts.push(`${mi} dk`);
        }
        if (s) {
          parts.push(`${s} sn`);
        }
      }
      return parts.join(" ") || String(text);
    },

    __render(d) {
      const F = ankamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const n = v => (v === null || v === undefined ? "—" : Number(v).toLocaleString("tr-TR"));
      const when = sec => (sec ? esc(F.dateTime(sec * 1000)) : "—");
      const c = d.collection;
      const scrape = this.__seconds(c.scrape_interval) || 60;
      const targets = new Set(c.targets);
      const scanned = d.boards.filter(b => targets.has(b.id));
      const tg = d.telegraf;
      const r = d.rate;

      const css = `
        <style>
          .mh{font:13px/1.5 sans-serif;padding:4px 14px 14px}
          .mh h3{font-size:15px;margin:18px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(128,128,128,.35)}
          .mh table{border-collapse:collapse;width:100%;margin:6px 0}
          .mh th,.mh td{border:1px solid rgba(128,128,128,.3);padding:3px 7px;text-align:left;vertical-align:top}
          .mh th{background:rgba(128,128,128,.12);font-weight:600}
          .mh td.r{text-align:right;white-space:nowrap}
          .mh .muted{opacity:.7}
          .mh .ok{color:#2e8b2e;font-weight:600}.mh .bad{color:#d9534f;font-weight:600}
          .mh .warn{border-left:4px solid #e0a020;background:rgba(224,160,32,.12);padding:6px 10px;margin:8px 0}
          .mh code{font-family:monospace;font-size:12px;background:rgba(128,128,128,.15);padding:0 3px;border-radius:3px}
          .mh .flow{font-family:monospace;font-size:12px;white-space:pre;background:rgba(128,128,128,.08);padding:8px;border-radius:4px;overflow-x:auto}
        </style>`;

      let h = `<div class="mh">${css}`;

      // --- Özet
      const perBoardCpu = tg && tg.cpu_percent !== null && scanned.length ? tg.cpu_percent / scanned.length : null;
      h += "<h3>Şu an</h3><table>";
      h += `<tr><th>Kayıtlı tahta</th><td>${n(d.boards.length)}</td><th>Şu an taranan</th><td>${n(scanned.length)}</td></tr>`;
      h += `<tr><th>Son 10 dk yazılan satır</th><td>${n(r.rows_10m)}</td><th>Bu hızla günde</th><td>~${n(r.rows_per_day)} satır</td></tr>`;
      h += `<tr><th>Günlük büyüme (ham)</th><td>~${r.bytes_per_day !== null ? F.bytes(r.bytes_per_day) : "—"}</td>` +
        `<th>Sıkıştırıldıktan sonra</th><td>~${r.bytes_per_day_compressed !== null ? F.bytes(r.bytes_per_day_compressed) : "—"}` +
        (r.compression_ratio ? ` <span class="muted">(oran ~${Math.round(1 / r.compression_ratio)}×)</span>` : "") + "</td></tr>";
      if (tg) {
        h += `<tr><th>Telegraf işlemci (ort.)</th><td>%${tg.cpu_percent} tek çekirdek` +
          (perBoardCpu !== null ? ` <span class="muted">(~%${perBoardCpu.toFixed(3)} / tahta)</span>` : "") +
          `</td><th>Telegraf bellek</th><td>${tg.rss_bytes ? F.bytes(tg.rss_bytes) : "—"}</td></tr>`;
        h += `<tr><td colspan="4" class="muted">Telegraf ${esc(F.duration(tg.uptime))} önce başladı (PID ${tg.pid}); ` +
          `o zamandan beri toplam ${tg.cpu_seconds} işlemci-saniyesi harcadı. Makinede ${tg.cores} çekirdek var. İşlemci ortalaması ` +
          "sürecin ömrü boyunca ölçülür — yeni başlamışsa ilk dakikalar yüksek görünebilir.</td></tr>";
      }
      if (d.disk && d.disk.free && r.bytes_per_day_compressed) {
        const days = d.disk.free / r.bytes_per_day_compressed;
        h += `<tr><th>Veri diski boş</th><td>${F.bytes(d.disk.free)} / ${F.bytes(d.disk.total)}</td>` +
          `<th>Bu hızla yeter</th><td>${days > 3650 ? "10 yıldan uzun" : "~" + n(Math.round(days)) + " gün"} ` +
          "<span class=\"muted\">(yalnız sensör verisi; saklama süresi dolanlar silindiği için pratikte sınırsız)</span></td></tr>";
      }
      h += "</table>";

      // --- Kim, ne sıklıkla
      h += "<h3>Kim, ne sıklıkla topluyor?</h3>";
      h += `<p>Veriyi tahta <b>göndermez</b>; Ankamon konteynerindeki <b>Telegraf</b> her tahtanın ` +
        `<code>node_exporter</code> ucunu (<code>http://&lt;ip&gt;:9100/metrics</code>) kendisi okur.</p>`;
      h += `<div class="flow">` +
        `worker (board_status)  ─ her ${c.status_tick} sn ─►  tahtaya TCP yoklama (SSH 22 + sensör portu, ${c.probe_timeout ?? "?"} sn zaman aşımı)\n` +
        `      │  sensör portu ${c.fails_before_offline ?? "?"} kez üst üste yanıt vermezse "erişilemez" sayılır (tek sıçrama kaydı kesmez)\n` +
        `      ▼\n` +
        `worker (telegraf_targets) ─ her ${c.status_tick} sn ─►  /data/telegraf/targets.conf  (izlenen + erişilebilir tahtalar)\n` +
        `      │  dosya değişince Telegraf kendini yeniden yükler (son değişiklik: ${when(c.targets_mtime)})\n` +
        `      ▼\n` +
        `Telegraf ─ her ${esc(c.scrape_interval)} (±${esc(c.collection_jitter)}) ─►  node_exporter (${esc(c.scrape_timeout)} zaman aşımı)\n` +
        `      │  reshape.star süzgeci: ~2300 satırlık yanıttan yalnız aşağıdaki ölçümler kalır\n` +
        `      ▼  her ${esc(c.flush_interval)} toplu yazım (bağlantı koparsa ${n(c.metric_buffer_limit)} ölçüme kadar bellekte bekler)\n` +
        `PostgreSQL/TimescaleDB  metrics  ─►  5 dk özet  ─►  saatlik özet</div>`;
      h += `<p>Bir tahta: <b>izleme açık</b> + <b>sensör portu erişilebilir</b> + IP biliniyorsa taranır. ` +
        `Açılan tahta ~${c.status_tick}-${c.status_tick * 2 + scrape} sn içinde kayda girer, kapandıktan ` +
        `~${c.status_tick * (c.fails_before_offline || 2)} sn sonra listeden çıkar.</p>`;

      // --- Tahtalar
      h += "<h3>Tahtalar (son 10 dakika, ölçülen)</h3><table><tr><th>Tahta</th><th>Adres</th><th>Durum</th>" +
        "<th>Taranıyor</th><th class=\"r\">Seri</th><th class=\"r\">Satır (10 dk)</th><th class=\"r\">Beklenen</th><th>Son ölçüm</th></tr>";
      d.boards.forEach(b => {
        const inT = targets.has(b.id);
        const expected = inT ? Math.round(b.series * 600 / scrape) : 0;
        const why = inT ? "" : !b.monitor_enabled ? "izleme kapalı" : !b.exporter_ok ? "sensör portu yanıt vermiyor" : "IP yok";
        const pct = expected ? Math.round(b.rows_10m / expected * 100) : null;
        h += `<tr><td>${esc(b.name)}</td><td>${esc(b.ip || "—")}:${b.exporter_port}</td>` +
          `<td>${b.online ? "<span class=\"ok\">çevrimiçi</span>" : "<span class=\"muted\">kapalı</span>"}</td>` +
          `<td>${inT ? "<span class=\"ok\">evet</span>" : "<span class=\"muted\">hayır — " + why + "</span>"}</td>` +
          `<td class="r">${n(b.series)}</td><td class="r">${n(b.rows_10m)}</td>` +
          `<td class="r">${inT ? n(expected) + (pct !== null ? ` <span class="${pct >= 90 ? "ok" : "bad"}">%${pct}</span>` : "") : "—"}</td>` +
          `<td>${b.last ? esc(F.ago(b.last)) : "—"}</td></tr>`;
      });
      h += "</table><p class=\"muted\">Beklenen = seri sayısı × (600 sn / tarama aralığı). %90'ın altı: tahta bu 10 dakikanın " +
        "bir kısmında kapalıydı, yeni açıldı ya da taramalar zaman aşımına uğruyor.</p>";

      // --- Ne toplanıyor
      const counts = {};
      d.series.forEach(s => { counts[s.name] = s; });
      const groups = {};
      d.filter.keep.forEach(name => {
        const [group, desc] = this.METRIC_INFO[name] || ["Diğer", ""];
        (groups[group] = groups[group] || []).push({ name, desc });
      });
      h += `<h3>Hangi sensör verileri toplanıyor? (${d.filter.keep.length} ölçüm)</h3>`;
      h += "<table><tr><th>Grup</th><th>Ölçüm</th><th>Açıklama</th><th class=\"r\">Seri (tüm tahtalar)</th></tr>";
      Object.keys(groups).forEach(group => {
        groups[group].forEach((m, i) => {
          const s = counts[m.name];
          h += `<tr>${i === 0 ? `<td rowspan="${groups[group].length}"><b>${esc(group)}</b></td>` : ""}` +
            `<td><code>${esc(m.name)}</code></td><td>${esc(m.desc)}</td>` +
            `<td class="r">${s ? n(s.series) : "<span class=\"muted\">0</span>"}</td></tr>`;
        });
      });
      h += "</table>";
      h += "<p>Süzgeç kuralları (Telegraf'ın kullandığı <code>reshape.star</code> dosyasından):</p><ul>" +
        `<li>İşlemci modlarından yalnız: ${d.filter.cpu_modes.map(x => `<code>${esc(x)}</code>`).join(" ")}</li>` +
        `<li>Atlanan dosya sistemi türleri: ${d.filter.skip_fstypes.map(x => `<code>${esc(x)}</code>`).join(" ")}</li>` +
        `<li>Atlanan disk/ağ cihaz önekleri: ${d.filter.skip_dev_prefixes.map(x => `<code>${esc(x)}</code>`).join(" ")}</li>` +
        `<li>Saklanan etiketler: ${d.filter.keep_tags.map(x => `<code>${esc(x)}</code>`).join(" ")}</li></ul>`;
      h += "<p class=\"muted\">Seri = tahta + ölçüm + etiket (ör. çekirdek, disk) birleşimi; her taramada seri başına bir satır yazılır. " +
        "Tahta başına seri sayısı donanıma göre değişir (çekirdek, disk, sıcaklık algılayıcısı sayısı).</p>";

      // --- Saklama
      const layerName = { raw: "Ham (ayrıntılı)", "5m": "5 dakikalık özet", "1h": "Saatlik özet" };
      const resolution = { raw: c.scrape_interval, "5m": "5 dk", "1h": "1 saat" };
      h += "<h3>Saklama, sıkıştırma ve özetleme (TimescaleDB politikaları)</h3>";
      h += "<table><tr><th>Katman</th><th>Çözünürlük</th><th class=\"r\">Satır</th><th class=\"r\">Boyut</th><th>Kapsadığı aralık</th>" +
        "<th>Sıkıştırma</th><th>Saklama</th><th>Özet yenileme</th></tr>";
      ["raw", "5m", "1h"].forEach(key => {
        const L = d.layers[key];
        if (!L) {
          return;
        }
        const job = proc => L.jobs.find(j => j.proc === proc);
        const comp = job("policy_compression");
        const ret = job("policy_retention");
        const ref = job("policy_refresh_continuous_aggregate");
        const run = j => (j ? `<br><span class="muted">son: ${when(j.last_run)} ${j.status ? "(" + esc(j.status === "Success" ? "başarılı" : j.status) + ")" : ""}` +
          `<br>sonraki: ${when(j.next_run)}</span>` : "");
        const ratio = L.before_compression ? Math.round(L.before_compression / L.after_compression) : null;
        h += `<tr><td><b>${layerName[key]}</b><br><code>${esc(L.name)}</code></td><td>${esc(resolution[key])}</td>` +
          `<td class="r">~${n(L.rows)}</td><td class="r">${F.bytes(L.bytes)}</td>` +
          `<td>${when(L.first)}<br>→ ${when(L.last)}</td>` +
          `<td>${comp ? `${esc(this.__interval(comp.config.compress_after))} sonra` +
            `<br><span class="muted">${L.compressed_chunks}/${L.chunks} parça sıkışık${ratio ? `, ~${ratio}× küçüldü` : ""}</span>` + run(comp)
            : "<span class=\"muted\">yok</span>"}</td>` +
          `<td>${ret ? `<b>${esc(this.__interval(ret.config.drop_after))}</b> sonra silinir` + run(ret) : "<span class=\"bad\">politika yok — süresiz</span>"}</td>` +
          `<td>${ref ? `her ${esc(this.__interval(ref.every))}; son ${esc(this.__interval(ref.config.start_offset))} yeniden hesaplanır` + run(ref) : "—"}</td></tr>`;
      });
      h += "</table>";
      h += "<p>Özetler satır başına <b>ortalama, en düşük, en yüksek ve son</b> değeri tutar; saatlik özet 5 dakikalık özetten " +
        "türetilir. Ham veri silindikten sonra özetler kendi süreleri dolana dek kalır. Süreler <code>.env</code>'deki " +
        "<code>METRICS_RAW_DAYS</code>, <code>METRICS_5M_DAYS</code>, <code>METRICS_1H_DAYS</code> ile değiştirilir " +
        "(konteyner her açılışta uygular). Günlük tam yedeklere sensör verisi de dahildir.</p>";

      // --- Sunum
      const rawDays = (() => {
        const ret = d.layers.raw && d.layers.raw.jobs.find(j => j.proc === "policy_retention");
        return ret ? this.__interval(ret.config.drop_after) : "süresiz";
      })();
      h += "<h3>Nerede sunuluyor?</h3><ul>" +
        "<li><b>Tahtalar</b> grid'i: İşlemci, Bellek, Disk, Sıcaklık sütunları — ham verinin son 5 dakikasından, 5 sn'de bir.</li>" +
        "<li><b>Genel bakış</b>: Sensör kaydı (satır sayısı + boyut) kartı.</li>" +
        "<li><b>Sensörler</b> (bu sayfa, Grafana): zaman serisi grafikleri; sağ üstten zaman aralığı seçilir.</li>" +
        "<li><b>Loglar → Disk kullanımı</b> (yetkiliye): tahta başına sensör verisi boyutu ve kalıcı silme.</li></ul>";
      const g = d.grafana;
      if (g.raw && !g["5m"] && !g["1h"]) {
        h += `<div class="warn"><b>Dikkat:</b> Grafana panoları şu an yalnız <b>ham</b> katmanı sorguluyor. Ham veri ` +
          `<b>${esc(rawDays)}</b> sonra silindiğinden, bundan eski bir zaman aralığı seçilirse grafikler boş görünür — ` +
          "5 dakikalık ve saatlik özetler veritabanında durduğu hâlde panolarda kullanılmıyor.</div>";
      } else {
        h += `<p class="muted">Grafana panoları katmanları kullanıyor: ham ${g.raw ? "✓" : "✗"}, 5 dk ${g["5m"] ? "✓" : "✗"}, saatlik ${g["1h"] ? "✓" : "✗"}.</p>`;
      }
      h += "</div>";
      return h;
    }
  }
});
