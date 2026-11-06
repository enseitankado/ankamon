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
 * Wi-Fi Monitör: sensörlerin (seçili tahtaların) duyduğu vericileri "güvenilir" (sabit) listesine ve telefon kanıtlarına göre
 * ayırır (bkz. ui.boards.WifiMonitor).
 *
 * Düzeyler (öne çıkma sırasıyla): phone (güvenilir değil + güçlü telefon kanıtı), maybe (güvenilir değil + zayıf kanıt),
 * foreign (güvenilir değil, kanıt yok), common (güvenilir değil ama AYNI erişim noktası — aynı MAC/BSSID — sensörlerin çoğunca
 * duyuluyor: okulun AP'si olası), fixed (güvenilir listesinde, sensörün bağlı olduğu ağ ya da bir Ankamon tahtasının kendisi).
 * Güven ve ortaklık yalnız MAC adresiyle kurulur (kullanıcı isteği 2026-11-06): aynı adı taşıyan bir telefon paylaşım noktası
 * okulun ağı sayılmaz. Eski "ağ adı" (ssid) güven kayıtları uygulanmaz (Güvenilir listesinde eski kayıt olarak görünür).
 * Telefon kanıtları worker'dan gelir (screen/wifimon_phone_hints.py).
 */
qx.Class.define("ankamon.ui.boards.WifimonClassify", {
  type: "static",

  statics: {
    LEVEL_ORDER: { phone: 0, maybe: 1, foreign: 2, common: 3, fixed: 4 },

    /** Güvenilir listesinden arama dizini: "tür|değer|tahta" (tahta 0 = okul geneli). */
    index(fixed) {
      const map = new Map();
      (fixed || []).forEach(f => map.set(`${f.kind}|${f.value}|${f.board_id || 0}`, f));
      return map;
    },

    /** Satırın değişmeyen anahtarı ("yeni" takibi ve grid satır kimliği): rastgele adresli yoklamada adres değil parmak izi. */
    rowKey(row) {
      if (row.kind === "probe" && row.random && row.fp) {
        return "probe-fp|" + row.fp;
      }
      return row.kind + "|" + row.addr;
    },

    /**
     * Satırın uyduğu güven kaydı (yoksa null) — yalnız MAC ile: AP → "bssid", ağ arayan/bağlı cihaz → "probe" (cihaz adresi;
     * aynı cihaz iki durumda da görülebilir). Önce bu sensöre (sınıfa) özgü, sonra okul geneli kayıt.
     */
    fixedEntry(row, boardId, index) {
      const kind = row.kind === "wifi" ? "bssid" : "probe";
      const value = row.addr;
      return value ? index.get(`${kind}|${value}|${boardId}`) || index.get(`${kind}|${value}|0`) || null : null;
    },

    /**
     * Adres → onu duyan sensörler [{id, name, signal}] (verisi gelmiş bütün sensörlerden; rastgele adresli yoklama hariç —
     * adresi dakikalar içinde değişir). "x sensörde" kanıtı ve "Ortak" düzeyi buna dayanır (ağ adına değil).
     */
    hearers(feeds) {
      const map = new Map();
      feeds.forEach(feed => {
        const rows = ((feed.data && feed.data.rows) || []).concat(Array.from((feed.probes || new Map()).values()).map(p => p.row));
        rows.forEach(row => {
          if (!row.addr || (row.kind === "probe" && row.random)) {
            return;
          }
          const list = map.get(row.addr) || [];
          if (!list.some(h => h.id === feed.board.id)) {
            list.push({ id: feed.board.id, name: feed.name, signal: row.signal });
            map.set(row.addr, list);
          }
        });
      });
      return map;
    },

    /**
     * Bir sensörün görünüm modeli: sınıflanmış satırlar ve düzey sayıları.
     * @param feed {Map} sensör durumu (data: son tarama, probes: Map anahtar → {row, at})
     * @param hearers {Map} hearers() sonucu
     * @param sensorCount {Integer} verisi gelmiş sensör sayısı ("Ortak" eşiği için)
     */
    board(feed, index, hearers, sensorCount, now) {
      const rows = [];
      const add = (row, extra) => {
        const fixed = this.fixedEntry(row, feed.board.id, index);
        const key = this.rowKey(row);
        const heard = (row.addr && hearers.get(row.addr)) || [];
        let level;
        if (fixed || row.active || row.board_name) {
          level = "fixed";
        } else if (row.phone === "yes") {
          level = "phone";
        } else if (row.kind === "wifi" && heard.length >= 3 && heard.length >= Math.ceil(sensorCount / 2)) {
          level = "common";
        } else {
          level = row.phone === "maybe" ? "maybe" : "foreign";
        }
        const firstSeenRecently = row.first_seen && now / 1000 - row.first_seen < 86400 && (row.seen_days || 1) <= 1;
        const appeared = feed.initialKeys && !feed.initialKeys.has(key);
        rows.push(Object.assign({ key, level, fixed, heard, isNew: level !== "fixed" && !!(firstSeenRecently || appeared) },
          extra || {}, { row }));
      };
      ((feed.data && feed.data.rows) || []).filter(row => row.kind === "wifi").forEach(row => add(row, { lastAt: feed.data.at * 1000 }));
      (feed.probes || new Map()).forEach(p => add(p.row, { lastAt: p.at }));
      const counts = { phone: 0, maybe: 0, foreign: 0, common: 0, fixed: 0 };
      rows.forEach(r => counts[r.level]++);
      return { rows, counts };
    },

    /** Sinyal yüzdesinden kaba yakınlık (duvar, gövde ve anten yönü ölçümü saptırır; yalnız ipucu). */
    proximity(signal) {
      if (signal === null || signal === undefined) {
        return "";
      }
      return signal >= 70 ? "çok yakın" : signal >= 45 ? "yakın" : signal >= 25 ? "orta" : "uzak";
    }
  }
});
