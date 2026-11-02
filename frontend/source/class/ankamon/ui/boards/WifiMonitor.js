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
 * Sağ menü "Wi-Fi Monitör": bilgisayarın Wi-Fi kartı, bağlantısı ve çevresindeki ağlar, canlı (bkz. worker screen/wifi.py). Salt
 * okunur; tahta başına bir pencere. Kart ya da bağlantı değiştirilmez.
 */
qx.Class.define("ankamon.ui.boards.WifiMonitor", {
  type: "static",

  statics: {
    __open: new Map(),

    open(board) {
      const name = board.label || board.hostname || board.ip || "#" + board.id;
      const existing = this.__open.get(board.id);
      if (existing) {
        existing.open();
        existing.focus();
        return;
      }
      const esc = qx.bom.String.escape;
      const win = ankamon.ui.Dialog.window("Wi-Fi Monitör — " + name, 760, { maximizable: true });
      win.setHeight(520);
      const status = new qx.ui.basic.Label("Bağlanılıyor…").set({ rich: true, wrap: true, allowGrowX: true });
      win.add(status);
      const html = new qx.ui.embed.Html("").set({ overflowY: "auto" });
      win.add(html, { flex: 1 });
      this.__open.set(board.id, win);

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let closed = false;
      let ws = null;
      const bars = pct => {
        const color = pct >= 60 ? "#2fa84a" : pct >= 35 ? "#e8a200" : "#d93025";
        return `<span style="display:inline-block;width:80px;height:9px;background:rgba(127,127,127,.25);border-radius:5px;vertical-align:middle">` +
          `<span style="display:block;width:${pct}%;height:100%;background:${color};border-radius:5px"></span></span> ${pct}%`;
      };
      const render = d => {
        const radio = d.radio === "enabled" ? "açık" : d.radio === "disabled" ? "kapalı" : "bilinmiyor";
        if (!d.device) {
          status.setValue("Bu bilgisayarda Wi-Fi kartı görünmüyor.");
        } else {
          const color = d.radio === "enabled" ? "inherit" : "#d93025";
          status.setValue(`Kart: <b>${esc(d.device)}</b> · Wi-Fi <b style="color:${color}">${radio}</b> · ` +
            (d.connection ? `Bağlı: <b>${esc(d.connection)}</b>` : "bağlı değil") +
            ` · ${d.networks.length} ağ · ${new Date(d.at * 1000).toLocaleTimeString("tr-TR")}` +
            (d.radio === "disabled" ? "<br>Wi-Fi kapalıyken çevredeki ağlar taranamaz; bu pencere kartı açmaz." : ""));
        }
        const th = "text-align:left;padding:4px 8px;border-bottom:1px solid rgba(127,127,127,.4);position:sticky;top:0;background:inherit";
        const td = "padding:3px 8px;white-space:nowrap";
        html.setHtml(`<table style="border-collapse:collapse;font-size:13px;width:100%"><tr>` +
          ["Ağ (SSID)", "Sinyal", "Kanal", "Frekans", "Hız", "Güvenlik", "BSSID"].map(h => `<th style="${th}">${h}</th>`).join("") + "</tr>" +
          d.networks.map(n => `<tr style="${n.active ? "font-weight:600;background:rgba(26,115,232,.12)" : ""}">` +
            `<td style="${td}">${n.active ? "● " : ""}${esc(n.ssid || "(gizli ağ)")}</td><td style="${td}">${bars(n.signal)}</td>` +
            `<td style="${td}">${esc(n.chan)}</td><td style="${td}">${esc(n.freq)}</td><td style="${td}">${esc(n.rate)}</td>` +
            `<td style="${td}">${esc(n.security || "açık")}</td><td style="${td};opacity:.7">${esc(n.bssid)}</td></tr>`).join("") + "</table>");
      };
      const connect = () => {
        ws = new WebSocket(`${proto}//${location.host}/screen/ws/wifi/${board.id}`);
        ws.onmessage = e => render(JSON.parse(e.data));
        ws.onclose = e => {
          if (closed) {
            return;
          }
          const why = { 4001: "Tahta bulunamadı.", 4002: "Tahtaya ulaşılamıyor; yeniden deneniyor…", 4003: "SSH girişi reddedildi.", 4009: "Tahtada nmcli yok." };
          status.setValue(`<span style="color:#d93025">${esc(why[e.code] || "Bağlantı kesildi; yeniden deneniyor…")}</span>`);
          if (![4001, 4003, 4009].includes(e.code)) {
            qx.event.Timer.once(() => !closed && connect(), null, 5000);
          }
        };
      };
      win.addListener("close", () => {
        closed = true;
        this.__open.delete(board.id);
        if (ws) {
          ws.close();
        }
      });
      win.open();
      connect();
    }
  }
});
