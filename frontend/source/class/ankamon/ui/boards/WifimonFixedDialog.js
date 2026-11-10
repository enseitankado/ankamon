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
 * kapsamı (okul geneli / sınıf) ve işaretleyen; seçilenler listeden çıkarılır ya da kapsamları topluca değiştirilir (okul geneli ya da
 * seçilen tahtanın sınıfı — kullanıcı isteği 2026-11-10; PUT /api/wifimon/fixed). Eski "ağ adı" ve "Bluetooth" kayıtları artık
 * uygulanmaz (güven yalnız MAC ile — kullanıcı isteği 2026-11-06), silinebilsinler diye listelenir (bkz. ui.boards.WifiMonitor, backend
 * WifimonFixedEmittersApi).
 */
qx.Class.define("ankamon.ui.boards.WifimonFixedDialog", {
  type: "static",

  statics: {
    KIND_LABEL: { ssid: "Ağ adı (eski kayıt — uygulanmıyor)", bssid: "Erişim noktası (MAC)", bt: "Bluetooth (eski kayıt — uygulanmıyor)",
      probe: "Wi-Fi cihazı (MAC; ağ arayan / bağlı)" },

    /**
     * @param getFixed {Function} () → güncel güvenilir listesi
     * @param remove {Function} (ids) → Promise; siler ve listeyi tazeler
     * @param reload {Function?} () → Promise; güvenilir listesini sunucudan yeniden okur (kapsam değişikliğinden sonra)
     */
    open(getFixed, remove, reload) {
      const esc = qx.bom.String.escape;
      // Satırlar kırılmasın (kullanıcı isteği): geniş pencere (ekrana sığdığı kadar), hücreler tek satır; sığmazsa yatay kaydırma.
      const bounds = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280 };
      const win = ankamon.ui.Dialog.window("Wi-Fi Monitör — güvenilir listesi", Math.min(1180, bounds.width - 40), { maximizable: true });
      win.setHeight(480);
      const html = new qx.ui.embed.Html("").set({ overflowY: "auto", overflowX: "auto" });
      win.add(html, { flex: 1 });
      const all = new qx.ui.form.CheckBox("Tümünü seç");
      const del = new qx.ui.form.Button("Seçilenleri listeden çıkar");
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      // Toplu kapsam: hedef (okul geneli ya da bir tahtanın sınıfı) + uygula.
      const scope = new qx.ui.form.SelectBox().set({ width: 240, toolTipText: "Seçilen kayıtların yeni kapsamı" });
      scope.add(new qx.ui.form.ListItem("Okul geneli", null, ""));
      const apply = new qx.ui.form.Button("Seçilenlerin kapsamını değiştir");
      const row = ankamon.ui.Dialog.buttons(win, [apply, del, close]);
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
          scope.add(new qx.ui.form.ListItem(`Sınıf: ${name(b)}`, null, String(b.id))));
      }).catch(() => {
        // Tahta listesi alınamazsa yalnız "Okul geneli" seçilebilir.
      });

      const draw = () => {
        const list = getFixed();
        const td = "padding:3px 8px;border-bottom:1px solid rgba(127,127,127,.2);white-space:nowrap";
        html.setHtml(list.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px"><tr>` +
          ["", "Tür", "Değer", "Ad", "Kapsam", "İşaretleyen"].map(h => `<th style="${td};text-align:left">${h}</th>`).join("") + "</tr>" +
          list.map(f => `<tr><td style="${td}"><input type="checkbox" data-id="${f.id}"></td>` +
            `<td style="${td}">${this.KIND_LABEL[f.kind] || esc(f.kind)}</td>` +
            `<td style="${td};font-family:${f.kind === "ssid" ? "inherit" : "monospace"}">${esc(f.value)}</td>` +
            `<td style="${td}">${esc(f.label || "")}</td>` +
            `<td style="${td}">${f.board_id ? esc(f.board_name || "#" + f.board_id) : "<b>Okul geneli</b>"}</td>` +
            `<td style="${td};opacity:.75">${esc(f.created_by || "")} · ${new Date(f.created_ts).toLocaleString("tr-TR")}</td></tr>`).join("") +
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
          (boardId === null ? "" : "<br>Bu vericiler yalnız o tahtanın sensöründe güvenilir sayılır."), "Değiştir")) {
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
      win.open();
      draw();
    }
  }
});
