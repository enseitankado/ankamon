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
 * Ankamon'un dışarıya açtığı SSH bağlantıları (kullanıcı isteği 2026-11-10) — /api/ssh-activity'yi artımlı (inode +
 * bayt konumu) yoklayan ortak depo. Alt çubuktaki SSH paneli (sayılar) ve ui.ssh.ActivityWindow (grid) aynı veriyi
 * kullanır; yoklama yalnız abone varken çalışır, aralık en hızlı abonenin istediğidir (pencere açıkken ~1,5 sn).
 *
 * Bağlantı: {key, pid, start, end, lost, src, tool, target, port, tunnel, cmd, name}. Kaynak satırları sunucuda
 * sshpass sarmalayıcısı, sshfs ve webssh kancası yazar (bkz. backend SshActivityApi).
 */
qx.Class.define("ankamon.ui.ssh.ActivityStore", {
  extend: qx.core.Object,
  type: "singleton",

  events: {
    /** Bağlantı listesi değişti. */
    changed: "qx.event.type.Event"
  },

  statics: {
    /** Bellekte tutulan en çok bağlantı (en eskiler düşer; açık olanlar düşmez). */
    MAX: 3000
  },

  construct() {
    super();
    this.__conns = new Map();
    this.__names = {};
    this.__subs = new Map();
    this.__timer = new qx.event.Timer(3000);
    this.__timer.addListener("interval", this.__poll, this);
  },

  members: {
    __conns: null,
    __names: null,
    __subs: null,
    __timer: null,
    __ino: null,
    __off: null,
    __busy: false,
    __failed: false,
    __clearedAt: 0,

    /**
     * Yoklamaya abone ol. @param owner {Object} @param intervalMs {Number}
     */
    subscribe(owner, intervalMs) {
      this.__subs.set(owner, intervalMs);
      this.__retime();
      if (!this.__timer.getEnabled()) {
        this.__timer.start();
      }
      this.__poll();
    },

    unsubscribe(owner) {
      this.__subs.delete(owner);
      if (!this.__subs.size) {
        this.__timer.stop();
      } else {
        this.__retime();
      }
    },

    __retime() {
      const ms = Math.min(...this.__subs.values());
      if (this.__timer.getInterval() !== ms) {
        this.__timer.setInterval(ms);
      }
    },

    /** Bağlantılar, en yeni önce (Temizle'den önce bitenler hariç). */
    getConnections() {
      return [...this.__conns.values()]
        .filter(c => !(c.end && c.end < this.__clearedAt))
        .sort((a, b) => b.start - a.start || String(b.pid).localeCompare(String(a.pid)));
    },

    /** Hedef IP → tahta/varlık adı. */
    nameOf(target) {
      const ip = String(target || "").split("@").pop();
      return this.__names[ip] || "";
    },

    /** "Temizle": o ana dek BİTMİŞ bağlantılar listeden kalkar (açık olanlar kalır). */
    clearFinished() {
      this.__clearedAt = Math.floor(Date.now() / 1000) + 1;
      this.fireEvent("changed");
    },

    /** Yetki yoksa (yönetici değil) ya da sunucu hatası: true. */
    hasFailed() {
      return this.__failed;
    },

    async __poll() {
      if (this.__busy) {
        return;
      }
      this.__busy = true;
      try {
        const params = {};
        if (this.__off !== null) {
          params.ino = this.__ino;
          params.off = this.__off;
          // Açık sandığımız (bitiş satırı gelmemiş) sarmalayıcı süreçleri: sunucu yaşamıyorsa "kayıp" der.
          const open = [];
          this.__conns.forEach(c => {
            if (!c.end && /^\d+$/.test(String(c.pid))) {
              open.push(c.key);
            }
          });
          if (open.length) {
            params.open = open.slice(-400).join(",");
          }
        }
        let res;
        try {
          res = await ankamon.io.Api.get("/ssh-activity", params);
        } catch (e) {
          this.__failed = true;
          return;
        }
        this.__failed = false;
        this.__ino = res.ino;
        this.__off = res.off;
        Object.assign(this.__names, res.names || {});
        let changed = false;
        (res.events || []).forEach(ev => {
          if (ev.ev === "start") {
            const key = ev.pid + ":" + ev.ts;
            if (!this.__conns.has(key)) {
              this.__conns.set(key, {
                key, pid: ev.pid, start: ev.ts, end: null, lost: false, src: ev.src || "", tool: ev.tool || "",
                target: ev.target || "", port: ev.port || "", tunnel: ev.tunnel || "", cmd: ev.cmd || ""
              });
              changed = true;
            }
          } else if (ev.ev === "end") {
            const conn = this.__conns.get(ev.pid + ":" + ev.start);
            if (conn && !conn.end) {
              conn.end = ev.ts;
              changed = true;
            }
          }
        });
        (res.gone || []).forEach(key => {
          const conn = this.__conns.get(key);
          if (conn && !conn.end) {
            conn.end = res.now || Math.floor(Date.now() / 1000);
            conn.lost = true;
            changed = true;
          }
        });
        if (this.__conns.size > ankamon.ui.ssh.ActivityStore.MAX) {
          const finished = [...this.__conns.values()].filter(c => c.end).sort((a, b) => a.start - b.start);
          finished.slice(0, this.__conns.size - ankamon.ui.ssh.ActivityStore.MAX).forEach(c => this.__conns.delete(c.key));
          changed = true;
        }
        if (changed) {
          this.fireEvent("changed");
        }
      } finally {
        this.__busy = false;
      }
    }
  }
});
