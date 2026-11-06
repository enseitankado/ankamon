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
 * Wi-Fi Monitör: tahtaların duyduğu vericileri "sabit" listesine ve telefon kanıtlarına göre ayırır (bkz. ui.boards.WifiMonitor).
 *
 * Düzeyler (öne çıkma sırasıyla): phone (sabit değil + güçlü telefon kanıtı), maybe (sabit değil + zayıf kanıt), foreign
 * (sabit değil, kanıt yok), common (sabit değil ama aynı ağ adı seçili tahtaların çoğunda — okul ağı olası), fixed (sabit
 * listesinde ya da tahtanın kendi bağlı olduğu ağ). Telefon kanıtları worker'dan gelir (screen/wifimon_phone_hints.py).
 */
qx.Class.define("ankamon.ui.boards.WifimonClassify", {
  type: "static",

  statics: {
    LEVEL_ORDER: { phone: 0, maybe: 1, foreign: 2, common: 3, fixed: 4 },

    /** Sabit listesinden arama dizini: "tür|değer|tahta" (tahta 0 = bütün tahtalar). */
    index(fixed) {
      const map = new Map();
      (fixed || []).forEach(f => map.set(`${f.kind}|${f.value}|${f.board_id || 0}`, f));
      return map;
    },

    /** Satırın değişmeyen anahtarı ("yeni" takibi için): rastgele adresli yoklamada adres değil parmak izi. */
    rowKey(row) {
      if (row.kind === "probe" && row.random && row.fp) {
        return "probe-fp|" + row.fp;
      }
      return row.kind + "|" + row.addr;
    },

    /** Satırın uyduğu sabit kaydı (yoksa null). */
    fixedEntry(row, boardId, index) {
      const find = (kind, value) => value ? index.get(`${kind}|${value}|${boardId}`) || index.get(`${kind}|${value}|0`) || null : null;
      if (row.kind === "wifi") {
        return find("bssid", row.addr) || find("ssid", row.name);
      }
      // Ağ arayan ve Wi-Fi'ye bağlı cihaz aynı "probe" (cihaz adresi) kaydına uyar: aynı cihaz iki durumda da görülebilir.
      return find(row.kind === "bt" ? "bt" : "probe", row.addr);
    },

    /**
     * Ağ adı → onu duyan tahta sayısı (yalnız verisi gelmiş tahtalar). Seçili tahtaların en az yarısı ve en az 3 tahta
     * aynı adı duyuyorsa ad "ortak" sayılır: okulun ağı olması olasıdır, telefon paylaşım noktası nadiren bu kadar yayılır.
     */
    commonSsids(feeds) {
      const seen = new Map();
      let withData = 0;
      feeds.forEach(feed => {
        if (!feed.data) {
          return;
        }
        withData++;
        new Set(feed.data.rows.filter(r => r.kind === "wifi" && r.name).map(r => r.name)).forEach(name => seen.set(name, (seen.get(name) || 0) + 1));
      });
      const common = new Map();
      seen.forEach((count, name) => {
        if (count >= 3 && count >= Math.ceil(withData / 2)) {
          common.set(name, count);
        }
      });
      return common;
    },

    /**
     * Bir tahtanın görünüm modeli: sınıflanmış satırlar (öne çıkma, sonra sinyal sırasıyla) ve düzey sayıları.
     * @param feed {Map} tahta durumu (data: son tarama, probes: Map anahtar → {row, at})
     */
    board(feed, index, common, now) {
      const rows = [];
      const add = (row, extra) => {
        const fixed = this.fixedEntry(row, feed.board.id, index);
        const key = this.rowKey(row);
        let level;
        if (fixed || row.active || row.board_name) { // board_name: cihaz bir Ankamon tahtasının kendisi (worker eşler)
          level = "fixed";
        } else if (row.phone === "yes") {
          level = "phone";
        } else if (row.kind === "wifi" && row.name && common.has(row.name)) {
          level = "common";
        } else {
          level = row.phone === "maybe" ? "maybe" : "foreign";
        }
        const firstSeenRecently = row.first_seen && now / 1000 - row.first_seen < 86400 && (row.seen_days || 1) <= 1;
        const appeared = feed.initialKeys && !feed.initialKeys.has(key);
        rows.push(Object.assign({ key, level, fixed, isNew: level !== "fixed" && !!(firstSeenRecently || appeared),
          commonCount: row.kind === "wifi" ? common.get(row.name) || 0 : 0 }, extra || {}, { row }));
      };
      ((feed.data && feed.data.rows) || []).forEach(row => add(row));
      (feed.probes || new Map()).forEach(p => add(p.row, { lastAt: p.at }));
      rows.sort((a, b) => this.LEVEL_ORDER[a.level] - this.LEVEL_ORDER[b.level] ||
        (b.row.signal ?? -1) - (a.row.signal ?? -1));
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
