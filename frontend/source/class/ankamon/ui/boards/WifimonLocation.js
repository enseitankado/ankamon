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
 * Wi-Fi Monitör güvenilir vericilerinin fiziksel konumu (kullanıcı isteği 2026-11-11): sensör (tahta) başına bant bant sinyal
 * istatistiğinden (GET /api/wifimon/locations — worker screen/wifimon_signal_log.py, göç 050) "hangi sensörün yanında" önerisi.
 * Güvenilir cihazlar bir sensörün birkaç metre yakınında sabittir; kullanıcı öneriye bakıp Güvenilir listesi penceresinde açılır
 * listeden sensörü seçer (ui.boards.WifimonFixedDialog).
 *
 * Fiziksel cihaz: erişim noktası her radyosu (2,4 / 5 GHz) ve ağı için ayrı adres yayınlar; adresin yalnız son baytı değişir
 * (ör. Edgecore CC:37:AB:41:AC:B0 2,4 GHz + …:AC:A0 5 GHz). Erişim noktasında ilk 5 bayt aynı adresler tek cihaz sayılır
 * (kestirim: ardışık adres bloklu iki cihaz da birleşebilir — pencerede adresler görünür). Wi-Fi cihazında (bağlı/arayan) adres tek.
 *
 * Puan: sensörün o cihazı duyduğu bantların ortalama dBm'i; 5 GHz'e +7 dB, 6 GHz'e +9 dB eklenir (aynı uzaklıkta serbest uzay
 * kaybı farkı: 20·log10(5,5/2,44) ≈ 7 dB) ve en yükseği alınır. 5 GHz duvar/kapıdan çok daha fazla zayıfladığından bir sensörün
 * 5 GHz'i 2,4 GHz kadar güçlü duyması aynı oda / görüş hattı işaretidir — ipucunda ayrıca belirtilir.
 */
