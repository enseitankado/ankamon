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
 * Görev yöneticisi biçimleri — Windows Görev Yöneticisi'nin yazımıyla (Türkçe: ondalık virgül, yüzde başta).
 * Bellek değerleri KiB (ajan /proc'tan KiB verir), hızlar bayt/sn gelir.
 */
qx.Class.define("ankamon.ui.taskmgr.Fmt", {
  type: "static",

  statics: {
    num(v, digits = 1) {
      return Number(v || 0).toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    },

    pct(v, digits = 1) {
      return "%" + ankamon.ui.taskmgr.Fmt.num(v, digits);
    },

    /** KiB → "123,4 MB" (Windows İşlemler sütunu gibi hep MB; 10 GB üstü GB). */
    memKb(kb) {
      const F = ankamon.ui.taskmgr.Fmt;
      return kb >= 10 * 1048576 ? F.num(kb / 1048576, 1) + " GB" : F.num(kb / 1024, 1) + " MB";
    },

    /** KiB → "1,9 GB" / "512 MB" (Performans ayrıntıları). */
    sizeKb(kb) {
      const F = ankamon.ui.taskmgr.Fmt;
      return kb >= 1048576 ? F.num(kb / 1048576, 1) + " GB" : F.num(kb / 1024, 0) + " MB";
    },

    /** Bayt → "238 GB". */
    sizeB(b) {
      return ankamon.ui.taskmgr.Fmt.sizeKb((b || 0) / 1024);
    },

    /** Disk hızı bayt/sn → "0,1 MB/sn" (Windows İşlemler: MB/s). */
    diskRate(bps) {
      return ankamon.ui.taskmgr.Fmt.num((bps || 0) / 1048576, 1) + " MB/sn";
    },

    /** Ağ hızı bayt/sn → "0,1 Mbps" (Windows İşlemler sütunu). */
    netRate(bps) {
      return ankamon.ui.taskmgr.Fmt.num(((bps || 0) * 8) / 1e6, 1) + " Mbps";
    },

    /** Ağ hızı bayt/sn → "8,0 Kbps" / "12,3 Mbps" (Performans: Gönder/Al). */
    bits(bps) {
      const F = ankamon.ui.taskmgr.Fmt;
      const b = (bps || 0) * 8;
      return b >= 1e6 ? F.num(b / 1e6, 1) + " Mbps" : F.num(b / 1e3, 0) + " Kbps";
    },

    /** Disk hızı bayt/sn → "120 KB/sn" / "2,4 MB/sn" (Performans: Okuma/Yazma). */
    bytesRate(bps) {
      const F = ankamon.ui.taskmgr.Fmt;
      return bps >= 1048576 ? F.num(bps / 1048576, 1) + " MB/sn" : F.num((bps || 0) / 1024, 0) + " KB/sn";
    },

    /** Saniye → "1:02:03:04" (gün:sa:dk:sn — Windows "Çalışma süresi"). */
    uptime(sec) {
      const d = Math.floor(sec / 86400);
      const pad = n => String(n).padStart(2, "0");
      return `${d}:${pad(Math.floor((sec % 86400) / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;
    },

    /** Saniye → "0:12:34" (Uygulama geçmişi: CPU süresi). */
    cpuTime(sec) {
      const pad = n => String(n).padStart(2, "0");
      return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;
    },

    /** nice → Windows öncelik sınıfı adı. */
    priority(nice) {
      if (nice <= -15) {
        return "Gerçek zamanlı";
      }
      if (nice <= -10) {
        return "Yüksek";
      }
      if (nice < 0) {
        return "Normalin üstünde";
      }
      if (nice === 0) {
        return "Normal";
      }
      return nice < 10 ? "Normalin altında" : "Düşük";
    },

    PRIORITIES: [
      ["Gerçek zamanlı", -20], ["Yüksek", -10], ["Normalin üstünde", -5], ["Normal", 0], ["Normalin altında", 5], ["Düşük", 19]
    ],

    /** Süreç durumu (/proc stat) → Windows "Durum". */
    state(s, eco) {
      if (eco) {
        return "Verimlilik modu";
      }
      return { R: "Çalışıyor", S: "Çalışıyor", D: "Disk bekliyor", T: "Askıya alındı", t: "İzleniyor", Z: "Yanıt vermiyor (zombi)", I: "Boşta" }[s] || s;
    },

    /** CPU payından Windows "Güç kullanımı" tahmini. */
    power(cpu) {
      if (cpu >= 40) {
        return "Çok yüksek";
      }
      if (cpu >= 20) {
        return "Yüksek";
      }
      if (cpu >= 5) {
        return "Orta";
      }
      return cpu >= 0.5 ? "Düşük" : "Çok düşük";
    },

    esc(s) {
      return qx.bom.String.escape(String(s ?? ""));
    }
  }
});
