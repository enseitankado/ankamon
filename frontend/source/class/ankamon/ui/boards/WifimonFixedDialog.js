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
 * Wi-Fi Monitör "Güvenilir listesi…": güvenilir (sabit) işaretlenmiş vericiler — erişim noktası ya da Wi-Fi cihazı, MAC adresiyle —,
 * kapsamı (tesis geneli / salon) ve işaretleyen; seçilenler listeden çıkarılır ya da kapsamları topluca değiştirilir (tesis geneli ya da
 * seçilen tahtanın salonu — kullanıcı isteği 2026-11-10; "okul"/"sınıf" yerine "tesis"/"salon" 2026-11-12; PUT /api/wifimon/fixed).
 * Bütün hücre ve başlıklarda açıklayıcı ipucu (kullanıcı isteği 2026-11-12: lise öğrencisinin anlayacağı dil). Eski "ağ adı" ve "Bluetooth" kayıtları artık
 * uygulanmaz (güven yalnız MAC ile — kullanıcı isteği 2026-11-06), silinebilsinler diye listelenir (bkz. ui.boards.WifiMonitor, backend
 * WifimonFixedEmittersApi).
 *
 * Fiziksel konum (kullanıcı isteği 2026-11-11): MAC'li her kaydın yanında sensörlerin o cihazı bant bant hangi güçte duyduğu
 * (Wi-Fi Monitör açıkken kaydedilen istatistik — GET /api/wifimon/locations), konum önerisi ve "Konum (yanındaki sensör)" açılır
 * listesi (kod adı ya da bilgisayar adı / kablolu MAC); seçim hemen kaydedilir (PUT /api/wifimon/locations), istenirse aynı
 * fiziksel cihazın diğer radyo adreslerine de (bkz. ui.boards.WifimonLocation).
 */
