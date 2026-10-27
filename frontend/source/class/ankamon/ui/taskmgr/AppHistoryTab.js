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
 * Uygulama geçmişi (Windows Görev Yöneticisi gibi): uygulamaların (pencereli süreç ağaçları) ve kullanıcı
 * süreçlerinin toplam CPU süresi (süreçlerin başlangıcından beri) ve bu pencere açıldığından beri ağ
 * kullanımı (TCP, ajan ölçümü). "Kullanım geçmişini sil" ağ sayaçlarını sıfırlar.
 */
qx.Class.define("ankamon.ui.taskmgr.AppHistoryTab", {
  extend: ankamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Uygulama geçmişi", "history");
    const F = ankamon.ui.taskmgr.Fmt;
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__info = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    bar.add(this.__info, { flex: 1 });
    bar.add(this._button("Kullanım geçmişini sil", () => {
      this._win.getModel().netAcc.clear();
      this._win.getModel().netSince = Date.now();
      this.update(this._win.getModel());
    }));
    this.add(bar);
    this.__table = this._table([
      { id: "name", label: "Ad", width: 300 },
      { id: "cpu", label: "CPU süresi", width: 120 },
      { id: "net", label: "Ağ", width: 120, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.sizeB(v), 50 * 1048576) },
      { id: "procs", label: "İşlem sayısı", width: 100 },
      { id: "user", label: "Kullanıcı", width: 140 }
    ], "taskmgr.history");
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __info: null,

    // overridden
    update(m) {
      if (!m.snap || !this.isSeeable()) {
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const hz = m.hz || 100;
      const sessionUid = m.session && m.session.uid;
      // Uygulama = pencereli kök + ağacı; ayrıca kullanıcı süreçleri ada göre toplanır.
      const groups = new Map();
      const claimed = new Set();
      const add = (name, pids, user) => {
        const g = groups.get(name) || { ticks: 0, net: 0, procs: 0, user };
        pids.forEach(pid => {
          const p = m.procs.get(pid);
          if (p) {
            g.ticks += p.ticks;
            g.net += m.netAcc.get(pid) || 0;
            g.procs++;
            claimed.add(pid);
          }
        });
        groups.set(name, g);
      };
      m.appRoots.forEach(root => add(m.appName(root), m.descendants(root).filter(pid => !claimed.has(pid)), (m.procs.get(root) || {}).user));
      m.procs.forEach(p => {
        if (!claimed.has(p.pid) && !p.kthread && (p.uid >= 1000 || (sessionUid && p.uid === sessionUid))) {
          add(p.name, [p.pid], p.user);
        }
      });
      const q = this._win.getFilter();
      const rows = [...groups.entries()].filter(([name]) => !q || name.toLowerCase().includes(q))
        .sort((a, b) => b[1].ticks - a[1].ticks)
        .map(([name, g]) => [name, name, F.cpuTime(g.ticks / hz), g.net, g.procs, g.user || ""]);
      this.__info.setValue(`CPU süresi: süreçler başladığından beri · Ağ: ${new Date(m.netSince).toLocaleTimeString("tr-TR")}'den beri (bu pencere)`);
      this._setRows(this.__table, rows);
    }
  }
});