qx.Class.define("ankamon.ui.boards.WifimonLocation", {
  type: "static",

  statics: {
    BAND_OFFSET: { "2.4": 0, "5": 7, "6": 9, "?": 0 },
    BAND_LABEL: { "2.4": "2,4 GHz", "5": "5 GHz", "6": "6 GHz", "?": "bant ?" },
    /** Bir bandın puana girmesi için en az ölçüm sayısı (tek tarama gürültülü). */
    MIN_SAMPLES: 3,
    /** Önerinin "yeterli veri" sayılması için en iyi sensördeki toplam ölçüm. */
    ENOUGH_SAMPLES: 10,

    /** Fiziksel cihaz anahtarı: erişim noktasında ilk 5 bayt, Wi-Fi cihazında adresin kendisi. */
    groupKey(kind, addr) {
      const a = String(addr || "").toUpperCase();
      return kind === "bssid" ? a.slice(0, 14) : a;
    },

    /** Sensörün açılır listedeki adı: kod adı (tahta takma adı); yoksa bilgisayar adı / kablolu MAC. */
    sensorName(s) {
      if (!s) {
        return "?";
      }
      return s.label || [s.hostname || s.ip || "#" + s.id, s.mac ? s.mac.toUpperCase() : ""].filter(Boolean).join(" / ");
    },

    /** İstatistik satırlarından (index sonucu) bu fiziksel cihazınkiler. */
    groupStats(kind, addr, stats) {
      const key = this.groupKey(kind, addr);
      return (stats || []).filter(s => this.groupKey(kind, s.addr) === key);
    },

    /**
     * Cihazın sensör sıralaması: [{boardId, bands: {bant: {n, nEst, avg, sd, min, max, last, chan, addrs}}, score, n}],
     * puana göre azalan. Aynı bantta birden çok adres (ör. aynı radyonun iki ağı) ölçüm sayısıyla ağırlıklı birleşir.
     */
    rank(rows) {
      const bySensor = new Map();
      rows.forEach(r => {
        const s = bySensor.get(r.board_id) || { boardId: r.board_id, bands: {}, n: 0 };
        const b = s.bands[r.band] || { n: 0, nEst: 0, sum: 0, sumSq: 0, min: null, max: null, last: null, lastTs: 0, chan: "", addrs: [] };
        const sd = r.sd || 0;
        b.n += r.n;
        b.nEst += r.n_est || 0;
        b.sum += r.avg * r.n;
        b.sumSq += (sd * sd + r.avg * r.avg) * r.n;
        b.min = b.min === null ? r.min : Math.min(b.min, r.min);
        b.max = b.max === null ? r.max : Math.max(b.max, r.max);
        if (r.last_ts >= b.lastTs) {
          b.lastTs = r.last_ts;
          b.last = r.last;
          b.chan = r.chan || b.chan;
        }
        b.addrs.push(r.addr);
        s.bands[r.band] = b;
        s.n += r.n;
        bySensor.set(r.board_id, s);
      });
      const out = [];
      bySensor.forEach(s => {
        let score = null;
        let weak = null;
        Object.entries(s.bands).forEach(([band, b]) => {
          b.avg = Math.round(b.sum / b.n * 10) / 10;
          b.sd = Math.round(Math.sqrt(Math.max(0, b.sumSq / b.n - (b.sum / b.n) ** 2)) * 10) / 10;
          const adj = b.avg + (this.BAND_OFFSET[band] || 0);
          if (b.n >= this.MIN_SAMPLES) {
            score = score === null ? adj : Math.max(score, adj);
          } else {
            weak = weak === null ? adj : Math.max(weak, adj);
          }
        });
        s.lowData = score === null;
        s.score = score === null ? weak : score;
        out.push(s);
      });
      return out.sort((a, b) => (a.lowData - b.lowData) || (b.score - a.score) || (b.n - a.n));
    },

    /** Öneri: {boardId, level ("güçlü"/"orta"/"zayıf"/"veri az"), margin (dB), text, tip} ya da null (veri yok). */
    suggest(ranked, sensorsById) {
      if (!ranked.length) {
        return null;
      }
      const [top, second] = ranked;
      const margin = second && second.score !== null && top.score !== null ? Math.round((top.score - second.score) * 10) / 10 : null;
      const name = this.sensorName(sensorsById.get(top.boardId));
      let level;
      if (top.lowData || top.n < this.ENOUGH_SAMPLES) {
        level = "veri az";
      } else if (margin === null) {
        level = "tek sensör";
      } else {
        level = margin >= 6 ? "güçlü" : margin >= 3 ? "orta" : "zayıf";
      }
      const five = top.bands["5"];
      const fiveNote = five && five.n >= this.MIN_SAMPLES && five.avg >= -70
        ? `5 GHz'i güçlü duyuyor (ort ${five.avg} dBm) — aynı oda / görüş hattı olası.` : "";
      const tip = `Öneri: ${name} — en yüksek puan ${top.score} (bant ortalaması; 5 GHz +7 dB düzeltmeli).` +
        (margin !== null ? ` İkinci sensörden ${margin} dB önde (${this.sensorName(sensorsById.get(second.boardId))}).` :
          " Bu cihazı yalnız bu sensör duydu; karşı/yan sınıftaki tahtayı da sensör olarak açın.") +
        (fiveNote ? "\n" + fiveNote : "") +
        `\nGüven: ${level} (≥ 6 dB fark güçlü, 3–6 orta; en iyi sensörde ${top.n} ölçüm, ${this.ENOUGH_SAMPLES}'dan azı "veri az").`;
      return { boardId: top.boardId, level, margin, text: `${name} (${level}${margin !== null ? `, +${margin} dB` : ""})`, tip };
    },

    /** Kısa sinyal özeti (en güçlü 2 sensör) ve ipucu (bütün sensörler, bant bant). */
    summary(ranked, sensorsById) {
      const fmtBand = (band, b) => `${this.BAND_LABEL[band] || band}: ort ${b.avg} dBm (σ ${b.sd}, n ${b.n}` +
        `${b.nEst ? `, ${b.nEst} tahmini` : ""}, ${b.min}…${b.max}${b.chan ? `, kanal ${b.chan}` : ""})`;
      const order = ["2.4", "5", "6", "?"];
      const short = ranked.slice(0, 2).map(s => this.sensorName(sensorsById.get(s.boardId)) + " " +
        order.filter(band => s.bands[band]).map(band => `${band === "2.4" ? "2,4" : band}: ${Math.round(s.bands[band].avg)}`).join(" · ")).join(" | ");
      const tip = ranked.map(s => `${this.sensorName(sensorsById.get(s.boardId))} — puan ${s.score}${s.lowData ? " (veri az)" : ""}\n  ` +
        order.filter(band => s.bands[band]).map(band => fmtBand(band, s.bands[band])).join("\n  ")).join("\n");
      return { text: short, tip };
    }
  }
});