qx.Class.define("ankamon.ui.boards.WifimonFixedDialog", {
  type: "static",

  statics: {
    KIND_LABEL: { ssid: "Ağ adı (eski kayıt — uygulanmıyor)", bssid: "Erişim noktası", bt: "Bluetooth (eski kayıt — uygulanmıyor)",
      probe: "Wi-Fi cihazı" },

    /** Tür hücresinin ipucu (lise düzeyinde açıklama). */
    KIND_HINT: {
      bssid: "Erişim noktası: kablosuz ağı (Wi-Fi) yayınlayan cihaz — genelde tavanda ya da duvarda duran, modeme benzeyen kutu. " +
        "Parantez içinde yayınladığı Wi-Fi ağının adı (SSID) yazar.",
      probe: "Wi-Fi cihazı: telefon, tablet, yazıcı gibi Wi-Fi kullanan bir cihaz. Sensörler onu bir ağ ararken ya da bir ağa bağlıyken duydu. " +
        "Parantez içinde (biliniyorsa) adı ya da bağlı olduğu ağ yazar.",
      ssid: "Eski tür kayıt: yalnız ağ adıyla güvenilir sayma. Artık uygulanmıyor — aynı adı herkes (ör. bir telefonun paylaşım noktası) " +
        "kullanabildiği için güven yalnız MAC adresiyle kurulur. Silebilirsiniz.",
      bt: "Eski tür kayıt: Bluetooth cihazı. Wi-Fi Monitör artık Bluetooth taramıyor; bu kayıt uygulanmıyor. Silebilirsiniz."
    },

    /** Bant adı sinyal hücresinde: "2.4GHz", "5.0GHz" (kullanıcı isteği 2026-11-12: "2.4GHz=-83dB" biçimi). */
    BAND_SHORT: { "2.4": "2.4GHz", "5": "5.0GHz", "6": "6.0GHz", "?": "?GHz" },

    /**
     * @param getFixed {Function} () → güncel güvenilir listesi
     * @param remove {Function} (ids) → Promise; siler ve listeyi tazeler
     * @param reload {Function?} () → Promise; güvenilir listesini sunucudan yeniden okur (kapsam değişikliğinden sonra)
     */
    open(getFixed, remove, reload) {
      const esc = qx.bom.String.escape;
      // Satırlar kırılmasın (kullanıcı isteği): geniş pencere (ekrana sığdığı kadar), hücreler tek satır; sığmazsa yatay kaydırma.
      const bounds = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280 };
      const win = ankamon.ui.Dialog.window("Wi-Fi Monitör — güvenilir listesi", Math.min(1560, bounds.width - 40), { maximizable: true });
      win.setHeight(520);
      const Loc = ankamon.ui.boards.WifimonLocation;
      // Konum verisi: sensör × bant sinyal istatistiği, kayıtlı konumlar, sensör listesi (bkz. WifimonLocationsApi).
      let loc = null;
      const locBar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ marginBottom: 6 });
      const locInfo = new qx.ui.basic.Label("Sinyal verisi yükleniyor…").set({ rich: true, alignY: "middle" });
      const siblings = new qx.ui.form.CheckBox("Aynı fiziksel cihazın diğer adreslerine de uygula").set({ value: true,
        toolTipText: "Erişim noktası her radyosu (2,4 / 5 GHz) için ayrı adres yayınlar; ilk 5 baytı aynı adresler tek cihaz sayılır." });
      const refresh = new qx.ui.form.Button("Sinyal verisini yenile");
      locBar.add(locInfo, { flex: 1 });
      locBar.add(siblings);
      locBar.add(refresh);
      win.add(locBar);
      const html = new qx.ui.embed.Html("").set({ overflowY: "auto", overflowX: "auto" });
      win.add(html, { flex: 1 });
      const all = new qx.ui.form.CheckBox("Tümünü seç");
      const del = new qx.ui.form.Button("Seçilenleri listeden çıkar");
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      // Toplu kapsam: hedef (tesis geneli ya da bir tahtanın salonu) + uygula.
      const scope = new qx.ui.form.SelectBox().set({ width: 240, toolTipText: "İşaretli kayıtların yeni kapsamı. Tesis geneli: cihaz bütün " +
        "salonlardaki sensörlerde güvenilir sayılır. Salon: yalnız o salonun sensöründe güvenilir sayılır, başka yerde duyulursa yabancı görünür." });
      scope.add(new qx.ui.form.ListItem("Tesis geneli", null, ""));
      const apply = new qx.ui.form.Button("Seçilenlerin kapsamını değiştir");
      // Eklentilerin düğmeleri (ankamon.ext.Extensions.addWifiTrustedAction): işaretli kayıtlarla çalışır.
      const extButtons = ankamon.ext.Extensions.wifiTrustedActions().map(spec => {
        const button = new qx.ui.form.Button(spec.label).set({ toolTipText: spec.hint || null });
        button.addListener("execute", async () => {
          const ids = new Set(boxes().filter(b => b.checked).map(b => Number(b.dataset.id)));
          const rows = getFixed().filter(f => ids.has(f.id));
          if (!rows.length) {
            ankamon.ui.Dialog.alert("Önce listeden kayıt işaretleyin.", spec.label);
            return;
          }
          try {
            await spec.run(rows);
          } catch (e) {
            ankamon.ui.Dialog.error(e);
          }
        });
        return button;
      });
      const row = ankamon.ui.Dialog.buttons(win, extButtons.concat([apply, del, close]));
      row.addAt(all, 0);
      row.addAt(new qx.ui.core.Spacer(), 1, { flex: 1 });
      row.addAt(new qx.ui.basic.Label("Kapsam:").set({ alignY: "middle" }), 2);
      row.addAt(scope, 3);
      ankamon.io.Api.get("/boards").then(res => {
        if (scope.isDisposed()) {
          return;
        }
        const name = b => b.label || b.hostname || b.ip || "#" + b.id;
        (res.boards || []).slice().sort((a, b) => name(a).localeCompare(name(b), "tr")).forEach(b =>
          scope.add(new qx.ui.form.ListItem(`Salon: ${name(b)}`, null, String(b.id))));
      }).catch(() => {
        // Tahta listesi alınamazsa yalnız "Tesis geneli" seçilebilir.
      });

      const draw = () => {
        const list = getFixed();
        const td = "padding:3px 8px;border-bottom:1px solid rgba(127,127,127,.2);white-space:nowrap";
        const attr = t => esc(t || "").replace(/"/g, "&quot;");
        // Hücre: içerik + ipucu (title; fare kayınca kapanır — ui.ToolTipPolicy).
        const cell = (content, tip, style) => `<td style="${td}${style ? ";" + style : ""}"${tip ? ` title="${attr(tip)}"` : ""}>${content}</td>`;
        const muted = text => `<span style="opacity:.6">${esc(text)}</span>`;
        const sensorsById = new Map(((loc && loc.sensors) || []).map(x => [x.id, x]));
        const placed = new Map(((loc && loc.locations) || []).map(x => [x.addr, x]));
        const sensorOptions = ((loc && loc.sensors) || []).map(x => [x.id, Loc.sensorName(x)])
          .sort((a, b) => a[1].localeCompare(b[1], "tr"));
        const COLS = [
          ["", "Satırı işaretleyip alttaki düğmelerle (kapsam değiştir, listeden çıkar) toplu işlem yapın."],
          ["Tür", "Kaydın ne olduğu: erişim noktası (Wi-Fi yayınlayan cihaz) ya da Wi-Fi cihazı (telefon, yazıcı…); parantez içinde Wi-Fi adı."],
          ["MAC adresi", "Güvenilir sayılan radyonun donanım kimliği (MAC adresi). Güven bu adresle kurulur."],
          ["Fiziksel cihaz", "Aynı kutuya ait sayılan adreslerin ortak başı (ilk 5 bayt). Bir erişim noktası her radyosu için ayrı adres kullanır."],
          ["Adres sayısı", "Bu fiziksel cihaza ait sayılan MAC adresi sayısı (ör. 2,4 GHz ve 5 GHz radyoları)."],
          ["Bantlar", "Cihazın sensörlerce duyulduğu frekans bantları (2,4 / 5 GHz)."],
          ["Sensörlerde sinyal", "Cihazı en güçlü duyan iki sensör ve bant bant ortalama sinyal gücü (dB; 0'a yakın = güçlü)."],
          ["Konum/sensör önerisi", "Ölçümlere göre cihazın büyük olasılıkla yanında durduğu sensör (akıllı tahta)."],
          ["Konum (yanındaki sensör)", "Cihazın gerçekte hangi sensörün yanında olduğu — listeden seçin, hemen kaydedilir."],
          ["Kapsam", "Güvenin geçerli olduğu yer: tesis geneli (her salonda) ya da tek salon."],
          ["Güvenilir işaretleyen", "Bu kaydı güvenilir listesine ekleyen kullanıcı ve zamanı."]
        ];
        const SIGNAL_HELP = "Sinyal gücü dBm (desibel-miliwatt; hücrede kısaca dB) ile ölçülür ve eksi bir sayıdır: 0'a yakın oldukça güçlüdür. −40 çok yakın, " +
          "−60 iyi, −75 zayıf, −90 neredeyse duyulmuyor. Uzaklık iki katına çıkınca sinyal yaklaşık 6 dB düşer; duvar, kapı, insan " +
          "vücudu da zayıflatır. Ortalama birçok ölçümden alınır (n = ölçüm sayısı, σ = ölçümlerin ne kadar dalgalandığı).";
        // MAC'li kayıtlarda fiziksel cihaz (3 sütun), sinyal, öneri, konum; eski ağ adı / BT kayıtlarında boş hücreler.
        const locCells = f => {
          if (!(f.kind === "bssid" || f.kind === "probe")) {
            const na = "Eski tür kayıt: konum ve sinyal bilgisi tutulmaz.";
            return [1, 2, 3, 4, 5, 6].map(() => cell("", na)).join("");
          }
          if (!loc) {
            return `<td style="${td};opacity:.6" colspan="6">yükleniyor…</td>`;
          }
          const rows = Loc.groupStats(f.kind, f.value, loc.stats);
          const addrs = Array.from(new Set([f.value.toUpperCase()].concat(rows.map(r => r.addr)))).sort();
          const bands = ["2.4", "5", "6", "?"].filter(b => rows.some(r => r.band === b));
          const bandOf = a => Array.from(new Set(rows.filter(r => r.addr === a).map(r => Loc.BAND_LABEL[r.band] || r.band))).join(", ") ||
            "bu dönemde duyulmadı";
          const addrList = addrs.map(a => `${a} — ${bandOf(a)}`).join("\n");
          const prefix = f.kind === "bssid"
            ? cell(`<span style="font-family:monospace">${esc(Loc.groupKey(f.kind, f.value))}:xx</span>`,
              "Bir erişim noktası (tek kutu) her radyosu (2,4 GHz ve 5 GHz) ve yayınladığı her ağ için ayrı MAC adresi kullanır; bu " +
              "adreslerin genelde yalnız son baytı farklıdır. Bu yüzden ilk 5 baytı aynı adresler tek fiziksel cihaz sayılır (tahmin: " +
              "art arda numaralı iki cihaz da birleşebilir).\nBu cihazın adresleri:\n" + addrList)
            : cell(muted("tek adres"), "Wi-Fi cihazı (telefon, yazıcı…) tek adresle izlenir; başka adresle birleştirilmez.");
          const count = cell(String(addrs.length), `Bu fiziksel cihaza ait sayılan ${addrs.length} MAC adresi (yanında hangi bantta duyulduğu):\n` + addrList,
            "text-align:right");
          const bandCell = cell(bands.length ? esc(bands.map(b => this.BAND_SHORT[b]).join(" + ")) : muted("—"),
            "Cihazın sensörlerce duyulduğu frekans bantları. 2,4 GHz daha uzağa gider ve duvardan kolay geçer; 5 GHz duvarda çok " +
            "zayıflar. Bir sensör 5 GHz'i de güçlü duyuyorsa cihaz büyük olasılıkla o sensörle aynı odadadır." +
            (bands.length ? "" : "\nSon " + loc.days + " günde hiçbir sensör bu cihazı duymadı."));
          const ranked = Loc.rank(rows);
          const sug = Loc.suggest(ranked, sensorsById);
          const signalText = ranked.slice(0, 2).map(x => Loc.sensorName(sensorsById.get(x.boardId)) + " " +
            ["2.4", "5", "6", "?"].filter(b => x.bands[b]).map(b => `${this.BAND_SHORT[b]}=${Math.round(x.bands[b].avg)}dB`).join(" · ")).join(" | ");
          const sum = Loc.summary(ranked, sensorsById);
          const signal = cell(signalText ? esc(signalText) : muted("veri yok"),
            SIGNAL_HELP + "\n\n" + (sum.tip || `Bu cihazı son ${loc.days} günde hiçbir sensör duymadı (veri Wi-Fi Monitör açıkken kaydedilir).`));
          const suggestion = cell(sug ? esc(sug.text) : muted("—"),
            "Sensörlerin ölçümlerine göre cihazın büyük olasılıkla yanında durduğu sensör (akıllı tahta). En güçlü ortalama sinyali alan " +
            "sensör seçilir; 5 GHz zaten daha zayıf geldiği için 5 GHz ölçümüne 7 dB eklenerek karşılaştırılır. Parantezde güven derecesi " +
            "ve ikinci en iyi sensörden kaç dB önde olduğu yazar (fark büyükse öneri daha güvenilirdir)." + (sug ? "\n\n" + sug.tip :
              "\n\nHenüz ölçüm yok: Wi-Fi Monitör'ü bu cihazın yakınındaki tahtalarla açık tutun."));
          const here = placed.get(f.value.toUpperCase());
          const select = `<select data-addr="${attr(f.value.toUpperCase())}" data-kind="${attr(f.kind)}" style="max-width:240px">` +
            `<option value="">— belirlenmedi —</option>` +
            sensorOptions.map(([id, name]) => `<option value="${id}"${here && here.board_id === id ? " selected" : ""}>${esc(name)}` +
              `${sug && sug.boardId === id ? " ★" : ""}</option>`).join("") + "</select>";
          const place = cell(select, "Bu cihaz gerçekte hangi sensörün (akıllı tahtanın) yanında? Listeden seçin; seçim hemen kaydedilir. " +
            "★ = öneri. Listede sensörün kod adı, kod adı yoksa bilgisayar adı / kablolu MAC adresi yazar.\n\n" +
            (here ? `Kayıtlı konum: ${here.sensor_name}${here.sensor_mac ? " (kablolu MAC " + here.sensor_mac.toUpperCase() + ")" : ""} — ` +
              `${here.set_by}, ${new Date(here.set_ts).toLocaleString("tr-TR")}` : "Konum henüz belirlenmedi."));
          return prefix + count + bandCell + signal + suggestion + place;
        };
        const kindCell = f => {
          const label = this.KIND_LABEL[f.kind] || f.kind;
          const name = f.kind === "bssid" || f.kind === "probe" ? (f.label || "") : "";
          return cell(esc(label) + (name ? ` (${esc(name)})` : ""), this.KIND_HINT[f.kind] || label);
        };
        const macCell = f => f.kind === "ssid"
          ? cell(esc(f.value), "Eski kayıt: burada MAC adresi değil Wi-Fi ağ adı (SSID) var. Artık uygulanmıyor.")
          : cell(esc(f.value), "MAC adresi: Wi-Fi radyosunun fabrikada verilen donanım kimliği (6 bayt, iki haneli onaltılık sayılar). Güven bu " +
            "adresle kurulur — aynı Wi-Fi adını taşıyan başka bir cihaz (ör. bir telefonun paylaşım noktası) güvenilir sayılmaz.", "font-family:monospace");
        const scopeCell = f => f.board_id
          ? cell(esc("Salon: " + (f.board_name || "#" + f.board_id)), "Bu cihaz yalnız bu salonun sensöründe güvenilir sayılır; başka salonda " +
            "duyulursa yabancı görünür. Değiştirmek için satırı işaretleyip alttaki Kapsam kutusunu kullanın.")
          : cell("<b>Tesis geneli</b>", "Bu cihaz bütün salonlardaki sensörlerde güvenilir sayılır. Değiştirmek için satırı işaretleyip alttaki " +
            "Kapsam kutusunu kullanın.");
        html.setHtml(list.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px"><tr>` +
          COLS.map(([h, tip]) => `<th style="${td};text-align:left" title="${attr(tip)}">${esc(h)}</th>`).join("") + "</tr>" +
          list.map(f => "<tr>" + cell(`<input type="checkbox" data-id="${f.id}">`, COLS[0][1]) + kindCell(f) + macCell(f) + locCells(f) +
            scopeCell(f) + cell(`${esc(f.created_by || "")} · ${new Date(f.created_ts).toLocaleString("tr-TR")}`,
              `${f.created_by || "?"} bu kaydı ${new Date(f.created_ts).toLocaleString("tr-TR")} tarihinde güvenilir listesine ekledi.`, "opacity:.75") +
            "</tr>").join("") +
          "</table>" : `<div style="padding:12px;opacity:.75">Güvenilir listesi boş.</div>`);
        all.setValue(false);
      };
      const boxes = () => Array.from(html.getContentElement().getDomElement().querySelectorAll("input[data-id]"));
      all.addListener("changeValue", e => boxes().forEach(b => (b.checked = e.getData())));
      del.addListener("execute", async () => {
        const ids = boxes().filter(b => b.checked).map(b => Number(b.dataset.id));
        if (!ids.length) {
          return;
        }
        if (await ankamon.ui.Dialog.confirm(`${ids.length} kayıt güvenilir listesinden çıkarılacak; bu vericiler yeniden yabancı görünür.`, "Çıkar")) {
          await remove(ids);
          draw();
        }
      });
      apply.addListener("execute", async () => {
        const ids = boxes().filter(b => b.checked).map(b => Number(b.dataset.id));
        if (!ids.length) {
          ankamon.ui.Dialog.alert("Önce listeden kayıt işaretleyin.", "Wi-Fi Monitör");
          return;
        }
        const item = scope.getSelection()[0];
        const boardId = item.getModel() ? Number(item.getModel()) : null;
        if (!await ankamon.ui.Dialog.confirm(`${ids.length} kaydın kapsamı <b>${esc(item.getLabel())}</b> olacak.` +
          (boardId === null ? "" : "<br>Bu vericiler yalnız o salonun sensöründe güvenilir sayılır."), "Değiştir")) {
          return;
        }
        try {
          const res = await ankamon.io.Api.put("/wifimon/fixed", { ids, board_id: boardId });
          if (res.merged) {
            ankamon.ui.Dialog.alert(`${res.merged} kayıt hedef kapsamda zaten vardı; birleştirildi.`, "Wi-Fi Monitör");
          }
        } catch (err) {
          ankamon.ui.Dialog.error(err);
        }
        if (reload) {
          await reload();
        }
        draw();
      });
      const loadLoc = () => ankamon.io.Api.get("/wifimon/locations").then(res => {
        if (win.isDisposed()) {
          return;
        }
        loc = res;
        const sensors = new Set((res.stats || []).map(r => r.board_id)).size;
        const samples = (res.stats || []).reduce((a, r) => a + r.n, 0);
        locInfo.setValue(`Son ${res.days} gün: ${sensors} sensör, ${samples} ölçüm. Sinyal verisi Wi-Fi Monitör açıkken her taramada ` +
          "kaydedilir; ortalama dBm (5 GHz +7 dB düzeltmeli) en yüksek sensör önerilir (★). Satırların ipuçlarında bant bant ayrıntı.");
        draw();
      }).catch(err => locInfo.setValue("Sinyal verisi alınamadı: " + esc(String((err && err.message) || err))));
      refresh.addListener("execute", loadLoc);
      // Konum seçimi hemen kaydedilir (açılır listeler HTML tabloda; değişiklik kaba bağlı tek dinleyiciyle yakalanır).
      html.addListenerOnce("appear", () => html.getContentElement().getDomElement().addEventListener("change", async ev => {
        const sel = ev.target;
        if (!sel || !sel.dataset || !sel.dataset.addr) {
          return;
        }
        const addr = sel.dataset.addr;
        const kind = sel.dataset.kind;
        const addrs = siblings.getValue() && kind === "bssid" && loc
          ? Array.from(new Set([addr].concat(Loc.groupStats(kind, addr, loc.stats).map(r => r.addr)))) : [addr];
        try {
          await ankamon.io.Api.put("/wifimon/locations", { addrs, board_id: sel.value ? Number(sel.value) : null });
        } catch (err) {
          ankamon.ui.Dialog.error(err);
        }
        await loadLoc();
      }));
      win.open();
      draw();
      loadLoc();
    }
  }
});
