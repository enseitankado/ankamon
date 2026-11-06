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
 * Wi-Fi Monitör: çoklu tahta penceresinin HTML'i (bkz. ui.boards.WifiMonitor, ui.boards.WifimonClassify).
 * Üstte tahta başına tek satırlık durum şeridi (sayılar, tarama durumu, notlar — boards()), altında bütün tahtaların vericileri
 * TEK tabloda (grid(); birden çok tahtada "Bilgisayar" sütunu). Düğmeler data-act öznitelikli; tıklamaları pencere tek dinleyiciyle karşılar.
 */
qx.Class.define("ankamon.ui.boards.WifimonRender", {
  type: "static",

  statics: {
    LEVELS: {
      phone: { label: "Telefon", color: "#d93025", bg: "rgba(217,48,37,.16)", tip: "Sabit değil ve telefon olduğuna dair güçlü kanıt var." },
      maybe: { label: "Olası", color: "#e8710a", bg: "rgba(232,113,10,.14)", tip: "Sabit değil; telefon/tablet olabilir (zayıf kanıt)." },
      foreign: { label: "Yabancı", color: "#b08000", bg: "rgba(232,162,0,.12)", tip: "Sabit listesinde değil." },
      common: { label: "Ortak", color: "#6b7280", bg: "rgba(107,114,128,.10)", tip: "Sabit değil ama seçili tahtaların çoğu bu ağ adını duyuyor: okul ağı olası." },
      fixed: { label: "Sabit", color: "#6b7280", bg: "transparent", tip: "Sabit listesinde (ya da tahtanın bağlı olduğu ağ)." }
    },
    KIND_LABEL: { wifi: "Wi-Fi ağı", bt: "Bluetooth", probe: "Wi-Fi arayan cihaz" },
    PROBE_NOTE: {
      nodev: "Wi-Fi kartı yok; yoklama dinlenemedi.",
      tools: "Tahtada iw ya da python3 yok; yoklama dinlenemedi.",
      radio: "Wi-Fi açılamadığından yoklama dinlenemedi.",
      busy: "Wi-Fi kartı bir ağa bağlı/bağlanıyor; bağlantı kesilmesin diye yoklama dinlenmedi.",
      nomon: "Wi-Fi kartı monitör kipini desteklemiyor; yoklama dinlenemedi.",
      shared: "Bu tahtada başka bir pencere yoklama dinliyor; bu turda atlandı.",
      monfail: "Monitör arabirimi kurulamadı; yoklama dinlenemedi."
    },

    chip(text, color, bg, tip) {
      return `<span title="${qx.bom.String.escape(tip || "")}" style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;` +
        `font-weight:600;color:${color};background:${bg};border:1px solid ${color}55;white-space:nowrap">${text}</span>`;
    },

    bar(signal) {
      if (signal === null || signal === undefined) {
        return "";
      }
      const color = signal >= 60 ? "#2fa84a" : signal >= 35 ? "#e8a200" : "#d93025";
      return `<span style="display:inline-block;width:56px;height:8px;background:rgba(127,127,127,.25);border-radius:4px;vertical-align:middle">` +
        `<span style="display:block;width:${signal}%;height:100%;background:${color};border-radius:4px"></span></span> ` +
        `${signal}% <span style="opacity:.7">${ankamon.ui.boards.WifimonClassify.proximity(signal)}</span>`;
    },

    __button(act, text, tip, attrs) {
      return `<button data-act="${act}" ${attrs} title="${qx.bom.String.escape(tip)}" style="font:inherit;font-size:11px;padding:1px 6px;` +
        `margin-right:4px;border-radius:4px;border:1px solid rgba(127,127,127,.5);background:rgba(127,127,127,.12);color:inherit;cursor:pointer">${text}</button>`;
    },

    /** Satırın işlem düğmeleri: güvenilir (sabit) işaretle — bu sınıfta / okul genelinde — ya da sabitten çıkar. */
    __actions(item, boardId, canEdit) {
      if (!canEdit || item.row.active) {
        return "";
      }
      const esc = qx.bom.String.escape;
      const row = item.row;
      if (item.fixed) {
        return this.__button("unfix", "Sabitten çıkar", "Bu kaydı sabit listesinden siler.", `data-id="${item.fixed.id}"`);
      }
      if (row.kind !== "wifi" && row.random) {
        return `<span style="opacity:.6;font-size:11px" title="Rastgele adres birkaç dakikada bir değiştiğinden sabitlenemez.">sabitlenemez</span>`;
      }
      const kind = row.kind === "wifi" ? "bssid" : row.kind;
      const base = `data-kind="${kind}" data-value="${esc(row.addr)}" data-label="${esc(row.name || "")}"`;
      // Wi-Fi ağında "AP" (erişim noktası), Bluetooth/Wi-Fi arayan cihazda "cihaz" denir.
      const what = row.kind === "wifi" ? "AP" : "cihaz";
      let html = this.__button("fix", `Bu sınıfta güvenilir ${what}`,
        `Bu ${row.kind === "wifi" ? "erişim noktası" : "cihaz"} yalnız bu tahtada güvenilir (sabit) sayılır.`, `${base} data-board="${boardId}"`);
      if (row.kind === "wifi" && row.name) {
        html += this.__button("fix", "Okul genelinde güvenilir AP",
          `"${row.name}" adlı bütün erişim noktaları bütün tahtalarda güvenilir (sabit) sayılır (ör. okulun kendi ağı).`,
          `data-kind="ssid" data-value="${esc(row.name)}" data-label="${esc(row.name)}" data-board=""`);
      } else if (row.kind !== "wifi") {
        html += this.__button("fix", "Okul genelinde güvenilir cihaz",
          "Bu cihaz bütün tahtalarda güvenilir (sabit) sayılır (ör. öğretmen dizüstü bilgisayarı).", `${base} data-board=""`);
      }
      return html;
    },

    __seen(item, now) {
      const row = item.row;
      const parts = [];
      if (item.isNew) {
        parts.push(this.chip("yeni", "#1a73e8", "rgba(26,115,232,.14)",
          "Bu tahtada son 24 saatte ilk kez görüldü ya da bu pencere açıldıktan sonra belirdi."));
      }
      if (row.seen_days > 1) {
        parts.push(`<span title="İlk görülme: ${new Date(row.first_seen * 1000).toLocaleString("tr-TR")}">${row.seen_days} günde</span>`);
      }
      if (item.lastAt) {
        const ago = Math.max(0, Math.round((now - item.lastAt) / 1000));
        parts.push(`<span style="opacity:.7">${ago < 60 ? ago + " sn" : Math.round(ago / 60) + " dk"} önce</span>`);
      }
      return parts.join(" ");
    },

    /**
     * Kanıt sütunu: kısa terimler (kullanıcı isteği — uzun ifade satırı birkaç satıra kırıyordu); açıklaması terimin ipucunda.
     * Her terim kendi içinde kırılmaz, terimler arasında satır kırılabilir. Üretici adı ayrı "Üretici" sütununda.
     */
    __evidence(item) {
      const esc = qx.bom.String.escape;
      const row = item.row;
      const term = (text, tip) => `<span style="white-space:nowrap${tip ? ";text-decoration:underline dotted;cursor:help" : ""}"` +
        (tip ? ` title="${esc(tip)}"` : "") + `>${esc(text)}</span>`;
      const parts = (row.hints || []).map(h => {
        if (/paylaşım noktasına benziyor/.test(h)) {
          return term("hotspot adı", h);
        }
        const m = /^(.*?)\s*\((.+)\)$/.exec(h); // "rastgele adres (telefon/tablet olağan)" → "rastgele adres" + ipucu
        return m ? term(m[1].replace(/^rastgele BLE adresi$/, "rastgele adres"), h) : term(h);
      });
      if (row.kind === "probe") {
        const ssids = row.ssids || [];
        parts.unshift(term("ağ arıyor", "Bağlanacak ağ araştırıyor (Wi-Fi yoklaması). " + (ssids.length
          ? "Yoklama yaptığı ağlar:\n" + ssids.join("\n") : "Ağ adı vermeden yoklama yapıyor (çevredeki bütün ağları soruyor).")));
        if (row.count) {
          parts.push(term(`${row.count} yoklama`, "Dinleme süresince duyulan yoklama sayısı."));
        }
      }
      if (item.commonCount) {
        parts.push(term(`${item.commonCount} tahtada`, `${item.commonCount} tahta bu ağ adını duyuyor: okul ağı olası.`));
      }
      if (item.fixed) {
        parts.unshift(term("sabit", "Sabit listesinde: " + (item.fixed.kind === "ssid" ? `"${item.fixed.value}" ağ adı` : "adres") +
          (item.fixed.board_id ? " (bu sınıf)" : " (okul geneli)")));
      }
      return parts.join(" · ");
    },

    /**
     * Üretici sütunu: adresin OUI'sinden (worker: Wireshark manuf; Bluetooth'ta üretici verisi) bulunan ad. Yerel yönetimli
     * (rastgele) adreste OUI yoktur — "Rastgele" yazılır; kalıcı adres OUI listesinde yoksa "—".
     */
    __vendor(row) {
      const esc = qx.bom.String.escape;
      if (row.vendor) {
        return `<b>${esc(row.vendor)}</b>`;
      }
      if (row.random) {
        return `<span style="opacity:.75" title="Rastgele (yerel yönetimli) adres: üretici kodu (OUI) taşımaz, üretici belirlenemez.">Rastgele</span>`;
      }
      return `<span style="opacity:.5" title="Adresin üretici kodu (OUI) listede bulunamadı.">—</span>`;
    },

    /**
     * Bütün tahtaların satırları TEK tabloda (kullanıcı isteği): önce öne çıkma düzeyi (telefon → sabit), sonra sinyal.
     * Birden çok tahta varken "Bilgisayar" sütunu görünür.
     * @param entries {Array} [{feed, view}] (view: WifimonClassify.board())
     */
    grid(entries, opts) {
      const esc = qx.bom.String.escape;
      const Classify = ankamon.ui.boards.WifimonClassify;
      const many = entries.length > 1;
      const items = [];
      entries.forEach(({ feed, view }) => view.rows.forEach(item => {
        if (opts.showFixed || item.level !== "fixed") {
          items.push({ item, feed });
        }
      }));
      if (!items.length) {
        const any = entries.some(({ feed, view }) => feed.data || view.rows.length);
        return any ? `<div style="padding:8px 10px;color:#2fa84a;font-weight:600">Yabancı verici yok.</div>` : "";
      }
      const sig = it => (it.item.row.signal === null || it.item.row.signal === undefined ? -1 : it.item.row.signal);
      items.sort((a, b) => Classify.LEVEL_ORDER[a.item.level] - Classify.LEVEL_ORDER[b.item.level] || sig(b) - sig(a));
      const th = "text-align:left;padding:3px 6px;border-bottom:1px solid rgba(127,127,127,.4);font-weight:600;white-space:nowrap;" +
        "position:sticky;top:0;background:var(--wifimon-head, rgba(127,127,127,.18));backdrop-filter:blur(6px)";
      const td = "padding:3px 6px;vertical-align:top";
      const heads = ["Durum"].concat(many ? ["Bilgisayar"] : [], ["Tür", "Ad", "Sinyal", "Kanıt", "Cihaz", "Üretici", "Son görülme", ""]);
      const head = heads.map(h => `<th style="${th}">${h}</th>`).join("");
      const body = items.map(({ item, feed }) => {
        const row = item.row;
        const lv = this.LEVELS[item.level];
        const name = row.kind === "probe" ? (row.ssids && row.ssids.length ? row.ssids.join(", ") : "(ağ adı vermeden)")
          : row.name || (row.kind === "wifi" ? "(gizli ağ)" : "(adsız)");
        const dim = item.level === "fixed" ? "opacity:.55;" : "";
        return `<tr style="${dim}background:${lv.bg}">` +
          `<td style="${td}">${this.chip(lv.label, lv.color, "transparent", lv.tip)}</td>` +
          (many ? `<td style="${td};white-space:nowrap">${esc(feed.name)}</td>` : "") +
          `<td style="${td};white-space:nowrap">${this.KIND_LABEL[row.kind] || row.kind}${row.active ? " (bağlı)" : ""}</td>` +
          `<td style="${td};font-weight:${item.level === "fixed" ? 400 : 600};white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis" title="${esc(name)}">${esc(name)}</td>` +
          `<td style="${td};white-space:nowrap">${this.bar(row.signal)}</td>` +
          `<td style="${td};font-size:12px;white-space:nowrap">${this.__evidence(item)}</td>` +
          `<td style="${td};font-family:monospace;font-size:11px;opacity:.75;white-space:nowrap" title="Cihazın (verici) adresi">${esc(row.addr || "")}</td>` +
          `<td style="${td};font-size:12px;white-space:nowrap">${this.__vendor(row)}</td>` +
          `<td style="${td};white-space:nowrap;font-size:12px">${this.__seen(item, opts.now)}</td>` +
          `<td style="${td};white-space:nowrap">${this.__actions(item, feed.board.id, opts.canEdit)}</td></tr>`;
      }).join("");
      return `<table style="border-collapse:collapse;width:100%;font-size:13px"><tr>${head}</tr>${body}</table>`;
    },

    /**
     * Pencerenin üst şeridi: tahta başına TEK satır — ad, sayılar, durum (taranıyor/dinleniyor…) ve notlar (kart, geçici açılan
     * radyo, geri yükleme). Tahta adına tıklamak tabloyu yalnız o tahtaya süzer; yeniden tıklamak süzgeci kaldırır.
     */
    boards(entries, only) {
      const esc = qx.bom.String.escape;
      const L = this.LEVELS;
      return entries.map(({ feed, view }) => {
        const c = view.counts;
        const chips = [];
        if (c.phone) {
          chips.push(this.chip(`Telefon ${c.phone}`, L.phone.color, L.phone.bg, L.phone.tip));
        }
        if (c.maybe) {
          chips.push(this.chip(`Olası ${c.maybe}`, L.maybe.color, L.maybe.bg, L.maybe.tip));
        }
        if (c.foreign) {
          chips.push(this.chip(`Yabancı ${c.foreign}`, L.foreign.color, L.foreign.bg, L.foreign.tip));
        }
        if (c.common) {
          chips.push(this.chip(`Ortak ${c.common}`, L.common.color, L.common.bg, L.common.tip));
        }
        chips.push(this.chip(`Sabit ${c.fixed}`, L.fixed.color, "rgba(127,127,127,.08)", L.fixed.tip));
        const pi = feed.probeInfo;
        if (pi && !pi.note) {
          chips.push(this.chip(`Yoklama ≈${pi.devices} cihaz`, "#1a73e8", "rgba(26,115,232,.10)",
            `Son ${pi.secs || "?"} sn dinlemede ağ arayan cihaz kestirimi (rastgele adresler parmak izine göre birleştirildi).`));
        }
        const lead = c.phone ? L.phone.color : c.maybe ? L.maybe.color : c.foreign ? L.foreign.color : "#2fa84a";
        const busy = feed.busy ? ankamon.ui.JobSpinner.html() + " " : "";
        const notes = (feed.notes || []).filter(Boolean).join(" · ");
        const notesText = notes.replace(/<[^>]*>/g, "");
        const picked = only === feed.board.id;
        const tip = picked ? "Tabloda yalnız bu tahta gösteriliyor; tıklayınca bütün tahtalar." : "Tıklayınca tabloda yalnız bu tahta gösterilir.";
        // Tek satır (kullanıcı isteği: sade): notlar satırın kalanına sığdığı kadar, tamamı ipucunda.
        return `<div style="display:flex;flex-wrap:nowrap;gap:6px;align-items:center;padding:2px 8px;border-left:4px solid ${lead};white-space:nowrap;` +
          `margin-bottom:3px;background:${picked ? "rgba(26,115,232,.12)" : "rgba(127,127,127,.07)"};border-radius:4px">` +
          `<b data-act="only" data-board="${feed.board.id}" title="${tip}" style="cursor:pointer;margin-right:4px;text-decoration:underline dotted">${esc(feed.name)}</b>` +
          `${chips.join(" ")}<span style="font-size:12px;opacity:.85;margin-left:6px">${busy}${feed.status || ""}</span>` +
          (notes ? `<span title="${esc(notesText)}" style="font-size:12px;opacity:.75;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">· ${notes}</span>` : "") + "</div>";
      }).join("");
    }
  }
});
