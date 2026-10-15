/** Görüntüleme yardımcıları: zaman, yüzde, syslog önem dereceleri. */
qx.Class.define("tihamon.util.Format", {
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

    // Tahta oturumlarının nasıl kapandığı (bkz. worker/tihamon/tasks/board_sessions.py).
    SESSION_END_REASON: {
      logout: "Çıkış yapıldı",
      offline: "Bağlantı kesildi (tahta çevrimdışı oldu)",
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
