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

    /**
     * Satırın değişmeyen anahtarı ("yeni" takibi ve grid satır kimliği): rastgele adresli yoklamada adres değil cihaz
     * anahtarı (worker'ın dev'i: WPS kimliği > ağ listesi > parmak izi; eski worker'da parmak izi).
     */
    rowKey(row) {
      if (row.kind === "probe" && row.random && (row.dev || row.fp)) {
        return row.dev ? "probe-dev|" + row.dev : "probe-fp|" + row.fp;
      }
      return row.kind + "|" + row.addr;
    },

    /** Birleştirme gerekçeleri (worker screen/wifimon_probe_merge.py REASON_TEXT ile aynı kodlar). */
    MERGE_REASON: {
      wps: "aynı WPS kimliği (UUID-E)",
      ssid: "aynı ağ listesi",
      seq: "sıra numarası sürekliliği",
      fp: "aynı yetenek parmak izi ve yakın sinyal"
    },

    /**
     * Ardışık dinlemelerde rastgele adresli iki yoklama satırı aynı cihaz mı? Gerekçe kodu ya da "". Worker bir dinleme
     * içinde birleştirir (wifimon_probe_merge.same_device); telefon sonraki taramada yine yeni adres alır, burada aynı
     * ölçütler sürer (sıra numarası dinlemeler arasında taşınmaz): WPS kimliği, ağ listesi (biri ötekini kapsar; tek ortak ağda
     * yakın sinyal şartı), ortak parmak izi + yakın sinyal (ağ listeleri çelişmiyorsa).
     */
    sameProbeDevice(a, b) {
      if (!(a.kind === "probe" && a.random && b.kind === "probe" && b.random)) {
        return "";
      }
      const wa = (a.wps || {}).uuid;
      const wb = (b.wps || {}).uuid;
      if (wa && wb) {
        return wa === wb ? "wps" : "";
      }
      if (a.dev && a.dev === b.dev) {
        return a.dev.startsWith("f:") ? (this.__near(a, b) ? "fp" : "") : a.dev.startsWith("w:") ? "wps" : "ssid";
      }
      const sa = new Set(a.ssids || []);
      const sb = new Set(b.ssids || []);
      if (sa.size && sb.size) {
        const common = [...sa].filter(x => sb.has(x)).length;
        if (common !== Math.min(sa.size, sb.size)) {
          return ""; // listeler çelişiyor: farklı kayıtlı ağlar, farklı cihaz
        }
        return common >= 2 || this.__near(a, b) ? "ssid" : "";
      }
      const fa = a.fps && a.fps.length ? a.fps : [a.fp];
      const fb = new Set(b.fps && b.fps.length ? b.fps : [b.fp]);
      return fa.some(f => f && fb.has(f)) && this.__near(a, b) ? "fp" : "";
    },

    /** En güçlü sinyaller yakın mı (≤ 12 dB — worker SIGNAL_NEAR_DB). */
    __near(a, b) {
      return typeof a.rssi === "number" && typeof b.rssi === "number" && Math.abs(a.rssi - b.rssi) <= 12;
    },

    /**
     * Yeni dinlemenin rastgele adresli yoklama satırını önceki dinlemelerden aynı cihaz sayılan satırla birleştirir:
     * adresler, ağlar, parmak izleri ve gerekçeler birikir; sinyal ve diğer alanlar yeni satırdan. Yeni nesne döner.
     */
    mergeProbeRows(old, row, why) {
      const union = (x, y, max) => Array.from(new Set((x || []).concat(y || []))).slice(0, max);
      const merged = Object.assign({}, row, {
        addrs: union(old.addrs || [old.addr], row.addrs || [row.addr], 32),
        ssids: union(old.ssids, row.ssids, 12),
        fps: union(old.fps || [old.fp], row.fps || [row.fp], 8).filter(Boolean),
        why: union(old.why, (row.why || []).concat(why ? [why] : []), 4),
        wps: row.wps || old.wps
      });
      merged.dev = old.dev || row.dev;
      return merged;
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
      // Aynı sensörde aynı cihaz tek satır (kullanıcı isteği 2026-11-10): adresleri kesişen satırlar (ör. hem arayan hem bağlı
      // görülen MAC, birleşmiş rastgele adreslerden biri) birleşir; farklı sensörlerde ayrı satır kalır.
      const items = [];
      const byAddr = new Map();
      const push = (row, lastAt) => {
        const addrs = ((row.addrs && row.addrs.length ? row.addrs : [row.addr]) || []).filter(Boolean);
        const hit = addrs.map(a => byAddr.get(a)).find(i => i !== undefined);
        if (hit === undefined) {
          const i = items.push({ row, lastAt }) - 1;
          addrs.forEach(a => byAddr.set(a, i));
          return;
        }
        items[hit] = this.__mergeSameDevice(items[hit], { row, lastAt });
        addrs.forEach(a => byAddr.set(a, hit));
      };
      ((feed.data && feed.data.rows) || []).filter(row => row.kind === "wifi").forEach(row => push(row, feed.data.at * 1000));
      (feed.probes || new Map()).forEach(p => push(p.row, p.at));
      items.forEach(it => add(it.row, { lastAt: it.lastAt }));
      const counts = { phone: 0, maybe: 0, foreign: 0, common: 0, fixed: 0 };
      rows.forEach(r => counts[r.level]++);
      return { rows, counts };
    },

    /**
     * Aynı sensörde aynı cihazın iki satırı ({row, lastAt}) → tek satır. Taban satır türü önceliğe göre (Wi-Fi ağı > bağlı
     * cihaz > arayan cihaz); öteki türün bilgisi eklenir: also (diğer türler), ssids/addrs/hints birleşimi, probeCount
     * (bağlı satırda yoklama sayısı), en güçlü telefon kanıtı ve sinyal, en son görülme.
     */
    __mergeSameDevice(a, b) {
      const rank = { wifi: 0, client: 1, probe: 2 };
      const [base, other] = (rank[a.row.kind] ?? 3) <= (rank[b.row.kind] ?? 3) ? [a, b] : [b, a];
      const x = base.row;
      const y = other.row;
      const union = (p, q, max) => Array.from(new Set((p || []).concat(q || []))).slice(0, max || 32);
      const sameKind = x.kind === y.kind;
      const row = Object.assign({}, x, {
        also: union(x.also, sameKind ? y.also : [y.kind].concat(y.also || [])).filter(k => k !== x.kind),
        ssids: union(x.ssids, y.ssids, 12),
        hints: union(x.hints, y.hints, 12),
        phone: x.phone === "yes" || y.phone === "yes" ? "yes" : x.phone || y.phone,
        signal: Math.max(x.signal ?? -1, y.signal ?? -1) >= 0 ? Math.max(x.signal ?? -1, y.signal ?? -1) : x.signal,
        vendor: x.vendor || y.vendor,
        wps: x.wps || y.wps
      });
      if (x.addrs || y.addrs) {
        row.addrs = union(x.addrs || [x.addr], y.addrs || [y.addr]);
        row.why = union(x.why, y.why, 4);
      }
      if (sameKind) {
        row.count = (x.count || 0) + (y.count || 0);
      } else if (y.kind === "probe") {
        row.probeCount = (x.probeCount || 0) + (y.count || 0);
      }
      return { row, lastAt: Math.max(base.lastAt || 0, other.lastAt || 0) };
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
