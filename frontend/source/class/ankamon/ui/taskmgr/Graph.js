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
 * Performans grafiği (Windows Görev Yöneticisi gibi): son N örneğin alan grafiği, ızgara ve çerçeve; renk
 * kaynak türüne göre (CPU mavi, Bellek mor, Disk yeşil, Ağ turuncu, GPU mavi). İki seri verilirse ikincisi
 * kesikli çizilir (Ağ: gönder/al, Disk: yazma). `mini` kipte ızgara/çerçeve yalnız ince kenardır (sol liste).
 */
qx.Class.define("ankamon.ui.taskmgr.Graph", {
  extend: qx.ui.embed.Canvas,

  statics: {
    COLORS: { cpu: "#117dbb", mem: "#8b12ae", disk: "#4da60c", net: "#a74f01", gpu: "#1a73e8" },
    POINTS: 60
  },

  construct(kind, mini = false) {
    super(200, 100);
    this.set({ syncDimension: true, minWidth: mini ? 70 : 120, minHeight: mini ? 40 : 80 });
    this.__kind = kind;
    this.__mini = mini;
    this.__series = [[]];
    this.__max = 100;
  },

  members: {
    __kind: null,
    __mini: false,
    __series: null,
    __max: 100,

    setKind(kind) {
      this.__kind = kind;
      this.update();
    },

    /** @param series {Array[]} 1-2 dizi (en yeni sonda) @param max {Number} üst sınır (yüzde için 100) */
    setData(series, max = 100) {
      this.__series = series;
      this.__max = max || 1;
      this.update();
    },

    // overridden
    _draw(width, height, ctx) {
      const color = ankamon.ui.taskmgr.Graph.COLORS[this.__kind] || "#117dbb";
      const N = ankamon.ui.taskmgr.Graph.POINTS;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = this.__mini ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)";
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 1;
      if (!this.__mini) {
        // Izgara: 10 sütun × 10 satır, kaynak renginin çok açığı.
        ctx.strokeStyle = this.__alpha(color, 0.18);
        ctx.beginPath();
        for (let i = 1; i < 10; i++) {
          const x = Math.round((width * i) / 10) + 0.5;
          const y = Math.round((height * i) / 10) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();
      }
      const step = width / (N - 1);
      this.__series.forEach((data, si) => {
        const pts = data.slice(-N);
        if (pts.length < 1) {
          return;
        }
        const x0 = width - (pts.length - 1) * step;
        const y = v => height - Math.max(0, Math.min(1, v / this.__max)) * (height - 1);
        ctx.beginPath();
        pts.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
        if (si === 0) {
          ctx.lineTo(width, height);
          ctx.lineTo(x0, height);
          ctx.closePath();
          ctx.fillStyle = this.__alpha(color, 0.12);
          ctx.fill();
          ctx.beginPath();
          pts.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([4, 3]);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = this.__mini ? 1 : 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.strokeStyle = this.__alpha(color, this.__mini ? 0.6 : 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    },

    __alpha(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
  }
});
