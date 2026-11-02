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
 * Sağ menü "Wi-Fi Monitör": bilgisayarın Wi-Fi kartı, bağlantısı, çevresindeki ağlar ve Bluetooth cihazları tek tabloda (bkz. worker
 * screen/wifi.py). Tahta başına bir pencere. Varsayılan tek tarama, "Yenile" yeni tarama yapar; "Sürekli izle" açıkken liste tazelenir.
 * Wi-Fi/Bluetooth kapalıysa tarama süresince tahtada geçici açılır (kayıtlı ağa bağlanmaz), sonra eski durumuna döner.
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
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(12).set({ alignY: "middle" }));
      const refresh = new qx.ui.form.Button("Yenile");
      const watchBox = new qx.ui.form.CheckBox("Sürekli izle").set({
        toolTipText: "Açıkken liste sürekli tazelenir; kapalı radyo izleme bitene kadar açık kalır."
      });
      bar.add(refresh);
      bar.add(watchBox);
      win.add(bar);
      const status = new qx.ui.basic.Label("Bağlanılıyor…").set({ rich: true, wrap: true, allowGrowX: true });
      win.add(status);
      const html = new qx.ui.embed.Html("").set({ overflowY: "auto" });
      win.add(html, { flex: 1 });
      this.__open.set(board.id, win);

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let closed = false;
      let ws = null;
      let line = "";
      let lastData = null;
      const red = text => `<span style="color:#d93025">${esc(text)}</span>`;
      const bars = pct => {
        if (pct === null || pct === undefined) {
          return "";
        }
        const color = pct >= 60 ? "#2fa84a" : pct >= 35 ? "#e8a200" : "#d93025";
        return `<span style="display:inline-block;width:80px;height:9px;background:rgba(127,127,127,.25);border-radius:5px;vertical-align:middle">` +
          `<span style="display:block;width:${pct}%;height:100%;background:${color};border-radius:5px"></span></span> ${pct}%`;
      };
      const btNote = (bt, ended) => {
        if (bt === "absent") {
          return "Bu tahtada Bluetooth adaptörü yok.";
        }
        if (bt === "temp") {
          return ended ? "Bluetooth geçici açıldı, tarama sonrası eski durumuna döndürüldü." : "Bluetooth geçici açık.";
        }
        return bt && bt.startsWith("fail") ? red("Bluetooth açılamadı; cihazlar listelenemedi.") : "";
      };
      const wifiNote = (info, watching) => {
        if (info.wifi_fail) {
          return red(info.wifi_fail === "autoconnect"
            ? "Otomatik bağlanma kapatılamadığından Wi-Fi açılmadı."
            : "Wi-Fi geçici açılamadı; ağlar listelenemedi.");
        }
        if (info.wifi_temp !== "1") {
          return "";
        }
        return watching ? "Wi-Fi izleme için geçici açık; izleme bitince kapatılacak." : "Wi-Fi geçici açık, tarama sonrası kapatılacak.";
      };
      const summaryLine = (d, radioValue) => {
        const radio = radioValue === "enabled" ? "açık" : radioValue === "disabled" ? "kapalı" : "bilinmiyor";
        const wifiCount = d.rows.filter(r => r.kind === "wifi").length;
        const btCount = d.rows.length - wifiCount;
        const info = d.info || {};
        const summary = d.device
          ? `Kart: <b>${esc(d.device)}</b> · Wi-Fi <b style="color:${radioValue === "enabled" ? "inherit" : "#d93025"}">${radio}</b> · ` +
            (d.connection ? `Bağlı: <b>${esc(d.connection)}</b>` : "bağlı değil")
          : "Bu bilgisayarda Wi-Fi kartı görünmüyor.";
        const counts = `${wifiCount} ağ` + (info.bt === "on" || info.bt === "temp" ? ` · ${btCount} Bluetooth` : "") +
          ` · ${new Date(d.at * 1000).toLocaleTimeString("tr-TR")}`;
        return `${summary} · ${counts}`;
      };
      const showStatus = notes => {
        const text = notes.filter(Boolean).join(" ");
        status.setValue(line && text ? `${line}<br>${text}` : line || text);
      };
      const render = d => {
        lastData = d;
        line = summaryLine(d, d.radio);
        const info = d.info || {};
        showStatus([wifiNote(info, watchBox.getValue()), btNote(info.bt, false)]);
        const th = "text-align:left;padding:4px 8px;border-bottom:1px solid rgba(127,127,127,.4);position:sticky;top:0;background:inherit";
        const td = "padding:3px 8px;white-space:nowrap";
        html.setHtml(`<table style="border-collapse:collapse;font-size:13px;width:100%"><tr>` +
          ["Tür", "Ad", "Sinyal", "Kanal", "Frekans", "Hız", "Güvenlik", "Adres"].map(h => `<th style="${th}">${h}</th>`).join("") + "</tr>" +
          d.rows.map(n => {
            const isWifi = n.kind === "wifi";
            const name = n.name || (isWifi ? "(gizli ağ)" : "(adsız)");
            const security = isWifi ? n.security || "açık" : n.security;
            return `<tr style="${n.active ? "font-weight:600;background:rgba(26,115,232,.12)" : ""}">` +
              `<td style="${td}">${isWifi ? "Wi-Fi" : "Bluetooth"}</td>` +
              `<td style="${td}">${n.active ? "● " : ""}${esc(name)}</td><td style="${td}">${bars(n.signal)}</td>` +
              `<td style="${td}">${esc(n.chan)}</td><td style="${td}">${esc(n.freq)}</td><td style="${td}">${esc(n.rate)}</td>` +
              `<td style="${td}">${esc(security)}</td><td style="${td};opacity:.7">${esc(n.addr)}</td></tr>`;
          }).join("") + "</table>");
      };
      const renderDone = d => {
        if (lastData) {
          line = summaryLine(lastData, d.radio);
        }
        const parts = [];
        if (d.result === "fail" || d.result === "lock") {
          parts.push(red("Tahtadaki kartın eski durumuna dönmesi doğrulanamadı; lütfen denetleyin."));
        } else if (d.wifi_fail) {
          parts.push(wifiNote(d, false));
        } else if (d.wifi_temp === "1") {
          parts.push(d.result === "shared"
            ? "Wi-Fi geçici açıldı; bu tahtadaki başka bir tarama bitince kapatılacak."
            : "Wi-Fi geçici açıldı, tarama sonrası kapatıldı.");
        }
        parts.push(btNote(d.bt, d.result !== "shared"));
        showStatus(parts);
      };
      const syncControls = busy => refresh.setEnabled(!busy && !watchBox.getValue());
      const discard = sock => {
        if (sock) {
          sock.onmessage = sock.onclose = null;
          sock.close();
        }
      };
      const connect = () => {
        const watching = watchBox.getValue();
        const sock = ws = new WebSocket(`${proto}//${location.host}/screen/ws/wifi/${board.id}${watching ? "?watch=1" : ""}`);
        syncControls(true);
        sock.onmessage = e => {
          const d = JSON.parse(e.data);
          if (d.phase === "scanning") {
            showStatus(["Taranıyor…", wifiNote(d.info, watching), btNote(d.info.bt, false)]);
          } else if (d.phase === "data") {
            render(d);
          } else if (d.phase === "done") {
            renderDone(d);
          }
        };
        sock.onclose = e => {
          if (closed || sock !== ws) {
            return;
          }
          ws = null;
          syncControls(false);
          if (e.code === 1000) {
            return;
          }
          const why = { 4001: "Tahta bulunamadı.", 4002: "Tahtaya ulaşılamıyor.", 4003: "SSH girişi reddedildi.", 4009: "Tahtada nmcli yok.", 4010: "Tahtada /run dizinine yazılamıyor." };
          const retry = watchBox.getValue() && ![4001, 4003, 4009, 4010].includes(e.code);
          status.setValue(red((why[e.code] || "Bağlantı kesildi.") + (retry ? " Yeniden deneniyor…" : "")));
          if (retry) {
            qx.event.Timer.once(() => !closed && !ws && watchBox.getValue() && connect(), null, 5000);
          }
        };
      };
      refresh.addListener("execute", () => {
        if (!ws) {
          connect();
        }
      });
      watchBox.addListener("changeValue", e => {
        if (e.getData()) {
          // Eski oturum kapanırken yenisi başlarsa tahtadaki sayım radyoyu boşuna kapatmaz (bkz. wifi_remote_scan.py).
          discard(ws);
          connect();
        } else if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send("stop");
          showStatus(["İzleme durduruluyor…"]);
          syncControls(true);
        } else if (ws) {
          discard(ws);
          ws = null;
          syncControls(false);
        } else {
          syncControls(false);
        }
      });
      win.addListener("close", () => {
        closed = true;
        this.__open.delete(board.id);
        discard(ws);
      });
      win.open();
      connect();
    }
  }
});
