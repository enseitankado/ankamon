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

/** Görüntüleme yardımcıları: zaman, yüzde, syslog önem dereceleri. */
qx.Class.define("ankamon.util.Format", {
  type: "static",

  statics: {
    SEVERITIES: ["Acil", "Alarm", "Kritik", "Hata", "Uyarı", "Bildirim", "Bilgi", "Ayrıntı"],

    JOB_STATUS: {
      queued: "Sırada",
      running: "Çalışıyor",
      done: "Tamamlandı",
      failed: "Başarısız",
      ok: "Başarılı",
      unreachable: "Ulaşılamadı"
    },

    // Tahta oturumlarının nasıl kapandığı (bkz. worker/ankamon/tasks/board_sessions.py).
    SESSION_END_REASON: {
      logout: "Çıkış yapıldı",
      offline: "Bağlantı kesildi (tahta çevrimdışı oldu)",
      // Tahta yeniden erişilebilir olunca açılış günlüğünden netleşenler (bkz. worker tasks/session_end.py, göç 023);
      // grid ayrıntılı metni (end_detail, ör. "20 dk işlem yapılmadı") varsa onu gösterir.
      shutdown: "Tahta kapatıldı",
      reboot: "Tahta yeniden başlatıldı",
      auto_idle: "Otomatik kapandı (işlem yapılmadı)",
      auto_timed: "Otomatik kapandı (zamanlı)",
      power_loss: "Elektrik kesintisi / zorla kapatma",
      network: "Ağ bağlantısı kesildi (tahta kapanmadı)",
      superseded: "Kapanmadan yeni oturum açıldı",
      // Web terminal oturumları (bkz. db/migrations/011_webshell_sessions.sql)
      closed: "Kapatıldı",
      restart: "Web terminal hizmeti yeniden başladı"
    },

    severity(level) {
      return this.SEVERITIES[level] || "";
    },

    jobStatus(status) {
      return this.JOB_STATUS[status] || status;
    },

    /** @param reason {String|null} end_reason; null + açık oturum → "Açık" */
    sessionEndReason(reason) {
      return reason ? (this.SESSION_END_REASON[reason] || reason) : "Açık";
    },

    /**
     * ETAP faz bilgisinin grid metni (bkz. worker netscan/etap_phase.py, migration 017): "Faz 2 · Vestel",
     * "Faz 3 · Arçelik? (tahmin)", ETAP'a kayıtlı ama tahta olduğu bilinmeyen cihazda "ETAP cihazı".
     * "(tahmin)": faz eşlemesi çıkarım (doğrulanmadı) ya da yalnız MAC önekinden (donanım okunmadı).
     * Faz 2'de marka yerine işlemci üreticisi yazılır (kullanıcı isteği): "Faz 2 - Intel" / "Faz 2 - AMD" —
     * Faz 2 tahtalarının Intel ve AMD sürümleri ayrı bakım/sürücü ister. Kaynak önce tahtanın okunan
     * işlemcisi (cpu: boards.facts.cpu_model), yoksa faz kaydındaki işlemci; ikisi de yoksa marka.
     * @param info {Map|null} boards.etap / net_devices.etap
     * @param cpu {String?} okunan işlemci adı
     */
    etap(info, cpu) {
      if (!info) {
        return "";
      }
      if (!info.tahta) {
        return "ETAP cihazı";
      }
      const faz = info.faz ? `Faz ${info.faz}` : "Faz ?";
      const vendor = String(info.faz) === "2" ? this.cpuVendor(cpu || info.islemci) : null;
      const text = vendor ? `${faz} - ${vendor}` : (info.marka ? `${faz} · ${info.marka}` : faz);
      return text + (info.guven === "cikarim" ? " (tahmin)" : "");
    },

    /** İşlemci adından üretici: "Intel" / "AMD" ya da null. */
    cpuVendor(cpu) {
      const c = String(cpu || "");
      return /\bintel\b|intel\(r\)/i.test(c) ? "Intel" : (/\bamd\b/i.test(c) ? "AMD" : null);
    },

    /** @param seconds {Number} süre (saniye); "2 sa 14 dk" / "37 dk" / "12 sn" biçiminde döner */
    duration(seconds) {
      seconds = Math.max(0, Math.round(seconds));
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h) {
        return `${h} sa ${m} dk`;
      }
      if (m) {
        return `${m} dk`;
      }
      return `${seconds} sn`;
    },

    /**
     * Uzun süreler için: "1 ay 4 gün 17 saat 20 dk" — 0 olan birimler yazılmaz (ay = 30 gün, hafta = 7 gün);
     * bir dakikadan kısa ise saniye. worker anomaly/no_login._span ile aynı biçim.
     * @param seconds {Number}
     */
    span(seconds) {
      seconds = Math.max(0, Math.round(seconds));
      if (seconds < 60) {
        return `${seconds} sn`;
      }
      let minutes = Math.floor(seconds / 60);
      const parts = [];
      [[43200, "ay"], [10080, "hafta"], [1440, "gün"], [60, "saat"], [1, "dk"]].forEach(([size, unit]) => {
        const n = Math.floor(minutes / size);
        minutes -= n * size;
        if (n) {
          parts.push(`${n} ${unit}`);
        }
      });
      return parts.join(" ");
    },

    /** @param ms {Number} epoch milisaniye */
    dateTime(ms) {
      if (!ms) {
        return "";
      }
      return new Date(ms).toLocaleString("tr-TR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    },

    /** @param seconds {Number} epoch saniye; "3 dk önce" biçiminde döner */
    ago(seconds) {
      if (!seconds) {
        return "—";
      }
      const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
      if (diff < 90) {
        return "az önce";
      }
      if (diff < 3600) {
        return Math.floor(diff / 60) + " dk önce";
      }
      if (diff < 86400) {
        return Math.floor(diff / 3600) + " saat önce";
      }
      return Math.floor(diff / 86400) + " gün önce";
    },

    percent(value) {
      return value === null || value === undefined ? "" : "%" + Math.round(value);
    },

    bytes(value) {
      const units = ["B", "KB", "MB", "GB", "TB"];
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
      }
      return value.toFixed(index ? 1 : 0) + " " + units[index];
    }
  }
});
