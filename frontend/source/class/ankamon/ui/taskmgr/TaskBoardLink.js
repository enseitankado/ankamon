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
 * Görev yöneticisinde TEK tahtanın canlı bağı: tahtaya Connection (WebSocket → SSH → tahta ajanı) ve ajan
 * çerçevelerinden kurulan model (süreç haritası, ağaç, uygulamalar, toplamlar, 60 sn geçmiş). Pencere (ui.taskmgr.Window)
 * seçili her tahta için bir bağ tutar — çoklu seçimde tek pencere, tahta başına bir bağ. Durum: "connecting" |
 * "open" | "closed" (closed'da getError() kapanış nedeni). Model değişince "updated" ({kind: snap|services|startup}),
 * bağlantı durumu değişince "changeLinkState" yayılır.
 */
qx.Class.define("ankamon.ui.taskmgr.TaskBoardLink", {
  extend: qx.core.Object,

  events: {
    /** model tazelendi: {kind: "snap"|"services"|"startup"} */
    updated: "qx.event.type.Data",
    /** bağlantı durumu değişti (getState / getError) */
    changeLinkState: "qx.event.type.Event"
  },

  construct(board) {
    super();
    this.__board = board;
    this.__model = this.__emptyModel();
    this.__conn = new ankamon.ui.taskmgr.Connection(board.id);
    this.__conn.addListener("frame", e => this.__onFrame(e.getData()));
    this.__conn.addListener("opened", () => {
      this.__state = "open";
      this.__error = null;
      this.fireEvent("changeLinkState");
    });
    this.__conn.addListener("closed", e => {
      this.__state = "closed";
      this.__error = e.getData().text;
      this.fireEvent("changeLinkState");
    });
  },

  destruct() {
    if (this.__conn) {
      this.__conn.dispose();
    }
  },

  members: {
    __board: null,
    __conn: null,
    __model: null,
    __state: "connecting",
    __error: null,

    getId() {
      return this.__board.id;
    },

    getBoard() {
      return this.__board;
    },

    /** Kısa ad (başlık, onay metinleri): takma ad, yoksa bilgisayar adı / IP. */
    getName() {
      const b = this.__board;
      return b.label || b.hostname || b.ip || "#" + b.id;
    },

    /** "Bilgisayar" sütunu: "takma ad [bilgisayar adı]" (takma ad yoksa yalnız bilgisayar adı). */
    getDisplay() {
      const b = this.__board;
      const host = b.hostname || (this.__model.static && this.__model.static.hostname) || "";
      if (b.label && host && b.label !== host) {
        return `${b.label} [${host}]`;
      }
      return b.label || host || b.ip || "#" + b.id;
    },

    getState() {
      return this.__state;
    },

    getError() {
      return this.__error;
    },

    isOpen() {
      return this.__state === "open" && this.__conn.isOpen();
    },

    getConn() {
      return this.__conn;
    },

    getModel() {
      return this.__model;
    },

    /** Komut gönderir (bkz. Connection.send). */
    send(op, args) {
      return this.__conn.send(op, args);
    },

    connect() {
      this.__model = this.__emptyModel();
      this.__state = "connecting";
      this.__error = null;
      this.fireEvent("changeLinkState");
      this.__conn.open();
    },

    close() {
      this.__conn.close();
    },

    __emptyModel() {
      const m = {
        static: null, snap: null, hz: 100, procs: new Map(), children: new Map(), windows: new Map(),
        appRoots: [], appOf: new Map(), session: null, users: null, services: null, startup: null,
        memTotal: 0, totals: { cpu: 0, memUsed: 0, diskBusy: 0, netPct: 0 },
        hist: { cpu: [], cores: [], mem: [], disks: {}, nets: {}, gpus: [] },
        netAcc: new Map(), netSince: Date.now()
      };
      m.descendants = root => {
        const out = [];
        const stack = [root];
        while (stack.length) {
          const pid = stack.pop();
          if (m.procs.has(pid)) {
            out.push(pid);
          }
          (m.children.get(pid) || []).forEach(c => stack.push(c));
        }
        return out;
      };
      m.appName = root => {
        const p = m.procs.get(root);
        if (!p) {
          return String(root);
        }
        const exe = (p.exe || "").split("/").pop() || p.name;
        return exe.charAt(0).toUpperCase() + exe.slice(1);
      };
      return m;
    },

    __push(arr, v) {
      arr.push(v);
      if (arr.length > ankamon.ui.taskmgr.Graph.POINTS) {
        arr.shift();
      }
    },

    __onFrame(f) {
      const m = this.__model;
      if (f.t === "static") {
        m.static = f;
        m.hz = f.hz || 100;
        return;
      }
      if (f.t === "services") {
        m.services = f.items;
        this.fireDataEvent("updated", { kind: "services" });
        return;
      }
      if (f.t === "startup") {
        m.startup = f;
        this.fireDataEvent("updated", { kind: "startup" });
        return;
      }
      if (f.t === "error") {
        this.warn("görev yöneticisi ajanı (" + this.getName() + "): " + f.msg);
        return;
      }
      if (f.t !== "snap") {
        return;
      }
      m.snap = f;
      if (f.users) {
        m.users = f.users;
      }
      m.session = f.session || m.session;
      // Süreçler: [pid,ppid,ad,durum,kullanıcı,cpu,bellek,disk,ağ,iş parçacığı,nice,başlangıç,tik,çekirdek,komut,yol,verimlilik,uid]
      m.procs = new Map();
      m.children = new Map();
      f.procs.forEach(r => {
        const p = { pid: r[0], ppid: r[1], name: r[2], state: r[3], user: r[4], cpu: r[5], mem: r[6], disk: r[7], net: r[8],
          threads: r[9], nice: r[10], start: r[11], ticks: r[12], kthread: !!r[13], cmd: r[14], exe: r[15], eco: !!r[16], uid: r[17] };
        m.procs.set(p.pid, p);
        if (!m.children.has(p.ppid)) {
          m.children.set(p.ppid, []);
        }
        m.children.get(p.ppid).push(p.pid);
        if (p.net) {
          m.netAcc.set(p.pid, (m.netAcc.get(p.pid) || 0) + p.net * (f.dt || 1));
        }
      });
      // Uygulamalar: penceresi olan süreçler; atası da pencereliyse ona katılır (tek uygulama).
      m.windows = new Map(Object.entries(f.windows || {}).map(([k, v]) => [Number(k), v]));
      const winPids = new Set([...m.windows.keys()].filter(pid => m.procs.has(pid)));
      m.appRoots = [...winPids].filter(pid => {
        let p = m.procs.get(pid);
        while (p && p.ppid > 1) {
          if (winPids.has(p.ppid)) {
            return false;
          }
          p = m.procs.get(p.ppid);
        }
        return true;
      });
      m.appOf = new Map();
      m.appRoots.forEach(root => m.descendants(root).forEach(pid => m.appOf.set(pid, root)));
      // Toplamlar ve 60 sn geçmiş.
      const mem = f.mem;
      m.memTotal = mem.total;
      const used = mem.total - mem.avail;
      const up = (f.nets || []).filter(n => n.up);
      const linkBits = up.reduce((a, n) => a + (Number(n.speed) > 0 ? Number(n.speed) * 1e6 : 0), 0);
      m.totals = {
        cpu: f.cpu.total, memUsed: used,
        diskBusy: Math.max(0, ...(f.disks || []).map(d => d.busy)),
        netPct: linkBits ? (100 * up.reduce((a, n) => a + (n.rx + n.tx) * 8, 0)) / linkBits : 0
      };
      const h = m.hist;
      this.__push(h.cpu, f.cpu.total);
      f.cpu.cores.forEach((v, i) => this.__push(h.cores[i] = h.cores[i] || [], v));
      this.__push(h.mem, (100 * used) / (mem.total || 1));
      (f.disks || []).forEach(d => {
        const hd = h.disks[d.name] = h.disks[d.name] || { busy: [], r: [], w: [] };
        this.__push(hd.busy, d.busy);
        this.__push(hd.r, d.r);
        this.__push(hd.w, d.w);
      });
      (f.nets || []).forEach(n => {
        const hn = h.nets[n.name] = h.nets[n.name] || { rx: [], tx: [] };
        this.__push(hn.rx, n.rx);
        this.__push(hn.tx, n.tx);
      });
      (f.gpus || []).forEach((g, i) => this.__push(h.gpus[i] = h.gpus[i] || [], g.busy ?? g.mhz ?? 0));
      this.fireDataEvent("updated", { kind: "snap" });
    }
  }
});
