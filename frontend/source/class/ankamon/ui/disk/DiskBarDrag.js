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
 * Disk editörünün grafik çubuğunda fareyle düzenleme (kullanıcı isteği 2026-11-23: "boyutlandır vb. işlevler fare ile de
 * yapılabilsin"). GParted'deki gibi:
 *  - bölümün sağ/sol kenarını sürüklemek = yeniden boyutlandırma (sol kenar başlangıcı da kaydırır — taşınabilen bölümde),
 *  - bölümün gövdesini sürüklemek = taşıma (önünde/arkasında boşluk varsa, bağlı değilse),
 *  - boş alanda sürüklemek = yeni bölümün yerini ve boyutunu seçme.
 * Sürüklerken hayalet kutu ve yeni boyut/konum (MiB) canlı yazılır. Bırakınca işlem HEMEN kuyruğa girmez: mevcut
 * "Yeniden boyutlandır / Taşı" ya da "Yeni bölüm" penceresi aynı değerlerle dolu açılır (doğrulama ve "Kuyruğa ekle" ve
 * sonra "Uygula" akışı değişmez). Sınırlar ve 1 MiB hizalama ui.disk.DiskModel'in (resizeLimits, creatable) kurallarıyla
 * aynıdır: komşu bölüm/boşluk, disk sonu, dosya sisteminin en küçük boyutu, büyüyüp küçülebilme, bağlı bölüm taşınamaz.
 *
 * Yapılamayan ya da sınıra takılan sürüklemede neden söylenir (kullanıcı isteği 2026-11-23): sürüklerken hayalet kutunun notunda
 * kırmızı satır (dosya sistemi küçültmeyi desteklemiyor, araç yok, bölüm bağlı, dolu alan kadar en küçük boyut, komşu bölüm…),
 * kutunun üstünde ipucu ve bırakınca editörde kısa bildirim (host.notify) — nedenler DiskModel.limitReasons / why.
 *
 * Çubuk orantılı değildir (küçük bölüm en az %3 yer kaplar), bu yüzden piksel → sektör eşlemesi her sürüklemede yalnız
 * ilgili kutuların (bölüm + önündeki/arkasındaki boşluk) piksel aralığı üzerinden yerel ve doğrusaldır.
 */
qx.Class.define("ankamon.ui.disk.DiskBarDrag", {
  type: "static",

  statics: {
    /** Kenar tutma payı (piksel). */
    EDGE: 7,
    /** Bu kadar pikselden az kayma tıklama sayılır (yalnız seçer). */
    SLOP: 3,

    /**
     * @param el {Element} çubuğun DOM kabı (qx.ui.embed.Html içerik öğesi; içi setHtml ile yenilenir)
     * @param host {Map} { disk() → simüle disk, tools() → cihaz araçları, select(i), drop(plan, result),
     *   notify(text) → sürükleme yapılamadığında/sınıra takıldığında bırakınca kısa bildirim }
     */
    attach(el, host) {
      let active = false;
      el.addEventListener("mousemove", e => {
        if (active) {
          return;
        }
        const box = e.target.closest && e.target.closest("[data-i]");
        if (box && el.contains(box)) {
          const plan = this.__plan(el, host, box, e.clientX);
          const tip = box.getAttribute("data-tip") || "";
          if (plan && plan.mode) {
            box.style.cursor = { end: "ew-resize", start: "ew-resize", move: "grab", create: "crosshair" }[plan.mode];
            box.title = plan.note ? `${tip}\n${plan.note}` : tip;
          } else {
            // Fareyle değiştirilemiyorsa nedeni ipucunda da (sürüklemeye kalkışınca hayalet kutu yerine kırmızı not çıkar).
            box.style.cursor = plan && plan.why ? "not-allowed" : "pointer";
            box.title = plan && plan.why ? `${tip}\nFareyle değiştirilemez: ${plan.why}` : tip;
          }
        }
      });
      el.addEventListener("mousedown", e => {
        const box = e.button === 0 && e.target.closest && e.target.closest("[data-i]");
        if (!box || !el.contains(box)) {
          return;
        }
        e.preventDefault();
        const index = parseInt(box.getAttribute("data-i"), 10);
        const plan = this.__plan(el, host, box, e.clientX);
        if (plan && !plan.mode) {
          plan.boxLeft = box.getBoundingClientRect().left;
        }
        const x0 = e.clientX;
        let moved = false;
        let overlay = null;
        let result = null;
        active = true;
        const move = ev => {
          if (!moved && Math.abs(ev.clientX - x0) < this.SLOP) {
            return;
          }
          moved = true;
          if (plan) {
            overlay = overlay || this.__overlay(el, box);
            result = plan.mode ? this.__compute(plan, x0, ev.clientX) : null;
            this.__show(el, overlay, plan, result);
          }
        };
        const up = () => {
          document.removeEventListener("mousemove", move, true);
          document.removeEventListener("mouseup", up, true);
          active = false;
          if (overlay) {
            overlay.remove();
          }
          host.select(index);
          if (moved && plan && result && result.changed) {
            host.drop(plan, result);
          }
          // Yapılamadıysa ya da sınıra takıldıysa neden bırakınca da söylenir (pencere açılsa bile altında görünür).
          const why = moved && plan ? (plan.mode ? result && result.why : plan.why) : null;
          if (why && host.notify) {
            host.notify(why);
          }
        };
        document.addEventListener("mousemove", move, true);
        document.addEventListener("mouseup", up, true);
      });
    },

    /** Sektör aralığı [s0, s1] ↔ piksel aralığı [left, right] (ekran koordinatı) doğrusal eşlemesi. */
    __map(left, right, s0, s1) {
      const span = Math.max(1, right - left);
      const n = s1 - s0 + 1;
      return { toSector: x => s0 + ((x - left) / span) * n, toPx: s => left + ((s - s0) / n) * span };
    },

    /**
     * Fare basılan noktaya göre sürüklemenin türü ve sınırları (MiB, 1 MiB = a sektör); sürüklenemiyorsa null.
     * Değerler "Yeniden boyutlandır / Taşı" ve "Yeni bölüm" pencerelerindekilerle aynı hesaplanır.
     */
    __plan(el, host, box, x) {
      const M = ankamon.ui.disk.DiskModel;
      const disk = host.disk();
      const part = disk && disk.parts[parseInt(box.getAttribute("data-i"), 10)];
      if (!part) {
        return null;
      }
      const a = M.align(disk);
      const r = box.getBoundingClientRect();
      if (part.kind === "free") {
        const can = M.creatable(disk, part);
        if (!can.ok) {
          return { mode: null, why: can.why };
        }
        const first = Math.ceil((part.start + (part.logical ? 1 : 0)) / a) * a;
        const maxMib = Math.floor((part.end - first + 1) / a);
        return maxMib < 1 ? { mode: null, why: "Bu boşluk bölüm için çok küçük." } : { mode: "create", part, a, first, maxMib, top: r.top, height: r.height,
          map: this.__map(r.left, r.right, part.start, part.end) };
      }
      if (part.kind === "extended") {
        return { mode: null, why: "Genişletilmiş bölüm fareyle boyutlandırılamaz (içindeki mantıksal bölümleri sürükleyin)." };
      }
      const tools = host.tools() || {};
      const blocked = M.why(disk, part, "resize", tools);
      if (blocked) {
        return { mode: null, why: blocked };
      }
      const L = M.resizeLimits(disk, part, tools);
      const R = M.limitReasons(disk, part, tools);
      const { before, after } = M.neighbours(disk, part);
      const rectOf = p => {
        const b = el.querySelector(`[data-i="${disk.parts.indexOf(p)}"]`);
        return b ? b.getBoundingClientRect() : null;
      };
      const lr = before && L.canMove ? rectOf(before) : null;
      const rr = after ? rectOf(after) : null;
      const map = this.__map((lr || r).left, (rr || r).right, lr ? before.start : part.start, rr ? after.end : part.end);
      const edge = Math.min(this.EDGE, r.width / 4);
      let mode = x >= r.right - edge ? "end" : (x <= r.left + edge ? "start" : "move");
      const cur = Math.round(L.size / a);
      const plan = { part, a, L, R, map, top: r.top, height: r.height, cur, note: null,
        beforeNow: Math.round((part.start - L.minStart) / a),
        total: Math.floor((L.maxEnd - L.minStart + 1) / a),
        minMib: Math.max(1, Math.ceil(L.minSize / a)),
        maxMib: Math.floor(L.maxSize / a) };
      if (mode !== "end" && !L.canMove) {
        return { mode: null, why: R.move };   // bağlı bölüm taşınamaz; yalnız sağ kenarı (sonu) değişir
      }
      if (mode === "move" && plan.total <= cur) {
        return { mode: null, why: "Önünde ve arkasında boş alan yok — taşınamaz." };
      }
      if (mode === "end" && plan.minMib >= cur && plan.maxMib <= cur) {
        const both = `Küçültme: ${R.shrink || R.floor} Büyütme: ${R.grow || R.growEnd}`;
        if (!(L.canMove && plan.total > cur)) {
          return { mode: null, why: `Boyutu değiştirilemez. ${both}` };
        }
        mode = "move";
        plan.note = `Boyutu değiştirilemez, yalnız taşınır. ${both}`;
      }
      plan.mode = mode;
      return plan;
    },

    /** Farenin konumu → {before, size} (MiB) + yeni başlangıç/bitiş sektörü; sınırlara kırpılmış ve hizalı. */
    __compute(plan, x0, x) {
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const { a, map } = plan;
      if (plan.mode === "create") {
        const s0 = map.toSector(Math.min(x0, x));
        const s1 = map.toSector(Math.max(x0, x));
        const before = clamp(Math.round((s0 - plan.first) / a), 0, plan.maxMib - 1);
        const endMib = clamp(Math.round((s1 - plan.first) / a), before + 1, plan.maxMib);
        const start = plan.first + before * a;
        return { before, size: endMib - before, start, end: start + (endMib - before) * a - 1, changed: true };
      }
      const { L, R } = plan;
      let before = plan.beforeNow;
      let size = plan.cur;
      let why = null;   // fare sınırın ötesinde: neden orada durdu (kullanıcıya söylenir)
      // Küçültmeyi durduran: dosya sistemi hiç küçülemiyorsa onun nedeni, yoksa en küçük boyut (dolu alan).
      const shrinkWhy = () => R.shrink || R.floor;
      if (plan.mode === "end") {
        const start = L.canMove ? L.minStart + before * a : plan.part.start;
        const hi = Math.min(plan.maxMib, Math.floor((L.maxEnd + 1 - start) / a));
        const raw = Math.round((map.toSector(x) - start) / a);
        size = clamp(raw, plan.minMib, hi);
        if (raw < plan.minMib) {
          why = shrinkWhy();
        } else if (raw > hi) {
          why = !L.canGrow ? R.grow : R.growEnd;
        }
      } else if (plan.mode === "start") {
        const right = plan.beforeNow + plan.cur;   // sağ kenar sabit (MiB, L.minStart'tan)
        const lo = Math.max(0, right - plan.maxMib);
        const raw = Math.round((map.toSector(x) - L.minStart) / a);
        before = clamp(raw, lo, right - plan.minMib);
        size = right - before;
        if (raw > right - plan.minMib) {
          why = shrinkWhy();
        } else if (raw < lo) {
          why = lo > 0 && !L.canGrow ? R.grow : R.startEnd;
        }
      } else {
        const raw = plan.beforeNow + Math.round((map.toSector(x) - map.toSector(x0)) / a);
        before = clamp(raw, 0, plan.total - plan.cur);
        if (raw < 0) {
          why = R.startEnd;
        } else if (raw > plan.total - plan.cur) {
          why = R.growEnd.replace("Arkasındaki boş alan burada bitiyor", "Arkasındaki boş alan bitti");
        }
      }
      const start = L.canMove ? L.minStart + before * a : plan.part.start;
      return { before, size, start, end: start + size * a - 1, changed: before !== plan.beforeNow || size !== plan.cur, why,
        info: plan.note };
    },

    __overlay(el, box) {
      const layer = document.createElement("div");
      layer.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:5";
      layer.innerHTML = "<div data-ghost style='position:absolute;box-sizing:border-box;border:2px dashed #2a6dd8;background:rgba(42,109,216,.18)'></div>" +
        "<div data-note style='position:absolute;padding:1px 5px;font-size:11px;line-height:14px;white-space:nowrap;background:#2a6dd8;" +
        "color:#fff;border-radius:3px'></div>";
      el.appendChild(layer);
      return layer;
    },

    /** Hayalet kutuyu yeni yerine koyar, boyut/konum yazısını günceller. */
    __show(el, layer, plan, res) {
      const base = el.getBoundingClientRect();
      const ghost = layer.querySelector("[data-ghost]");
      const note = layer.querySelector("[data-note]");
      if (!plan.mode) {
        // Sürüklenemez: hayalet kutu yok, kutunun üstünde kırmızı not (neden).
        ghost.style.display = "none";
        this.__noteText(note, null, plan.why);
        note.style.maxWidth = Math.max(160, base.width - 4) + "px";
        note.style.left = Math.max(0, Math.min(base.width - note.offsetWidth - 2, plan.boxLeft - base.left)) + "px";
        note.style.top = "2px";
        return;
      }
      const left = plan.map.toPx(res.start) - base.left;
      const width = Math.max(2, plan.map.toPx(res.end + 1) - base.left - left);
      Object.assign(ghost.style, { left: left + "px", width: width + "px", top: (plan.top - base.top) + "px", height: plan.height + "px" });
      const mib = n => n >= 1024 ? `${n} MiB (${(n / 1024).toFixed(1).replace(".", ",")} GiB)` : `${n} MiB`;
      let text;
      if (plan.mode === "create") {
        text = `Yeni bölüm: ${mib(res.size)} · önünde ${mib(res.before)} boşluk`;
      } else {
        const moved = res.start !== plan.part.start;
        text = `${mib(res.size)} (şu an ${mib(plan.cur)}) · önünde ${mib(res.before)} boşluk${moved ? " · taşınır" : ""}`;
      }
      this.__noteText(note, text, res.why, res.info);
      note.style.maxWidth = (base.width - 4) + "px";
      const w = note.offsetWidth;
      note.style.left = Math.max(0, Math.min(base.width - w - 2, left)) + "px";
      note.style.top = Math.max(0, plan.top - base.top + 2) + "px";
    },

    /**
     * Not kutusu: üst satır yeni boyut/konum, varsa alt satır neden (sınıra takıldı / yapılamaz — kırmızı zemin) ya da
     * bilgi (ör. boyutu değişmez, yalnız taşınır — turuncu zemin).
     */
    __noteText(note, text, why, info) {
      note.textContent = "";
      if (text) {
        note.appendChild(document.createTextNode(text));
      }
      if (why || info) {
        const line = document.createElement("div");
        line.style.cssText = "white-space:normal;font-weight:600";
        line.textContent = why ? "⛔ " + why : "ℹ " + info;
        note.appendChild(line);
      }
      note.style.background = why ? "#c5221f" : (info ? "#a35200" : "#2a6dd8");
    }
  }
});
