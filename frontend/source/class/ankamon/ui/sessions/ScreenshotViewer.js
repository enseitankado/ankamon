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
 * Zaman çizelgesindeki ekran görüntüsünü açan kalıcı (modal) pencere: "Yay" işaretliyken (varsayılan) görüntü oranı korunarak pencereye sığar;
 * işareti kaldırınca özgün boyutunda görünür ve kaydırma çubukları ya da sol tuşla sürükleme ile gezilir. "Tam ekran" tarayıcı tam ekranına geçirir (Esc ile döner). Kimlik bilgileri başlıkta da görünür.
 */
qx.Class.define("ankamon.ui.sessions.ScreenshotViewer", {
  type: "static",

  statics: {
    /**
     * @param shot {Map} /screenshots satırı
     * @param canDelete {Boolean?} "Sil" düğmesi (logs.manage)
     * @param onDeleted {Function?} silindikten sonra
     */
    open(shot, canDelete, onDeleted) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1280, height: 800 };
      const win = new qx.ui.window.Window(`Ekran görüntüsü — ${shot.board_name}`).set({
        modal: true, contentPadding: 0, layout: new qx.ui.layout.VBox(),
        width: Math.min(1024, bounds.width - 40), height: Math.min(700, bounds.height - 40)
      });
      // Pencere şeridi (ui.WindowDock) pencereleri kipsiz yapar; bu pencere istenerek kalıcıdır.
      win.setUserData("ankamon.keepModal", true);

      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ padding: [6, 10] });
      const who = shot.session_username ? "oturum: " + esc(shot.session_username) : "oturum yok";
      bar.add(new qx.ui.basic.Label(
        `<b>${esc(shot.board_name)}</b> · ${who} ·${F.dateTime(shot.taken_at * 1000)} · çeken: ${esc(shot.taken_by)} · ${F.bytes(shot.bytes)}`
      ).set({ rich: true, alignY: "middle", selectable: true }), { flex: 1 });
      const stretch = new qx.ui.form.CheckBox("Yay").set({ value: true, alignY: "middle", toolTipText: "Görüntüyü pencereye sığdır; kaldırınca özgün boyut" });
      bar.add(stretch);
      const full = new qx.ui.form.Button("⛶ Tam ekran");
      bar.add(full);
      if (canDelete) {
        const del = new qx.ui.form.Button(`${ankamon.ui.Shell.ICON.delete} Sil`);
        del.addListener("execute", async () => {
          const ok = await ankamon.ui.Dialog.confirm("Bu ekran görüntüsü kalıcı olarak silinsin mi?", "Sil");
          if (!ok) {
            return;
          }
          try {
            await ankamon.io.Api.del(`/screenshots/${shot.id}`);
            win.close();
            if (onDeleted) {
              onDeleted();
            }
          } catch (e) {
            ankamon.ui.Dialog.error(e);
          }
        });
        bar.add(del);
      }
      win.add(bar);

      const url = `/api/screenshots/${shot.id}/image`;
      const html = new qx.ui.embed.Html(
        `<div class="tm-shot-box" style="width:100%;height:100%;background:#111;text-align:center">` +
        `<img src="${url}" alt="" draggable="false"></div>`);
      win.add(html, { flex: 1 });
      const applyStretch = () => {
        const dom = html.getContentElement().getDomElement();
        const box = dom && dom.querySelector(".tm-shot-box");
        const img = box && box.querySelector("img");
        if (!img) {
          return;
        }
        const on = stretch.getValue();
        box.style.overflow = on ? "hidden" : "auto";
        box.style.cursor = on ? "default" : "grab";
        Object.assign(img.style, on
          ? { display: "block", width: "100%", height: "100%", objectFit: "contain", maxWidth: "none" }
          : { display: "inline-block", width: "auto", height: "auto", objectFit: "", maxWidth: "none" });
      };
      stretch.addListener("changeValue", applyStretch);
      // Özgün boyutta sol tuşla sürükleme: kaydırma çubuklarıyla aynı konumu değiştirir.
      html.addListenerOnce("appear", () => {
        applyStretch();
        const box = html.getContentElement().getDomElement().querySelector(".tm-shot-box");
        let drag = null;
        const move = e => {
          box.scrollLeft = drag.left - (e.clientX - drag.x);
          box.scrollTop = drag.top - (e.clientY - drag.y);
          e.preventDefault();
        };
        const up = () => {
          drag = null;
          box.style.cursor = stretch.getValue() ? "default" : "grab";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        box.addEventListener("pointerdown", e => {
          if (e.button !== 0 || stretch.getValue()) {
            return;
          }
          drag = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
          box.style.cursor = "grabbing";
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          e.preventDefault();
        });
      });
      full.addListener("execute", () => {
        const box = html.getContentElement().getDomElement().querySelector(".tm-shot-box");
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (box && box.requestFullscreen) {
          box.requestFullscreen();
        }
      });
      win.addListener("close", () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
        qx.event.Timer.once(() => win.destroy(), null, 0);
      });
      win.addListenerOnce("appear", () => win.center());
      root.add(win);
      win.open();
    }
  }
});
