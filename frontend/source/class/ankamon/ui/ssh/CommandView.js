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
 * SSH etkinliği ▸ satıra çift tıklama (kullanıcı isteği 2026-11-11): üstte SSH ile gönderilen komut/betik — sözdizimi
 * renkli (highlight.js, BSD-3-Clause, https://highlightjs.org; bash/python/json otomatik tanınır) —, altta komutun
 * ÇIKTISI (stdout; stderr kırmızı). Çıktıyı sshpass sarmalayıcısı kaydeder (ilk 128 KB; ekran/dosya akışları, tüneller ve
 * web terminal kaydedilmez — bkz. backend SshActivityApi::output). Bağlantı sürerken çıktı 2 sn'de bir tazelenir.
 * İki bölme arasındaki ayırıcı sürüklenebilir; pencere boyutlandırılabilir/büyütülebilir.
 *
 * @asset(ankamon/hljs/*)
 */
qx.Class.define("ankamon.ui.ssh.CommandView", {
  extend: qx.core.Object,

  statics: {
    __loading: null,
    /** Renklendirmede denenecek diller (highlightAuto alt kümesi). */
    LANGUAGES: ["bash", "python", "json", "perl", "ini", "xml"],

    /** highlight.js'i (bir kez) yükler; tema arayüz zeminine göre açık/koyu. @return {Promise} */
    load() {
      const C = ankamon.ui.ssh.CommandView;
      if (!C.__loading) {
        const rm = qx.util.ResourceManager.getInstance();
        qx.bom.Stylesheet.includeFile(rm.toUri("ankamon/hljs/" + (C.__isDark() ? "github-dark" : "github") + ".min.css"));
        const loader = new qx.util.DynamicScriptLoader([rm.toUri("ankamon/hljs/highlight.min.js")]);
        C.__loading = new Promise((resolve, reject) => {
          loader.addListenerOnce("ready", () => resolve(window.hljs));
          loader.addListenerOnce("failed", e => {
            C.__loading = null;
            reject(new Error(String(e.getData())));
          });
          loader.start();
        });
      }
      return C.__loading;
    },

    /** Arayüz zemini koyu mu (tema rengi "surface"in parlaklığı). */
    __isDark() {
      try {
        const rgb = qx.util.ColorUtil.stringToRgb(qx.theme.manager.Color.getInstance().resolve("surface"));
        return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 128;
      } catch (e) {
        return false;
      }
    }
  },

  /** @param conn {Map} ui.ssh.ActivityStore bağlantısı */
  construct(conn) {
    super();
    this.__conn = conn;
    const W = ankamon.ui.ssh.ActivityWindow;
    const store = ankamon.ui.ssh.ActivityStore.getInstance();
    const esc = qx.bom.String.escape;
    const name = store.nameOf(conn.target);
    const win = this.__win = ankamon.ui.Dialog.window(`SSH komutu — ${name || conn.target}`, 900, { maximizable: true });
    win.set({ height: 620, resizable: true, contentPadding: 8, layout: new qx.ui.layout.VBox(6) });
    win.add(new qx.ui.basic.Label(
      `<b>${esc(conn.target)}</b>${conn.port ? ":" + esc(conn.port) : ""} · ${esc(W.SOURCES[conn.src] || conn.src)} · ` +
      `${new Date(conn.start * 1000).toLocaleString("tr-TR")}` + (conn.tunnel ? ` · tünel → ${esc(conn.tunnel)}` : "") +
      (conn.end ? ` · süre ${ankamon.util.Format.duration(conn.end - conn.start)}` : " · <b>sürüyor</b>")
    ).set({ rich: true, textColor: "app-muted" }));

    const split = new qx.ui.splitpane.Pane("vertical");
    const box = (title, html) => {
      const pane = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
      pane.add(new qx.ui.basic.Label(title).set({ font: "bold" }));
      html.set({ overflowX: "auto", overflowY: "auto", selectable: true, nativeContextMenu: true,
        decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border" }) });
      pane.add(html, { flex: 1 });
      return pane;
    };
    this.__code = new qx.ui.embed.Html("");
    this.__output = new qx.ui.embed.Html("");
    split.add(box("Komut / betik", this.__code), 3);
    split.add(box("Çıktı", this.__output), 2);
    win.add(split, { flex: 1 });

    const copy = new qx.ui.form.Button("Komutu kopyala");
    copy.addListener("execute", () => ankamon.util.Clipboard.copy(conn.cmd || ""));
    const copyOut = new qx.ui.form.Button("Çıktıyı kopyala");
    copyOut.addListener("execute", () => ankamon.util.Clipboard.copy(this.__outText || ""));
    const close = new qx.ui.form.Button("Kapat");
    close.addListener("execute", () => win.close());
    ankamon.ui.Dialog.buttons(win, [copy, copyOut, close]);

    this.__showCode();
    this.__timer = new qx.event.Timer(2000);
    this.__timer.addListener("interval", this.__loadOutput, this);
    this.__loadOutput();
    win.addListener("close", () => this.dispose());
    win.open();
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
  },

  members: {
    __conn: null,
    __win: null,
    __code: null,
    __output: null,
    __timer: null,
    __outText: "",

    __pre(inner, cls) {
      return `<pre style="margin:0;padding:8px;white-space:pre;font-family:monospace;font-size:12px;line-height:1.45">` +
        `<code class="${cls || ""}" style="background:transparent;padding:0">${inner}</code></pre>`;
    },

    async __showCode() {
      const code = String(this.__conn.cmd || "");
      const esc = qx.bom.String.escape;
      if (!code) {
        this.__code.setHtml(this.__pre("<i>(komut yok — etkileşimli kabuk ya da tünel bağlantısı)</i>"));
        return;
      }
      this.__code.setHtml(this.__pre(esc(code)));
      try {
        const hljs = await ankamon.ui.ssh.CommandView.load();
        if (this.isDisposed() || !hljs) {
          return;
        }
        const res = hljs.highlightAuto(code, ankamon.ui.ssh.CommandView.LANGUAGES);
        this.__code.setHtml(this.__pre(res.value, "hljs language-" + (res.language || "bash")));
        this.__code.setToolTipText(`Sözdizimi: ${res.language || "?"} (highlight.js)`);
      } catch (e) {
        // kütüphane yüklenemedi: düz metin kalır
      }
    },

    async __loadOutput() {
      const conn = this.__conn;
      const esc = qx.bom.String.escape;
      if (!/^\d+$/.test(String(conn.pid))) {
        this.__output.setHtml(this.__pre("<i>Bu bağlantının çıktısı kaydedilmez (web terminal / dosya yöneticisi).</i>"));
        this.__timer.stop();
        return;
      }
      let res;
      try {
        res = await ankamon.io.Api.get("/ssh-activity/output", { key: conn.key });
      } catch (e) {
        this.__output.setHtml(this.__pre("<i>Çıktı okunamadı: " + esc(e.message || String(e)) + "</i>"));
        return;
      }
      if (this.isDisposed()) {
        return;
      }
      if (!res.available) {
        this.__output.setHtml(this.__pre("<i>" + esc(res.reason || "Çıktı yok.") + "</i>"));
        this.__timer.stop();
        return;
      }
      this.__outText = res.stdout + (res.stderr ? "\n" + res.stderr : "");
      const parts = [];
      parts.push(res.stdout ? esc(res.stdout) : "<i style=\"opacity:.6\">(standart çıktı boş)</i>");
      if (res.stderr) {
        parts.push(`<span style="color:#e74c3c">${esc(res.stderr)}</span>`);
      }
      if (res.truncated) {
        parts.push("<i style=\"opacity:.7\">… (ilk 128 KB kaydedildi)</i>");
      }
      if (res.running) {
        parts.push("<i style=\"opacity:.7\">… sürüyor</i>");
      }
      this.__output.setHtml(this.__pre(parts.join("\n")));
      if (res.running) {
        this.__timer.start();
      } else {
        this.__timer.stop();
      }
    }
  }
});
