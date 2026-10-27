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
 * "Bilgi kartı"nın içeriği: bir tahtanın facts'ini (bkz. worker/ankamon/executor/hwfacts.py _FIELDS)
 * bölümlere ayrılmış bir HTML tablosuna çevirir. Hem pencere (rich Label) hem "Yazdır" sayfası aynı
 * HTML'i kullanır — biri değişince öteki de değişsin diye tek kaynak.
 * Durum bilgileri (boş disk, wifi bağlantısı, açık kalma süresi, sıcaklık) toplandıkları ana aittir.
 */
qx.Class.define("ankamon.ui.FactsView", {
  type: "static",

  statics: {
    // nmcli device STATE değerleri (LC_ALL=C).
    WIFI_STATE: {
      connected: "Bağlı",
      disconnected: "Bağlı değil",
      unavailable: "Kullanılamıyor",
      unmanaged: "Yönetilmiyor",
      connecting: "Bağlanıyor",
      "connecting (configuring)": "Bağlanıyor",
      "connecting (getting IP configuration)": "Bağlanıyor (IP alınıyor)"
    },

    // Pencere ve yazdırma sayfası için ortak görünüm (rich Label içinde <style> çalışmaz — satır içi).
    __TABLE: "border-collapse:collapse;width:100%",
    __SECTION: "padding:8px 0 2px;font-weight:bold;border-bottom:1px solid #ccc",
    __KEY: "padding:2px 12px 2px 0;white-space:nowrap;vertical-align:top;opacity:.75;width:1%",
    __VAL: "padding:2px 0;vertical-align:top",

    /** Gün de içeren süre (F.duration yalnız saat/dakika yazar: 3 gün → "72 sa"). */
    __uptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const rest = ankamon.util.Format.duration(seconds % 86400);
      return days ? `${days} gün ${rest}` : rest;
    },

    /**
     * RAM metni (Bilgi kartı, Tahtalar grid'i, Ekranlar donanım satırı ortak): TAKILI bellek (SMBIOS,
     * mem_installed_bytes — "8 GB DDR3"); henüz toplanmamışsa işletim sisteminin gördüğü MemTotal
     * (~7.2 GB). Takılı değer GiB tam sayıysa ondalıksız yazılır. Tümleşik (paylaşımlı) grafik
     * RAM'den pay ayırıyorsa (gpu_shared_bytes — bkz. worker executor/hwfacts.py) o da eklenir.
     * @param withType {Boolean?} bellek türü (DDR3…) ve paylaşımlı ekran belleği — varsayılan evet
     *   (Tahtalar grid'inin dar RAM sütunu yalnız boyutu ister)
     */
    ramText(f, withType = true) {
      if (f.mem_installed_bytes) {
        const gib = f.mem_installed_bytes / 1073741824;
        const size = (Number.isInteger(gib) ? gib : gib.toFixed(1)) + " GB";
        if (!withType) {
          return size;
        }
        const shared = f.gpu_shared_bytes
          ? ` (${f.gpu_shared_bytes >= 1073741824 ? (f.gpu_shared_bytes / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB"
            : Math.round(f.gpu_shared_bytes / 1048576) + " MB"} ekran belleği)` : "";
        return (f.mem_type ? `${size} ${f.mem_type}` : size) + shared;
      }
      return f.mem_total_bytes ? ankamon.util.Format.bytes(f.mem_total_bytes) : "";
    },

    /**
     * Wi-Fi kartının etkin olup olmadığı — Bilgi kartı ve Tahtalar grid'inin "Wi-Fi" sütunu aynı
     * kuralı kullanır. Etkin = kart var + NetworkManager radyosu açık + rfkill engeli yok (actions/
     * wifi-on, wifi-off radyoyu değiştirir; runner işlemden sonra facts'i günceller).
     * @return {Map|null} {text, kind} — kind: ok | idle | bad; bilgi hiç toplanmamışsa null
     */
    wifiStatus(f) {
      if (!f || !("wifi_iface" in f)) {
        return null;
      }
      if (!f.wifi_iface) {
        return { text: "Kart yok", kind: "idle" };
      }
      if (f.wifi_blocked === "hard") {
        return { text: "Devre dışı (donanım anahtarı/BIOS)", kind: "bad" };
      }
      if (f.wifi_blocked === "soft" || f.wifi_radio === "disabled") {
        return { text: "Devre dışı", kind: "idle" };
      }
      if (f.wifi_radio === "enabled") {
        return { text: f.wifi_state === "connected" ? "Etkin · bağlı" : "Etkin", kind: "ok" };
      }
      return { text: "Bilinmiyor", kind: "idle" };
    },

    /** Durum rozetinin rengi: ok=yeşil, warn=turuncu, bad=kırmızı, idle=gri. */
    __badge(text, kind) {
      const color = { ok: "#1e8e3e", warn: "#e37400", bad: "#c5221f", idle: "#80868b" }[kind] || "#80868b";
      return `<span style="color:${color};font-weight:bold">●</span> ${qx.bom.String.escape(text)}`;
    },

    // Sensör göstergeleri (bkz. backend Core/BoardSensors.php): [anahtar, etiket, birim, ondalık, uyarı, kritik, alt eşik mi].
    __SENSORS: [
      ["cpu_temp", "İşlemci sıcaklığı", "°C", 0, 70, 85, false],
      ["board_temp", "Anakart sıcaklığı", "°C", 0, 50, 60, false],
      ["acpi_temp", "Kasa içi (ACPI)", "°C", 0, 50, 60, false],
      ["disk_temp", "Disk sıcaklığı", "°C", 0, 50, 60, false],
      ["fan_rpm", "İşlemci fanı", "RPM", 0, null, null, false],
      ["battery_v", "CMOS pili", "V", 2, 2.8, 2.5, true]
    ],

    /**
     * "Sensörler" bölümünün satırları: anlık değer + saklanan geçmişteki en düşük/en yüksek (ve ne zaman).
     * @param sensors {Map|null|undefined} /api/metrics/{id}/sensors yanıtı; undefined = yükleniyor
     */
    __sensorRows(sensors, row) {
      if (sensors === undefined) {
        row("Durum", "Yükleniyor…");
        return;
      }
      const keys = Object.keys(sensors || {});
      if (!keys.length) {
        row("Durum", "Sensör verisi yok (tahta kapalı ya da sensör portu okunamıyor)");
        return;
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      this.__SENSORS.forEach(([key, label, unit, digits, warn, crit, low]) => {
        const s = sensors[key];
        if (!s) {
          return;
        }
        const fmt = v => `${Number(v).toFixed(digits)} ${unit}`;
        const kind = v => warn === null ? "ok"
          : low ? (v <= crit ? "bad" : v <= warn ? "warn" : "ok") : (v >= crit ? "bad" : v >= warn ? "warn" : "ok");
        const when = t => (t ? ` <span style="opacity:.6">(${esc(F.dateTime(t * 1000).slice(0, 16))})</span>` : "");
        const now = s.value === null ? '<span style="opacity:.6">şu an ölçüm yok</span>' : this.__badge(fmt(s.value), kind(s.value));
        const range = s.min === null ? "" : ` &nbsp;·&nbsp; en düşük ${esc(fmt(s.min))}${when(s.min_at)}` +
          ` &nbsp;·&nbsp; en yüksek ${esc(fmt(s.max))}${when(s.max_at)}`;
        row(label, { html: now + range });
      });
      if (!sensors.fan_rpm && !sensors.battery_v) {
        row("Not", "Fan devri, CMOS pili ve anakart sıcaklığı için \"Fan/pil/anakart sensörlerini etkinleştir\" işlemini çalıştırın");
      }
    },

    /**
     * @param sensors {Map|null|undefined} isteğe bağlı sensör özeti (bkz. __sensorRows); verilmezse bölüm yazılmaz
     * @return {String} facts'in bölümlü HTML tablosu
     */
    html(f, sensors) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const sections = [];
      let rows = null;
      const section = title => {
        rows = [];
        sections.push({ title, rows });
      };
      // value: düz metin (kaçırılır) ya da {html} (zaten güvenli HTML). Boşsa satır hiç yazılmaz.
      const row = (label, value) => {
        if (value === null || value === undefined || value === "") {
          return;
        }
        rows.push([label, typeof value === "object" ? value.html : esc(String(value))]);
      };
      const bytes = v => (v ? F.bytes(v) : null);
      const join = (...parts) => parts.filter(p => p !== null && p !== undefined && p !== "").join(" · ");

      section("Sistem");
      row("İşletim sistemi", join(f.os_name, f.arch));
      row("Çekirdek sürümü", f.kernel_version);
      row("TiHA imajı", f.tiha_version
        ? join("sürüm " + f.tiha_version, f.tiha_prepared_at ? "hazırlanma " + F.dateTime(Date.parse(f.tiha_prepared_at)) : null)
        : null);
      row("Açık kalma süresi", f.uptime_seconds ? this.__uptime(f.uptime_seconds) : null);
      row("Ürün", f.product);
      row("Seri numarası", f.serial);

      section("İşlemci");
      row("Üretici", f.cpu_vendor);
      row("Model", f.cpu_model);
      row("Çekirdek", f.cpu_phys_cores
        ? `${f.cpu_phys_cores} fiziksel çekirdek / ${f.cpu_cores || "?"} iş parçacığı`
        : (f.cpu_cores ? `${f.cpu_cores} iş parçacığı` : null));
      row("Azami hız", f.cpu_max_mhz ? `${(f.cpu_max_mhz / 1000).toFixed(2)} GHz` : null);
      // Sensör bölümü varsa işlemci sıcaklığı orada (canlı, en düşük/en yüksekle) — buradaki toplama anı değeri yazılmaz.
      row("Sıcaklık", f.cpu_temp_c && arguments.length < 2
        ? { html: this.__badge(`${f.cpu_temp_c} °C`, f.cpu_temp_c >= 85 ? "bad" : f.cpu_temp_c >= 70 ? "warn" : "ok") }
        : null);

      if (arguments.length > 1) {
        section("Sensörler");
        this.__sensorRows(sensors, row);
      }

      section("Bellek");
      row("RAM", f.mem_installed_bytes || f.mem_total_bytes
        ? join(ankamon.ui.FactsView.ramText(f, false) + (f.mem_type ? ` ${f.mem_type}` : "") +
            (f.mem_speed ? ` ${f.mem_speed}` : "") + (f.mem_modules > 1 ? ` (${f.mem_modules} modül)` : ""),
          f.gpu_shared_bytes ? `ekran belleği ${bytes(f.gpu_shared_bytes)}` : null,
          f.mem_installed_bytes && f.mem_total_bytes ? `sistemde ${bytes(f.mem_total_bytes)}` : null,
          f.mem_available_bytes ? `kullanılabilir ${bytes(f.mem_available_bytes)}` : null)
        : null);
      row("Takas (swap)", f.swap_total_bytes === 0 ? "yok" : bytes(f.swap_total_bytes));

      section("Disk");
      row("Model", join(f.disk_model,
        f.disk_rotational === 0 ? "SSD" : f.disk_rotational === 1 ? "HDD" : null,
        f.disk_transport ? f.disk_transport.toUpperCase() : null));
      row("Kapasite", bytes(f.disk_total_bytes));
      if (f.root_total_bytes && f.root_free_bytes !== null && f.root_free_bytes !== undefined) {
        const freePct = Math.round(100 * f.root_free_bytes / f.root_total_bytes);
        row("Boş alan (/)", {
          html: this.__badge(`${F.bytes(f.root_free_bytes)} boş / ${F.bytes(f.root_total_bytes)} (%${freePct})`,
            freePct < 10 ? "bad" : freePct < 20 ? "warn" : "ok")
        });
      }

      // SMART (hwfacts._smart): sistem diskinin kendi sağlık kaydı. "Genel sağlık" üreticinin eşik
      // değerlendirmesidir; sayaçlar (yeniden atanmış/bekleyen sektör, düzeltilemeyen hata) sıfırdan
      // büyükse disk eşiği geçmemiş olsa da yıpranma başlamıştır — bu yüzden ayrıca uyarılır.
      section("Disk sağlığı (SMART)");
      if (f.smart_health === undefined) {
        row("Durum", "Bu kayıt SMART eklenmeden önce toplanmış — kart yenilenince gelir");
      } else if (!f.smart_health && f.smart_power_on_hours === null) {
        row("Durum", "SMART okunamadı (smartctl yok ya da disk desteklemiyor)");
      } else {
        const counters = [f.smart_reallocated, f.smart_pending, f.smart_uncorrectable].filter(v => v > 0).length;
        row("Genel sağlık", f.smart_health === "failed"
          ? { html: this.__badge("BAŞARISIZ — disk arızalanmak üzere, yedek alıp değiştirin", "bad") }
          : f.smart_health === "passed"
            ? { html: this.__badge(counters ? "Geçti — ama yıpranma işaretleri var (aşağıda)" : "Geçti", counters ? "warn" : "ok") }
            : null);
        if (f.smart_failing) {
          row("Eşiği geçen öznitelik", { html: this.__badge(f.smart_failing, "bad") });
        }
        row("Kalan ömür (SSD)", f.smart_life_left_pct !== null && f.smart_life_left_pct !== undefined
          ? { html: this.__badge(`%${f.smart_life_left_pct}`, f.smart_life_left_pct < 10 ? "bad" : f.smart_life_left_pct < 30 ? "warn" : "ok") }
          : null);
        const count = (label, v) => row(label, v === null || v === undefined ? null
          : { html: this.__badge(Number(v).toLocaleString("tr-TR"), v > 0 ? "warn" : "ok") });
        count("Yeniden atanmış sektör", f.smart_reallocated);
        count("Bekleyen sektör", f.smart_pending);
        count("Düzeltilemeyen hata", f.smart_uncorrectable);
        row("Çalışma süresi", f.smart_power_on_hours !== null && f.smart_power_on_hours !== undefined
          ? join(`${Number(f.smart_power_on_hours).toLocaleString("tr-TR")} saat`,
            f.smart_power_on_hours >= 48 ? `~${Math.round(f.smart_power_on_hours / 24).toLocaleString("tr-TR")} gün` : null)
          : null);
        row("Açılıp kapanma", f.smart_power_cycles !== null && f.smart_power_cycles !== undefined
          ? `${Number(f.smart_power_cycles).toLocaleString("tr-TR")} kez` : null);
        row("Disk sıcaklığı", f.smart_temp_c
          ? { html: this.__badge(`${f.smart_temp_c} °C`, f.smart_temp_c >= 60 ? "bad" : f.smart_temp_c >= 50 ? "warn" : "ok") }
          : null);
      }

      section("Kablolu ağ");
      row("Arayüz", f.eth_iface ? join(f.eth_iface, f.eth_chip) : null);
      row("Durum", f.eth_state
        ? { html: this.__badge(join(f.eth_state === "up" ? "Bağlı" : "Bağlı değil", f.eth_speed_mbps ? `${f.eth_speed_mbps} Mbit/sn` : null),
          f.eth_state === "up" ? "ok" : "idle") }
        : null);
      row("IP adresi", f.eth_ip);

      section("Kablosuz ağ (Wi-Fi)");
      if (!f.wifi_iface) {
        row("Kart", "Wi-Fi kartı bulunamadı");
      } else {
        const status = this.wifiStatus(f);
        row("Wi-Fi", status ? { html: this.__badge(status.text, status.kind) } : null);
        row("Kart", f.wifi_chip);
        row("Arayüz / sürücü", join(f.wifi_iface, f.wifi_driver));
        row("MAC adresi", f.wifi_mac);
        const state = this.WIFI_STATE[f.wifi_state] || f.wifi_state;
        if (f.wifi_state === "connected") {
          row("Durum", {
            html: this.__badge(join("Bağlı", f.wifi_ssid ? `"${f.wifi_ssid}"` : null,
              f.wifi_signal ? `sinyal %${f.wifi_signal}` : null,
              f.wifi_freq ? (Number(f.wifi_freq) >= 5000 ? "5 GHz" : "2,4 GHz") : null), "ok")
          });
          row("IP adresi", f.wifi_ip);
        } else if (state) {
          row("Durum", { html: this.__badge(state, "idle") });
        }
        row("Görünen ağlar", f.wifi_visible !== null && f.wifi_visible !== undefined ? `${f.wifi_visible} ağ` : null);
      }

      section("Ekran ve giriş");
      row("Grafik birimi", f.gpu);
      row("Bağlı ekran", f.screens || null);
      row("Dokunmatik", f.touch);

      section("Anakart / BIOS");
      row("Anakart", f.motherboard_model);
      row("BIOS sürümü", join(f.bios_version, f.bios_date));

      const body = sections
        .filter(s => s.rows.length)
        .map(s => `<tr><td colspan="2" style="${this.__SECTION}">${esc(s.title)}</td></tr>` +
          s.rows.map(([k, v]) => `<tr><td style="${this.__KEY}">${esc(k)}</td><td style="${this.__VAL}">${v}</td></tr>`).join(""))
        .join("");
      return `<table style="${this.__TABLE}">${body}</table>`;
    }
  }
});
