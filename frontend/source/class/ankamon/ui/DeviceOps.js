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
 * Cihaz işlemleri (tek ya da çoklu): web terminal, kapatma, uyandırma (WoL), hazır işlem + serbest komut
 * (run — tek pencerede birleşik). Hem Cihazlar grid'i hem de sol ağaçtaki sağ menüler buradan çağırır.
 * Her işlem yetki ister; kullanıcıda yoksa düğme/menü zaten eklenmez, sunucu da ayrıca denetler.
 */
qx.Class.define("ankamon.ui.DeviceOps", {
  type: "static",

  statics: {
    /**
     * Cihaz ekle (device null) / Düzenle. Düzenle artık Cihaz ayrıntıları penceresi (kullanıcı isteği 2026-11-09):
     * cihazın ağ envanteri satırı + "Cihaz" sekmesinde cihaza özel alanlar (bkz. ui.network.DeviceWindow, deviceForm).
     * Cihazlar'ın ve Bakım ▸ Ahenk'in sağ menüsündeki "Düzenle" buradan geçer (tek kaynak). Verilen satırda kayıt
     * alanları yoksa (ör. Ahenk grid'i) cihaz /api/devices/{id}'den okunur.
     * @param device {Map|null} @param onSaved {Function?} kayıttan sonra (grid'i tazelemek için) @param user {Map?}
     */
    async editDevice(device, onSaved, user = null) {
      if (device && device.id) {
        ankamon.ui.network.DeviceWindow.open({ device, onSaved, user });
        return;
      }
      const win = ankamon.ui.Dialog.window("Cihaz ekle", 460);
      const fields = this.deviceForm(null);
      fields.form.softPlaceholders(); // örnek değerler ("ör. A Blok…", "de:ad:…") girilmiş değer sanılmasın
      win.add(fields.form);
      const cancel = new qx.ui.form.Button("Vazgeç");
      const save = new qx.ui.form.Button("Kaydet");
      cancel.addListener("execute", () => win.close());
      save.addListener("execute", async () => {
        const values = fields.read();
        if (!values) {
          return;
        }
        try {
          await ankamon.io.Api.post("/devices", values);
          win.close();
          if (onSaved) {
            onSaved();
          }
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      ankamon.ui.Dialog.buttons(win, [cancel, save]);
      win.open();
    },

    /**
     * Cihaz kaydının düzenlenebilir alanları (devices tablosu, PATCH /api/devices/{id}) — TEK liste: Cihaz ekle penceresi
     * ve Cihaz ayrıntıları ▸ Cihaz sekmesi buradan kurulur; cihaza yeni düzenlenebilir alan eklenince ikisinde de
     * kendiliğinden görünür (kullanıcı isteği 2026-11-09).
     * @param device {Map|null} null: yeni cihaz (takma ad ve kablolu MAC zorunlu)
     * @param opts {Map?} {noLabel: true} — takma ad alanı yok (Cihaz ayrıntıları'nda tek takma ad Genel sekmesinde);
     *   {noLocation: true} — fiziksel konum alanı yok (aynı nedenle Genel sekmesinde)
     * @return {Map} {form, read()} — read(): doğrulanmış değerler ya da (hata gösterilip) null
     */
    deviceForm(device, opts = {}) {
      const form = new ankamon.ui.Form();
      const adding = !device;
      device = device || { monitor_enabled: true, exporter_port: 9100 };
      // Yeni cihazda takma ad ve kablolu MAC zorunlu (bkz. DevicesApi::create): kablolu MAC cihazı ağ taramasında
      // bulur (IP girilmezse oradan dolar), uzaktan uyandırmayı sağlar. Kablosuz MAC (Wi-Fi kartı) isteğe bağlı —
      // cihaz Wi-Fi'ye bağlanınca oturum yoklaması kendiliğinden doldurur. Bilgisayar adı elle girilmez — cihazın
      // loglarından ve donanım bilgisinden öğrenilir.
      const mark = adding ? " *" : "";
      if (!opts.noLabel) {
        form.text("label", "Takma ad" + mark, device.label, "ör. A Blok 2. Derslik");
      }
      if (!opts.noLocation) {
        // Fiziksel konum: Tesis Envanteri kodu (il.ilçe.tesis.bina.kat.salon) ya da serbest metin, hazır değer listeli.
        form.addField("location", ankamon.ui.network.PhysicalLocation.LABEL, ankamon.ui.network.PhysicalLocation.field(device.location));
      }
      form.text("ip", "IP adresi", device.ip).setToolTipText(
        "Cihazın bilinen adresi. Ağ taraması cihazın MAC'ini başka adreste görürse ya da cihaz yeni adresinden log " +
        "gönderirse kendiliğinden güncellenir.");
      form.text("mac", "Kablolu MAC" + mark, device.mac, "de:ad:de:ad:de:ad").setToolTipText(
        "Kablolu ağ kartının MAC adresi: iki nokta üst üste ile ayrılmış altı onaltılık çift (ör. de:ad:de:ad:de:ad). " +
        "Uzaktan uyandırma ve ağ taramasında cihazı bulmak için kullanılır.");
      form.text("wifi_mac", "Kablosuz MAC", device.wifi_mac, "de:ad:de:ad:de:ad").setToolTipText(
        "Wi-Fi kartının kalıcı (fabrika) MAC adresi — isteğe bağlı. Cihaz açıkken Ankamon karttan okuyup kendiliğinden " +
        "doldurur. Cihaz Wi-Fi ile bağlıyken ağ taramasında tanınmasını sağlar; uzaktan uyandırma kablolu MAC ile yapılır.");
      form.text("exporter_port", "Sensör portu", String(device.exporter_port ?? 9100));
      // İşletim sistemi (kullanıcı isteği 2026-11-12): sağ menü / araç çubuğu / Komut çalıştır işlevleri buna göre seçilir
      // (platforms/README.md). Boş = kendiliğinden (SSH bilgisi, yoksa ağ taraması tahmini).
      const P = ankamon.ui.devices.Platforms;
      const detected = device.id ? ` — şu an: ${P.describe(Object.assign({}, device, device.os_source === "manual" ? { os_source: null } : {}))}` : "";
      form.select("os_family", "İşletim sistemi", [{ value: "", label: "Kendiliğinden" + (device.os_source !== "manual" ? detected : "") }]
        .concat((P.catalog().family_order || ["linux"]).map(f => ({ value: f, label: P.label(f) }))), device.os_family_manual || "")
        .setToolTipText("Cihazın işletim sistemi ailesi: işlevler (ekran, kilit, komut, kapat…) bu sisteme göre uygulanır; " +
          "sistemde uygulaması olmayan işlev bu cihazda devre dışı olur. Kendiliğinden: SSH ile toplanan bilgi, yoksa ağ taraması tahmini.");
      // Kayıtlı cihazda IP ve MAC'ler SALT OKUNUR (kullanıcı isteği 2026-11-11): ağ taramasından / cihazın kendisinden
      // öğrenilir; Kaydet bunları göndermez (pencere açıkken tarayıcının güncellediği değer eskisiyle ezilmesin).
      const locked = adding ? [] : ["ip", "mac", "wifi_mac"];
      locked.forEach(key => form.getField(key).set({ readOnly: true }));
      form.check("monitor_enabled", "Sensör verisi toplansın", device.monitor_enabled !== false)
        .setToolTipText("Sensör verisi bilgisayar ağda ulaşılabilir olduğunda toplanır.");
      // "Bu bir akıllı tahtadır" işareti formdan kalktı (kullanıcı isteği 2026-11-10: varlık türü seçilebiliyor) — Genel ▸
      // Varlık türü "Akıllı tahta" seçilince devices.smart_board da işaretlenir (bkz. ui.network.DeviceWindow / DeviceBulkEdit).
      form.addField("notes", "Not", new qx.ui.form.TextArea(device.notes || "").set({ wrap: true, autoSize: true, minimalLineHeight: 3 }));
      const read = () => {
        const values = form.values();
        locked.forEach(key => delete values[key]);
        values.exporter_port = parseInt(values.exporter_port, 10) || 0;
        if (adding && (!values.label || !values.mac)) {
          ankamon.ui.Dialog.error("Takma ad ve kablolu MAC adresi zorunlu.");
          return null;
        }
        if (values.mac && !ankamon.page.Devices.MAC_RE.test(values.mac)) {
          ankamon.ui.Dialog.error("Kablolu MAC adresi de:ad:de:ad:de:ad biçiminde olmalı.");
          return null;
        }
        if (values.wifi_mac && !ankamon.page.Devices.MAC_RE.test(values.wifi_mac)) {
          ankamon.ui.Dialog.error("Kablosuz MAC adresi de:ad:de:ad:de:ad biçiminde olmalı.");
          return null;
        }
        return values;
      };
      return { form, read };
    },

    /** Cihazda açılışta parola sıfırlama servisi uyarısı: parola kutusunun yanındaki kısa not ve ipucu. */
    BOOT_WIPE_NOTE: "⚠ Açılışta sıfırlanabilir",
    BOOT_WIPE_HINT: "Cihazda açılışta parola sıfırlama servisi etkinse etapadmin dışındaki hesapların parolası her açılışta " +
      "rastgele bir değerle değişir: bu parola yalnız bir sonraki açılışa kadar geçerli olur, sonrasında giriş EBA-QR, PIN " +
      "ya da USB ile yapılır. Servis cihazda etkinse işlem çıktısı da bunu söyler.",

    /** Cihazın ekranı güç tasarrufunda mı (uykuda; bkz. 025_device_display_state.sql). */
    isScreenAsleep(device) {
      return !!device.online && ["Off", "Standby", "Suspend"].includes(device.display_state);
    },

    /**
     * ETAP'ın kuralıyla tam addan kullanıcı adı (bkz. actions/user-add gen_username): Türkçe harfler sadeleşir, küçük
     * harf, boşluk atılır, en çok 31 karakter. Kutu salt okunur olduğundan kuralın kabul etmeyeceği karakterler de atılır.
     */
    etapUsername(fullName) {
      const map = { "İ": "i", "I": "i", "ı": "i", "Ç": "c", "ç": "c", "Ğ": "g", "ğ": "g", "Ö": "o", "ö": "o", "Ş": "s", "ş": "s", "Ü": "u", "ü": "u" };
      return String(fullName || "")
        .replace(/[İIıÇçĞğÖöŞşÜü]/g, c => map[c])
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .replace(/^[^a-z_]+/, "")
        .slice(0, 31);
    },

    /**
     * Yeni sekme açmadan, uygulama içinde (büyütülebilir, küçültülebilir — bkz. ui.WindowDock) bir
     * pencerede iframe gösterir. webshell/webshellMulti ortak kullanır (bkz. screen()/filemanager() ile
     * aynı Grow+Iframe deseni; buradaki fark üstteki yazı boyutu çubuğu).
     */
    __terminalWindow(caption, url, devices) {
      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1024, height: 700 };
      const win = new qx.ui.window.Window(caption).set({
        contentPadding: 0,
        layout: new qx.ui.layout.VBox(),
        width: Math.min(1024, bounds.width - 40),
        height: Math.min(640, bounds.height - 40)
      });
      // Yazı boyutu (kullanıcı isteği): seçim tarayıcıda kalıcı, açılışta URL'yle (webssh ?fontsize=;
      // çoklu terminal bölmeleri localStorage'dan okur — bkz. multishell/index.html) uygulanır, sonra
      // A−/A+ ile CANLI değişir (oturum kopmaz — bkz. docker/rootfs/webssh-fontsize-patch.py).
      let size = this.__terminalFontSize();
      if (url.startsWith("/webshell/")) {
        url += "&fontsize=" + size;
      }
      const frame = new qx.ui.embed.Iframe(url);
      const sizeLabel = new qx.ui.basic.Label(size + " px").set({ alignY: "middle", minWidth: 40, textAlign: "center" });
      const apply = w => {
        try {
          if (w.wssh && w.wssh.set_fontsize) {
            w.wssh.set_fontsize(size);
          }
          for (let i = 0; i < w.frames.length; i++) {
            apply(w.frames[i]); // çoklu terminal: her bölme ayrı bir webssh iframe'i
          }
        } catch (e) {
          // erişilemeyen çerçeve — atla
        }
      };
      const step = delta => {
        size = Math.max(8, Math.min(32, size + delta));
        sizeLabel.setValue(size + " px");
        try {
          localStorage.setItem("ankamon.webshell.fontSize", String(size));
        } catch (e) {
          // sorun değil — yalnız kalıcılık kaybolur.
        }
        const el = frame.getContentElement().getDomElement();
        if (el && el.contentWindow) {
          apply(el.contentWindow);
        }
      };
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" })).set({ padding: [3, 8] });
      bar.add(new qx.ui.basic.Label("Yazı boyutu:").set({ alignY: "middle" }));
      [["A−", -1, "Yazıyı küçült"], [null], ["A+", 1, "Yazıyı büyüt"]].forEach(([text, delta, tip]) => {
        if (!text) {
          bar.add(sizeLabel);
          return;
        }
        const btn = new qx.ui.form.Button(text).set({ padding: [1, 8], toolTipText: tip });
        btn.addListener("execute", () => step(delta));
        bar.add(btn);
      });
      // Hazır komutlar (kullanıcı isteği 2026-11-23): seçilen işlem terminale yazılıp çalıştırılır; çoklu terminalde
      // her panoya kendi cihazının komutu gider (bkz. ui.ssh.TerminalActions).
      const actionsBtn = devices && devices.length ? ankamon.ui.ssh.TerminalActions.button(devices, frame) : null;
      if (actionsBtn) {
        bar.addAt(actionsBtn, 0);
        bar.addAt(new qx.ui.core.Spacer(12), 1);
      }
      win.add(bar);
      win.add(frame, { flex: 1 });
      win.addListener("close", () => {
        if (actionsBtn && actionsBtn.getMenu()) {
          actionsBtn.getMenu().destroy(); // menü köke bağlıdır, pencereyle birlikte gitmez
        }
        frame.setSource("about:blank");
        win.destroy();
      });
      win.addListenerOnce("appear", () => win.center());
      root.add(win);
      win.open();
    },

    /** Web terminal yazı boyutu (px): kayıtlı seçim ya da xterm varsayılanı 15. */
    __terminalFontSize() {
      try {
        const v = parseInt(localStorage.getItem("ankamon.webshell.fontSize"), 10);
        if (v >= 8 && v <= 32) {
          return v;
        }
      } catch (e) {
        // localStorage erişilemiyor — varsayılana düş.
      }
      return 15;
    },

    /** @param device {Map} en az {id, label|hostname|ip} */
    async webshell(device) {
      try {
        const c = await ankamon.io.Api.get("/devices/" + device.id + "/shell");
        const name = device.label || device.hostname || device.ip;
        const url = "/webshell/?hostname=" + encodeURIComponent(c.hostname) +
          "&port=" + c.port + "&username=" + encodeURIComponent(c.username) +
          "&password=" + encodeURIComponent(c.password) + "&title=" + encodeURIComponent(name);
        this.__terminalWindow("Web terminal — " + name, url, [device]);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    /**
     * Dosya yöneticisini (FileBrowser Quantum, SFTP, root) uygulama içinde büyük bir pencerede
     * açar (yeni sekme yerine — bkz. screen() ile aynı iframe/Window deseni). Açılış köprüsü
     * (/filemanager-open/) önce cihazı bu makineye bağlar (sshfs), sonra gezinmeye başlar.
     * @param device {Map} en az {id, label|hostname|ip}
     * @param desktopOf {String?} bu kullanıcının masaüstü dizininde açılır (Ekranlar kutucuğundaki klasör simgesi, kullanıcı
     *   isteği 2026-11-23): köprü dizini cihazın xdg-user-dirs ayarından bulur (Masaüstü/Desktop); bulunamazsa ev dizini,
     *   o da yoksa /home. Verilmezse /home'da açılır.
     */
    async filemanager(device, desktopOf = null) {
      let c;
      try {
        c = await ankamon.io.Api.get("/devices/" + device.id + "/filemanager");
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const name = device.label || device.hostname || device.ip;
      // Kimlik bilgisi URL'ye konmaz (API de döndürmez): bağlama köprüsü onu kendisi okur.
      const url = "/filemanager-open/?device=" + c.device +
        "&hostname=" + encodeURIComponent(c.hostname) + "&title=" + encodeURIComponent(name) +
        (desktopOf ? "&user=" + encodeURIComponent(desktopOf) : "");

      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1024, height: 700 };
      const win = new qx.ui.window.Window("Dosya yöneticisi — " + name).set({
        contentPadding: 0,
        layout: new qx.ui.layout.Grow(),
        width: Math.min(1200, bounds.width - 40),
        height: Math.min(800, bounds.height - 40)
      });
      const frame = new qx.ui.embed.Iframe(url);
      win.add(frame);
      win.addListener("close", () => {
        frame.setSource("about:blank"); // sshfs bağlantısı boşta kalınca kendi zaman aşımıyla çözülür
        win.destroy();
      });
      win.addListenerOnce("appear", () => win.center());
      root.add(win);
      win.open();
    },

    /**
     * Cihazın canlı ekranını (salt izleme) yeniden boyutlanabilir, büyütülebilir bir pencerede gösterir;
     * pencere içindeki sayfa ayrıca tarayıcı tam ekranına geçebilir. Birden fazla cihaz verilirse aynı
     * pencerede düşük kaliteli önizleme kutucukları (q=thumb) açılır. Görüntü /screen/ sayfasından
     * (noVNC) gelir; cihaz listesi URL fragmanında taşınır. Pencere kapanınca akış(lar) ve cihazdaki
     * x11vnc biter.
     * Kullanıcının "screen.control" yetkisi varsa sayfada "🖱 Müdahale" düğmesi çıkar (fare/klavye ile
     * yönetim); sunucu (ekran köprüsü) bu yetkiyi ayrıca oturumdan denetler.
     * @param devices {Array} [{id, label|hostname|ip}]
     * @param user {Map?} oturum sahibi
     * @param manage {Boolean?} "Ekranı yönet" kipi (tek cihaz)
     * Tek cihazlık pencere cihaz başına BİR tane açılır (kullanıcı isteği): aynı cihazın penceresi zaten
     * açıksa yenisi açılmaz, o öne getirilir ("Ekranı yönet" istenmişse izleme penceresi yönetim kipiyle
     * değiştirilir). Açık pencereler SCREEN_WINDOWS iletisiyle duyurulur — Ekranlar sekmesi o cihazın
     * önizlemesini durdurup "Ayrı pencerede izleniyor" yazar (bkz. Devices.js, screen/index.html "tm-popped").
     */
    screen(devices, user, manage = false) {
      const list = devices.map(b => ({ id: b.id, name: b.label || b.hostname || b.ip || "#" + b.id, locks: b.input_locks || [],
        session: b.session_username || "" }));
      if (!list.length) {
        return;
      }
      const control = !!user && (user.is_admin || user.features.includes("screen.control"));
      // manage ("Ekranı yönet"): tek cihaz, sayfa doğrudan müdahale (fare/klavye) kipinde açılır.
      manage = manage && control && list.length === 1;
      const single = list.length === 1 ? list[0].id : null;
      const open = single !== null && this.__screenWins.get(single);
      if (open) {
        if (!manage || open.manage) {
          open.win.open(); // görünür + öne
          if (manage) {
            open.win.maximize();
          }
          open.win.focus();
          return;
        }
        open.win.close(); // izleme → yönetim: aynı cihaza iki akış açık kalmasın
      }
      // input: başlıktaki klavye ve fare/dokunmatik kilidi düğmeleri. chat: sohbeti açık cihazlar yüksek çözünürlükte akar.
      const input = !!user && (user.is_admin || user.features.includes("screen.input"));
      const spec = { devices: list, q: list.length > 1 ? "thumb" : "view", control, manage, input, chat: ankamon.ui.chat.Window.openIds() };
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
      const caption = list.length > 1 ? `Ekranlar (${list.length} cihaz)`
        : this.__screenCaption(manage, list[0].name, list[0].session);

      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1024, height: 700 };
      const win = new qx.ui.window.Window(caption).set({
        contentPadding: 0,
        layout: new qx.ui.layout.Grow(),
        width: Math.min(1024, bounds.width - 40),
        height: Math.min(640, bounds.height - 40)
      });
      const frame = new qx.ui.embed.Iframe("/screen/#" + hash);
      // Sayfadaki "Tam ekran" (Fullscreen API) iframe içinden ancak bu izinle çalışır.
      frame.getContentElement().setAttribute("allowfullscreen", "true");
      frame.getContentElement().setAttribute("allow", "fullscreen");
      win.add(frame);
      // Müdahale tam ekranda (kullanıcı isteği): pencerenin içinde "🖱 Müdahale" açılınca sayfa "tm-maximize"
      // gönderir, pencere büyür (bkz. screen/index.html); "Ekranı yönet" zaten büyütülmüş açılır.
      const onMessage = e => {
        if (e.origin !== location.origin || !e.data || e.source !== frame.getWindow()) {
          return;
        }
        if (e.data.type === "tm-maximize") {
          win.maximize();
        } else if (e.data.type === "tm-inputlock" && input) {
          this.__toggleInputLock(e.data.id, e.data.device, e.data.lock, e.data.locks || [], frame);
        }
      };
      window.addEventListener("message", onMessage);
      const onChat = () => {
        const target = frame.getWindow();
        if (target) {
          target.postMessage({ type: "tm-chat", ids: ankamon.ui.chat.Window.openIds() }, location.origin);
        }
      };
      qx.event.message.Bus.subscribe(ankamon.ui.chat.Window.CHANGED, onChat, this);
      win.addListener("close", () => {
        window.removeEventListener("message", onMessage);
        qx.event.message.Bus.unsubscribe(ankamon.ui.chat.Window.CHANGED, onChat, this);
        // Son kare Ekranlar kutucuğuna geçer: kutucuk "Bağlanıyor…" göstermeden yeni akışını kurar (bkz. takeLastFrames).
        if (single !== null) {
          const shot = this.__captureFrame(frame);
          if (shot) {
            this.__lastFrames.set(single, shot);
          }
        }
        frame.setSource("about:blank"); // WebSocket'ler hemen kapansın (cihazdaki x11vnc de biter)
        if (single !== null && this.__screenWins.get(single)?.win === win) {
          this.__screenWins.delete(single);
          this.__announceScreenWindows();
        }
        win.destroy();
      });
      win.addListenerOnce("appear", () => {
        if (!win.isMaximized()) {
          win.center();
        }
      });
      root.add(win);
      win.open();
      if (manage) {
        win.maximize();
      }
      if (single !== null) {
        this.__screenWins.set(single, { win, manage, frame, name: list[0].name });
        this.__announceScreenWindows();
      }
    },

    /** Cihaz kimliği → {win, manage}: açık tek cihazlık ekran pencereleri (bkz. screen). */
    __screenWins: new Map(),

    /**
     * Tek cihazlık ekran penceresinin başlığı: "Ekran yönetimi — A2-4 / ali oturumu" — cihazda oturum açmış kullanıcı varsa
     * adın sağında "/" ile (kullanıcı isteği 2026-11-23); birden çok oturum "ali, veli oturumu".
     */
    __screenCaption(manage, name, session) {
      return (manage ? "Ekran yönetimi — " : "Ekran — ") + name + (session ? ` / ${session} oturumu` : "");
    },

    /** Message Bus konusu: açık ekran pencerelerinin cihaz kimlikleri (veri: Array). */
    SCREEN_WINDOWS: "ankamon.screenWindows",

    /** Ekran penceresi şu an açık olan cihazların kimlikleri. */
    screenWindowIds() {
      return [...this.__screenWins.keys()];
    },

    __announceScreenWindows() {
      qx.event.message.Bus.dispatchByName(this.SCREEN_WINDOWS, this.screenWindowIds());
    },

    /** Kapanan ekran pencerelerinin son kareleri: cihaz id → JPEG veri adresi. */
    __lastFrames: new Map(),

    /** Bekleyen son kareleri verir ve unutur (bkz. page.Devices.__pushPopped). */
    takeLastFrames() {
      const frames = Object.fromEntries(this.__lastFrames);
      this.__lastFrames.clear();
      return frames;
    },

    /** Pencerenin canlı tuvalinden küçültülmüş son kare; alınamazsa null (kutucuk o durumda olağan yoldan bağlanır). */
    __captureFrame(frame) {
      try {
        const src = frame.getWindow().document.querySelector(".tile.live .screen canvas");
        if (!src || !src.width || !src.height) {
          return null;
        }
        const scale = Math.min(1, 960 / src.width);
        const copy = document.createElement("canvas");
        copy.width = Math.round(src.width * scale);
        copy.height = Math.round(src.height * scale);
        copy.getContext("2d").drawImage(src, 0, 0, copy.width, copy.height);
        return copy.toDataURL("image/jpeg", 0.75);
      } catch (e) {
        return null;
      }
    },

    /** Cihaz listesi tazelendi: açık ekran pencerelerindeki kilit düğmeleri güncel duruma gelsin. */
    syncScreenLocks(devices) {
      this.__screenWins.forEach((open, id) => {
        const device = devices.find(b => b.id === id);
        if (device) {
          // Başlıktaki "/ ali oturumu" cihaz listesi her tazelendiğinde güncellenir (oturum açılır/kapanır).
          open.win.setCaption(this.__screenCaption(open.manage, open.name, device.session_username || ""));
        }
        const target = open.frame.getWindow();
        if (device && target) {
          target.postMessage({ type: "tm-locks", id, locks: device.input_locks || [] }, location.origin);
        }
      });
    },

    /**
     * Ekran penceresi başlığındaki kilit düğmesi: iş penceresi açılmaz, düğme işin sonucunu gösterir. Fare kilidi dokunmayı da
     * tuttuğundan (bkz. worker executor/inputlock.py) düğme ikisini birlikte temsil eder: açarken ayrı dokunmatik kilidi de kalkar.
     */
    async __toggleInputLock(id, inputDev, lock, locks, frame) {
      const inputDevs = !lock && inputDev === "mouse" && locks.includes("touch") ? ["mouse", "touch"] : [inputDev];
      // İş bitti denince cihaz listesi henüz eski olabilir: başarılı işin sonucu bilinen durumdur, listeden okunmaz.
      let result = null;
      try {
        for (const dev of inputDevs) {
          const jobId = (await ankamon.io.Api.post("/jobs", { type: "input_lock", device: dev, lock, device_ids: [id] })).id;
          let target = null;
          for (let i = 0; i < 60 && !target; i++) {
            const res = await ankamon.io.Api.get(`/jobs/${jobId}`);
            const t = ((res.job && res.job.targets) || [])[0];
            if (t && !["queued", "running"].includes(t.status)) {
              target = t;
            } else {
              await new Promise(r => setTimeout(r, 500));
            }
          }
          if (!target || target.status !== "ok") {
            throw new Error((target && target.output) || "İşlem zaman aşımına uğradı");
          }
        }
        result = lock ? [...new Set(locks.concat([inputDev]))] : locks.filter(d => !inputDevs.includes(d));
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        // Başarısız: hangi durumda kaldığı cihaz listesinden okunur; okunamazsa eski durum gösterilir.
        result = await ankamon.io.Api.get("/devices").then(res => {
          const device = res.devices.find(b => b.id === id);
          return device ? device.input_locks || [] : locks;
        }).catch(() => locks);
      }
      const target = frame.getWindow();
      if (target) {
        target.postMessage({ type: "tm-locks", id, locks: result, done: true }, location.origin);
      }
    },

    /** İşaretlenmiş görev sonucu ("facts" görevinin output'u — JSON metin) için ayrıştırılmış
     * donanım bilgisi döner; hâlâ çalışıyorsa/okunamadıysa null. */
    __parseFacts(target) {
      if (target.status !== "ok") {
        return null;
      }
      try {
        return JSON.parse(target.output || "{}");
      } catch (e) {
        return null;
      }
    },

    /**
     * "Bilgi kartı": seçili cihaz(lar)ın donanım ve durum bilgisini (sistem, işlemci, bellek, disk ve
     * boş alan, disk/bölüm GUID'leri, kablolu ağ, Wi-Fi kartı ve bağlantı durumu, ekran, BIOS, UEFI açılış
     * girdileri ve tüm UEFI değişkenleri — bkz. ui.FactsView) gösterir.
     * Worker cihaza SSH ile canlı bağlanıp toplar; aynı cihaza 60 dakika içinde tekrar bağlanmaz,
     * son toplanan değeri döner (bkz. backend "facts" görev türü, worker/ankamon/executor/hwfacts.py
     * CACHE_SECONDS). Birden fazla cihaz seçiliyse hepsi aynı pencerede listelenir; "Yazdır" ayrı bir
     * sekmede cihaz başına bir kartlık yazdırılabilir sayfa açar.
     * @param devices {Array} [{id, label|hostname|ip}]
     */
    async infoCard(devices) {
      const ids = devices.map(b => b.id);
      if (!ids.length) {
        return;
      }
      const name = b => b.label || b.hostname || b.ip || ("#" + b.id);
      // Kart başlığındaki kimlik (kod adı, MAC…) için cihaz kaydı: Cihazlar sayfası tam satırı verir, başka
      // girişler (ör. Bakım ▸ Ahenk) yalnız id/ad verebilir — MAC'i eksikse liste bir kez okunur.
      const deviceById = new Map(devices.map(b => [b.id, b]));
      if (devices.some(b => !b.mac)) {
        ankamon.io.Api.get("/devices").then(res => {
          (Array.isArray(res) ? res : (res.devices || [])).forEach(b => {
            if (deviceById.has(b.id)) {
              deviceById.set(b.id, Object.assign({}, b, deviceById.get(b.id), { mac: b.mac, wifi_mac: b.wifi_mac }));
            }
          });
          if (!stop) {
            render();
          }
        }, () => {});
      }
      const caption = devices.length > 1 ? `Bilgi kartı (${devices.length} cihaz)` : "Bilgi kartı — " + name(devices[0]);
      // Geniş pencere: GUID'li satırlar, açılış girdisi denetimleri ve UEFI değişken değerleri tek satıra sığsın
      // (ekran darsa ekranın genişliğine iner, satırlar o zaman kırılır).
      const rootBounds = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 700 };
      const win = ankamon.ui.Dialog.window(caption, Math.max(Math.min(960, rootBounds.width - 40), Math.min(1400, rootBounds.width - 60)),
        { maximizable: true });
      // Dialog.window pencereyi içeriğin DOĞAL yüksekliğine göre boyutlandırır; Scroll'un flex:1'i
      // onsuz küçük kalır (sarılacağı sabit bir yükseklik olmadan esneyecek yer bulamaz) — bkz.
      // benzer not Base.js _createTable civarında. Sabit bir yükseklik vererek Scroll'a gerçek alan açılır.
      win.setHeight(Math.min(Math.max(560, Math.round(rootBounds.height * 0.8)), rootBounds.height - 80));
      const status = new qx.ui.basic.Label(ankamon.ui.JobSpinner.label("Toplanıyor…")).set({ textColor: "app-muted", rich: true });
      win.add(status);
      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(8));
      const scroll = new qx.ui.container.Scroll();
      scroll.add(body);
      win.add(scroll, { flex: 1 });

      const printBtn = new qx.ui.form.Button("Yazdır").set({ enabled: false });
      const closeBtn = new qx.ui.form.Button("Kapat");
      closeBtn.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [printBtn, closeBtn]);

      let stop = false;
      win.addListener("close", () => { stop = true; });

      let jobId;
      let targets = [];
      // Sensörler (anlık + en düşük/en yüksek) facts görevinden bağımsız, hemen gelir — bkz. FactsView.__sensorRows.
      const sensors = new Map();
      ids.forEach(id => ankamon.io.Api.get(`/metrics/${id}/sensors`)
        .then(res => sensors.set(id, res.sensors || {}), () => sensors.set(id, null))
        .then(() => !stop && render()));
      const render = () => {
        body.removeAll().forEach(w => w.dispose());
        targets.forEach(t => {
          const card = new qx.ui.container.Composite(new qx.ui.layout.VBox(3)).set({
            padding: 10,
            decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border" })
          });
          const facts = this.__parseFacts(t);
          card.add(new qx.ui.basic.Label(qx.bom.String.escape(t.device)).set({ font: "bold" }));
          card.add(new qx.ui.basic.Label(this.__infoCardIdentity(deviceById.get(t.device_id), facts))
            .set({ rich: true, selectable: true, textColor: "app-muted" }));
          if (facts) {
            card.add(new qx.ui.basic.Label(ankamon.ui.FactsView.html(facts, sensors.get(t.device_id))).set({ rich: true, selectable: true, allowGrowX: true }));
          } else if (["queued", "running"].includes(t.status)) {
            card.add(new qx.ui.basic.Label(t.status === "running" ? ankamon.ui.JobSpinner.label("Toplanıyor…") : "Sırada")
              .set({ textColor: "app-muted", rich: true }));
          } else {
            card.add(new qx.ui.basic.Label("Okunamadı: " + qx.bom.String.escape(t.output || ""))
              .set({ textColor: "app-error", rich: true, wrap: true }));
          }
          body.add(card);
        });
      };

      const tick = async () => {
        if (stop) {
          return;
        }
        let res;
        try {
          res = await ankamon.io.Api.get(`/jobs/${jobId}`);
        } catch (e) {
          status.setValue("Durum alınamadı: " + qx.bom.String.escape(e.message || String(e)));
          return;
        }
        if (stop) {
          return;
        }
        targets = (res.job && res.job.targets) || [];
        render();
        const running = res.job.status === "queued" || res.job.status === "running";
        status.setValue(running ? ankamon.ui.JobSpinner.label("Toplanıyor…") : "");
        printBtn.setEnabled(!running);
        if (running) {
          qx.event.Timer.once(tick, this, 700);
        }
      };
      printBtn.addListener("execute", () => this.__printInfoCard(targets, sensors, deviceById));
      win.open();

      try {
        jobId = (await ankamon.io.Api.post("/jobs", { type: "facts", device_ids: ids })).id;
      } catch (e) {
        status.setValue("");
        ankamon.ui.Dialog.error(e);
        return;
      }
      tick();
    },

    /**
     * Bilgi kartı başlığındaki cihaz kimliği: kod adı (takma ad), bilgisayar adı, kablolu/kablosuz MAC, IP, mimari, işlemci.
     * @param device {Map|undefined} cihaz kaydı (label, hostname, mac — kablolu kart, wifi_mac — Wi-Fi kartı, ip)
     * @param facts {Map|null} facts (arch, cpu_model)
     * @return {String} kaçırılmış HTML
     */
    __infoCardIdentity(device, facts) {
      const esc = qx.bom.String.escape;
      const b = device || {};
      const f = facts || {};
      return [["Kod adı", b.label], ["Bilgisayar adı", b.hostname], ["Kablolu MAC", b.mac], ["Kablosuz MAC", b.wifi_mac], ["IP", b.ip],
        ["Mimari", f.arch], ["İşlemci", f.cpu_model]]
        .filter(pair => pair[1])
        .map(([k, v]) => `${esc(k)}: <b>${esc(String(v))}</b>`)
        .join(" &nbsp;·&nbsp; ");
    },

    /** "Bilgi kartı" penceresindeki "Yazdır": qx pencere ağacı yerine YENİ, sade bir sekmede
     * yazdırılabilir sayfa açar — qx'in mutlak konumlu kutuları tarayıcı yazdırmasında güvenilmez
     * kırpılıyor (bkz. diğer özel görünümler: /screen/, /webshell/ — aynı "ayrı sade sayfa" deseni).
     * Her cihaz yeni sayfadan başlar ve başlığında hangi cihaz olduğu yazar. Kart sayfadan uzun olduğundan
     * bölünmesine izin verilir (eskiden "bölünmesin" kuralı kartı ikinci sayfaya itip ilk sayfayı boş
     * bırakıyordu); yalnız tablo satırları ve bölüm başlıkları sayfa sınırında bölünmez. */
    __printInfoCard(targets, sensors, deviceById = new Map()) {
      const esc = qx.bom.String.escape;
      const when = esc(new Date().toLocaleString("tr-TR"));
      const cards = targets.map(t => {
        const facts = this.__parseFacts(t);
        const device = deviceById.get(t.device_id) || {};
        return `<section class="card"><h1>Cihaz bilgi kartı — ${esc(device.label || t.device)}</h1>` +
          `<div class="id">${this.__infoCardIdentity(device, facts)}</div><div class="when">${when}</div>` +
          (facts ? ankamon.ui.FactsView.html(facts, sensors.get(t.device_id)) : `<p>${esc(t.output || "Okunamadı")}</p>`) +
          "</section>";
      }).join("");
      const title = targets.length === 1 ? `Bilgi kartı — ${esc((deviceById.get(targets[0].device_id) || {}).label || targets[0].device)}`
        : `Bilgi kartı (${targets.length} cihaz)`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
        <style>
          body{font-family:sans-serif;margin:16px;color:#111;font-size:12px}
          h1{font-size:17px;margin:0 0 4px}
          .id{margin-bottom:2px}
          .when{color:#555;margin-bottom:8px}
          .card + .card{break-before:page;page-break-before:always}
          tr{break-inside:avoid;page-break-inside:avoid}
          *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        </style></head><body>${cards}</body></html>`;
      const w = window.open("", "_blank");
      if (!w) {
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    },

    /**
     * "Ekranımı yansıt": bu bilgisayarın ekranını seçili (çevrimiçi) cihazlarda tam ekran gösterir.
     * Yayın sayfası (/cast/) AYRI bir tarayıcı penceresinde açılır: yayın sürerken Ankamon'da çalışmaya
     * devam edilebilir, pencereyi kapatmak yansıtmayı bitirir. Ekran yakalama HTTPS ister (nginx HTTP'yi
     * zaten HTTPS'e yönlendirir). Ayrıntı: docker/rootfs/cast/index.html, worker executor/cast.py.
     */
    cast(devices, preset = null) {
      const list = devices.map(b => ({ id: b.id, name: b.label || b.hostname || b.ip || "#" + b.id, online: !!b.online }));
      if (!list.length) {
        ankamon.ui.Dialog.alert("Önce bir ya da daha fazla cihaz işaretleyin.");
        return;
      }
      // preset {quality, audio}: sağ menüden seçilen ayarlar — sayfa ayar sormaz (bkz. cast/index.html).
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(Object.assign({ devices: list }, preset || {})))));
      // Göreli adres: HTTP'deysek nginx HTTPS'e yönlendirir, tarayıcı fragmanı (#…) korur.
      const w = window.open("/cast/#" + hash, "ankamon-cast", "popup,width=820,height=760");
      if (!w) {
        ankamon.ui.Dialog.alert("Tarayıcı açılır pencereyi engelledi. Bu site için açılır pencerelere izin verip yeniden deneyin.");
        return;
      }
      w.focus();
    },

    // "Ekranımı yansıt" alt menüsündeki Ses onay kutusunun değeri: menü bir seçimde kapandığından sayfa
    // oturumu boyunca hatırlanır (Ses'i kapatıp menüyü yeniden açan kullanıcı kapalı bulsun); varsayılan açık.
    __castAudio: true,

    // cast/index.html'deki QUALITY anahtarlarıyla AYNI.
    CAST_QUALITIES: [
      ["text", "Sunum / metin — 1080p, 15 kare/sn"],
      ["video", "Video / hareket — 720p, 30 kare/sn"],
      ["low", "Zayıf ağ — 720p, 10 kare/sn"]
    ],

    /** "Ekranımı yansıt" alt menüsü: kalite seçenekleri + Ses (varsayılan açık); kalite seçilince yansıtma başlar. */
    __castMenu(devices) {
      const m = new qx.ui.menu.Menu();
      if (!devices.length) {
        m.add(new qx.ui.menu.Button("Çevrimiçi cihaz yok").set({ enabled: false }));
        return m;
      }
      this.CAST_QUALITIES.forEach(([quality, label]) => {
        const btn = new qx.ui.menu.Button(label);
        btn.addListener("execute", () => this.cast(devices, { quality, audio: this.__castAudio }));
        m.add(btn);
      });
      m.add(new qx.ui.menu.Separator());
      const audio = new qx.ui.menu.CheckBox("Ses").set({ value: this.__castAudio });
      audio.addListener("changeValue", e => { this.__castAudio = e.getData(); });
      m.add(audio);
      return m;
    },

    /**
     * Seçili cihazları kapatır (SSH ile). Birden fazlaysa önce onay alır (onay her zaman sorulur; "bir
     * daha gösterme" yalnız çıktı penceresi içindir — bkz. __powerJob).
     * @param user {Map?} oturum sahibi (pencere gizleme tercihi)
     * @param sessionOps {Map?} Cihazlar sayfasının işleyicileri (bkz. Devices.__sessionOps): varsa kapatma komutu
     *   cihaza ulaşınca kutucuğun sol altında "Kapanıyor…" (shutdownSent; kullanıcı isteği 2026-11-10).
     */
    async shutdown(devices, user, sessionOps) {
      const ids = devices.map(b => b.id);
      if (!ids.length) {
        return;
      }
      if (ids.length > 1) {
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${ids.length} cihaz</b> kapatılsın mı? Her biri SSH ile tek tek kapatılacak.`, "Kapat");
        if (!ok) {
          return;
        }
      }
      const job = this.__powerJob({ type: "action", action: "shutdown", device_ids: ids }, "Kapatma çıktısı", "shutdown", "kapatma", user);
      if (sessionOps && sessionOps.shutdownSent) {
        job.then(jobId => sessionOps.shutdownSent(jobId, devices)).catch(() => {});
      }
    },

    /** Seçili cihazları yeniden başlatır (hazır işlem "reboot"). Birden fazlaysa önce onay alır. @param user {Map?} */
    async reboot(devices, user) {
      const ids = devices.map(b => b.id);
      if (!ids.length) {
        return;
      }
      if (ids.length > 1) {
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${ids.length} cihaz</b> yeniden başlatılsın mı? Açık oturumlar kapanır.`, "Yeniden başlat");
        if (!ok) {
          return;
        }
      }
      this.__powerJob({ type: "action", action: "reboot", device_ids: ids }, "Yeniden başlatma çıktısı", "reboot",
        "yeniden başlatma", user);
    },

    // "Bu pencereyi bir daha gösterme" (kullanıcı isteği) bu kadar süre geçerli; sonra pencere yeniden
    // görünür ve kutu işaretsiz gelir. Bitiş anı kullanıcı başına sunucuda, işlem başına ayrı:
    // users.ui_prefs["<wol|shutdown|reboot>.hideUntil"].
    POWER_HIDE_MS: 7 * 24 * 3600 * 1000,

    /**
     * Seçili (kapalı) cihazları ağdan uyandırır (WoL). Pencere gizlenmişse (bkz. POWER_HIDE_MS) uyandırma
     * yine yapılır, yalnız çıktı penceresi açılmaz — başlatma hatası ise her durumda gösterilir.
     * @param user {Map?} oturum sahibi (pencere gizleme tercihi okunur/yazılır)
     * @param sessionOps {Map?} Cihazlar sayfasının işleyicileri (bkz. Devices.__sessionOps): varsa görev
     *   başlayınca kutucuğun kullanıcı adı alanına "SS:DD:sn Magic paket gönderildi" yazılır (wolSent).
     */
    wol(devices, user, sessionOps) {
      const ids = devices.map(b => b.id);
      if (ids.length) {
        const job = this.__powerJob({ type: "wol", device_ids: ids }, "Uyandırma (WoL)", "wol", "uyandırma", user, { intro: this.WOL_INTRO });
        if (sessionOps && sessionOps.wolSent) {
          job.then(() => sessionOps.wolSent(devices)).catch(() => {});
        }
      }
    },

    /**
     * Güç işlemi (aç/kapat/yeniden başlat) görevini başlatır ve çıktı penceresini açar; pencerenin altında
     * "Bu pencereyi bir daha gösterme" kutusu (kullanıcı isteği). Kullanıcı gizlediyse POWER_HIDE_MS boyunca
     * pencere açılmaz, işlem yine yapılır; görev başlatılamazsa hata her durumda gösterilir.
     * @param kind {String} tercih anahtarı öneki ("wol" | "shutdown" | "reboot")
     * @param verb {String} kutu metnindeki işlem adı ("uyandırma" …)
     */
    /** Çıktı penceresinin altında "bir daha gösterme" kutusu olan iş (bkz. __powerJob) — başka sınıflar için. */
    hideableJob(body, caption, kind, verb, user) {
      this.__powerJob(body, caption, kind, verb, user);
    },

    /** @return {Promise} görev kimliği (başlatılamazsa reddedilir; hata zaten gösterilir) */
    __powerJob(body, caption, kind, verb, user, opts = {}) {
      const job = ankamon.io.Api.post("/jobs", body).then(res => res.id);
      const key = kind + ".hideUntil";
      const prefs = user ? user.ui_prefs || (user.ui_prefs = {}) : {};
      if ((prefs[key] || 0) > Date.now()) {
        job.catch(e => ankamon.ui.Dialog.error(e));
        return job;
      }
      let footer = null;
      if (user) {
        footer = new qx.ui.form.CheckBox(`Bu pencereyi bir daha gösterme (${verb} yine yapılır; 7 gün sonra pencere yeniden gösterilir)`);
        footer.addListener("changeValue", e => {
          const value = e.getData() ? Date.now() + this.POWER_HIDE_MS : null;
          if (value) {
            prefs[key] = value;
          } else {
            delete prefs[key];
          }
          ankamon.io.Api.put("/auth/prefs", { key, value }).catch(err => ankamon.ui.Dialog.error(err));
        });
      }
      ankamon.ui.Jobs.show(job, caption, Object.assign({}, opts, { footer }));
      return job;
    },

    // Uyandırma penceresinin çıktı kutusunun başındaki sabit açıklama (bkz. ui.Jobs opts.intro):
    // "paket gönderildi" görünse de cihazın neden açılmayabileceği ve TiHA'nın WoL ön koşulları.
    // Kaynak: TiHA sihirbazının "Wake-on-LAN" adımı (m15, tiha-wake-on-lan.service) — bkz.
    // https://github.com/enseitankado/tiha
    WOL_INTRO: [
      "UYANDIRMA (Wake-on-LAN) HAKKINDA",
      "",
      "Ankamon, cihazın ağ kartına \"sihirli paket\" gönderir. Aşağıda \"gönderildi\" yazması paketin ağa",
      "çıktığını gösterir; cihazın açılacağını garanti etmez. Cihaz açılmazsa nedeni çoğunlukla cihazdadır:",
      "",
      "• Cihaz düzgün kapatılmadıysa uyanmaz. Elektrik kesilmesi, güç düğmesine uzun basılması ya da",
      "  donma gibi ANİ kapanışlarda ağ kartı uyandırmaya hazırlanmaz ya da kartta bekleme gücü kalmaz;",
      "  sihirli paket ulaşsa bile cihaz açılmaz. Böyle bir cihazı bir kez elle açın; bundan sonra",
      "  Ankamon'dan \"Bilgisayarı kapat\" ile ya da cihazın kendi menüsünden kapatılınca yeniden uyandırılabilir.",
      "• Cihazın prizi, uzatma kablosu ya da sınıf sigortası kapalıysa uyanmaz (bekleme gücü yok).",
      "",
      "ÖN KOŞULLAR — TiHA sihirbazının \"Wake-on-LAN\" adımı (github.com/enseitankado/tiha):",
      "• TiHA'da bu adım uygulanmış olmalı: cihaza tiha-wake-on-lan.service kurulur ve her açılışta",
      "  ağ kartında uyandırmayı açar (ethtool -s <arayüz> wol g).",
      "• Cihazın BIOS'unda \"Wake on LAN\" AÇIK; \"ErP\" / \"Deep Sleep\" (derin uyku) KAPALI olmalı.",
      "• Cihaz ile Ankamon sunucusu AYNI ağda (aynı VLAN / yayın alanında) olmalı; sihirli paket bir",
      "  yayındır, yönlendiriciden (router) öteye geçmez.",
      "• Cihazın MAC adresi Ankamon'da kayıtlı olmalı (cihaz bir kez açık görülünce kendiliğinden kaydedilir)."
    ].join("\n"),

    /**
     * Birden fazla cihazın web terminalini, uygulama içinde tek pencerede yan yana panolar
     * hâlinde açar (bkz. /multishell/ — toplu komut yazma üstten yapılır). Her panonun bağlantı
     * bilgisi (host/kullanıcı/parola) ayrı ayrı /shell ucundan alınır (tek cihazdaki ile aynı uç,
     * aynı komut loguna işlenir), tarayıcıya hiç sunucuya gitmeyen URL fragmanıyla (#...) taşınır.
     */
    async webshellMulti(devices) {
      if (devices.length < 2) {
        if (devices.length === 1) {
          this.webshell(devices[0]);
        }
        return;
      }
      let panes;
      try {
        panes = await Promise.all(devices.map(async device => {
          const c = await ankamon.io.Api.get("/devices/" + device.id + "/shell");
          return { ...c, title: device.label || device.hostname || device.ip };
        }));
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(panes))));
      this.__terminalWindow(`Web terminal (${devices.length} cihaz)`, "/multishell/#" + hash, devices);
    },

    /**
     * Tek cihaz için sağ menü (ağaçtaki cihaz düğümü ve Cihazlar grid'indeki satır ortak kullanır).
     * Çevrimiçiyse: Web terminal, Komut çalıştır, …, Bilgisayarı aç/kapat. Çevrimdışıysa: yalnız
     * Bilgisayarı aç/kapat (kapat devre dışı).
     * @param devices {Array?} grid'de o satır işaretli ÇOKLU seçimin bir parçasıysa Web terminal
     *   (webshellMulti), Ekranı göster (screen — aynı pencerede önizleme kutucukları), Komut çalıştır,
     *   Bilgisayarı kapat ve Bilgisayarı aç (WoL) seçili TÜM cihazlara uygulanır; verilmezse/tek elemanlıysa
     *   yalnız bu tek cihaza. Dosya yöneticisi (sshfs bağlama, tek seferde tek kök) doğası gereği tekildir.
     * @param sessionOps {Map?} Ekranlar önizlemesinden açılınca verilir: {login(devices, acc), logout(devices)}
     *   — "Oturum aç"/"Oturumu kapat" onaydan sonra iş penceresi AÇMADAN bunlara devredilir; durum
     *   kutucukların sol altında gösterilir (bkz. page.Devices __sessionJob). Verilmezse (grid satırı)
     *   canlı iş penceresi açılır.
     * @return {qx.ui.menu.Menu|null} hiç seçenek yoksa null (hiçbir yetki yoksa menü açılmaz)
     */
    /**
     * Sağ menü maddesi: simge sabit genişlikte ortalanmış bir kutuda, etiket hep aynı sütundan başlar.
     * Simgeler Unicode karakter (bkz. Shell.ICON) ve bazıları emoji yazı tipinden (👤, 🖱) farklı
     * genişlikte çizildiğinden "simge + boşluk" düz metni maddeleri birbirine göre kaydırıyordu.
     * @param handler {Function?} "execute" işleyicisi (alt menü açan maddede null)
     * @param submenu {qx.ui.menu.Menu?} alt menü
     */
    menuButton(icon, label, handler = null, submenu = null) {
      const btn = new qx.ui.menu.Button(
        `<span style="display:inline-block;width:1.4em;text-align:center">${icon || ""}</span>` +
        qx.bom.String.escape(label), null, null, submenu);
      btn.getChildControl("label").setRich(true);
      // Araç çubuğu maddeyi bu anahtarla tanır (etiket, cihaz sayısı eki olmadan — bkz. ui.devices.ActionBar).
      btn.setUserData("ankamon.menuKey", label.replace(/ \(\d+( cihaz)?\)$/, ""));
      btn.setUserData("ankamon.menuIcon", icon);
      if (handler) {
        btn.addListener("execute", handler, this);
      }
      // Devre dışı madde belirgin soluk (kullanıcı isteği): zengin (HTML) etikete temaların "disabled" yazı
      // rengi çoğu temada yansımıyor ya da normalden zor ayrılıyordu — opaklık temadan bağımsız.
      const dim = () => btn.setOpacity(btn.getEnabled() ? 1 : this.DISABLED_OPACITY);
      btn.addListener("changeEnabled", dim);
      dim();
      return btn;
    },

    /**
     * menu()'nün dışında kalan iki ortak madde (Cihazlar sağ menüsünde Düzenle/Sil'in üstünde, Bakım ▸ Ahenk'te
     * de): Logları göster (Loglar sayfasını bu cihaza süzülmüş açar — bkz. ui.Shell.OPEN_LOGS) ve hemen altında
     * Bilgi kartı (kullanıcı isteği; yalnız çevrimiçi cihazda). Yetkiye göre boş dizi dönebilir.
     * @param opts {Map?} {noLogs: true} — Logları göster eklenmez (Cihazlar/Varlıklar: Cihaz ayrıntıları ▸ Loglar
     *   düğmesine taşındı — kullanıcı isteği 2026-11-11)
     */
    logsAndInfo(device, user, devices = [device], opts = {}) {
      const can = feature => user.is_admin || user.features.includes(feature);
      const ICON = ankamon.ui.Shell.ICON;
      const items = [];
      if (can("logs") && !opts.noLogs) {
        items.push(this.menuButton(ICON.logs, "Logları göster", () =>
          qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_LOGS, device.id)));
      }
      if (device.online && (can("devices") || can("screen"))) {
        const count = devices.length > 1 ? ` (${devices.length} cihaz)` : "";
        items.push(this.menuButton(ICON.info, "Bilgi kartı" + count, () => this.infoCard(ankamon.ui.devices.Platforms.only("Bilgi kartı", devices))));
      }
      return items;
    },

    /**
     * Yönetilebilir cihazın sağ menüsünün sayfadan bağımsız ortak gövdesi — page.Devices satır/kutucuk menüsü ve araç
     * çubuğu ile Ağ ▸ Varlıklar araç çubuğu (kullanıcı isteği 2026-11-23) aynı maddeleri buradan alır: menu() + eklenti
     * maddeleri (ankamon.ext.Extensions.addDeviceMenu; parent verilen madde o çekirdek grubunun alt menüsüne) +
     * logsAndInfo (Logları göster yok — Cihaz ayrıntıları ▸ Loglar). Sayfaya özgü maddeler `tail` ile son bölüme eklenir
     * (Cihazlar: Düzenle / Sil). İşletim sistemine göre devre dışı bırakma (ui.devices.Platforms.decorate) çağıranda.
     * @param tail {Array?} son bölüme, Bilgi kartı'nın ardına eklenecek menü maddeleri
     * @return {qx.ui.menu.Menu}
     */
    managedDeviceMenuBody(device, user, devices = [device], sessionOps = null, tail = []) {
      const menu = this.menu(device, user, devices, sessionOps) || new qx.ui.menu.Menu();
      const own = ankamon.ext.Extensions.deviceMenuItems(device, devices, user).filter(item => {
        const parent = item.getUserData("ankamon.menuParent");
        const host = parent && menu.getChildren().find(c => c instanceof qx.ui.menu.Button && c.getMenu()
          && c.getUserData("ankamon.menuKey") === parent);
        if (host) {
          host.getMenu().add(item);
        }
        return !host;
      });
      if (own.length) {
        if (menu.getChildren().length) {
          menu.add(new qx.ui.menu.Separator());
        }
        own.forEach(item => menu.add(item));
      }
      const last = this.logsAndInfo(device, user, devices, { noLogs: true }).concat(tail);
      if (last.length) {
        if (menu.getChildren().length) {
          menu.add(new qx.ui.menu.Separator());
        }
        last.forEach(item => menu.add(item));
      }
      return menu;
    },

    /** Devre dışı sağ menü maddelerinin opaklığı (bkz. menuButton). */
    DISABLED_OPACITY: 0.38,

    menu(device, user, devices = [device], sessionOps = null) {
      const can = feature => user.is_admin || user.features.includes(feature);
      // İşletim sistemine göre (kullanıcı isteği 2026-11-12; platforms/README.md): pencere açan maddeler yalnız işlevin
      // uygulaması olan cihazlarla açılır (os); işi worker yapan maddelerde desteklemeyen hedefi worker "Atlandı" yazar.
      // Maddelerin devre dışı/ipucu hâli: ui.devices.Platforms.decorate (page.Devices __rowMenu sonunda).
      const P = ankamon.ui.devices.Platforms;
      P.load().catch(() => {});
      const os = (key, list) => P.only(key, list);
      const menu = new qx.ui.menu.Menu();
      // Menü simgeleri resim değil, metne eklenen Unicode karakterdir — bkz. ankamon.ui.Shell.ICON
      // başındaki not (background-image tabanlı simgeler bu derlenmiş build'de güvenilmez).
      const ICON = ankamon.ui.Shell.ICON;
      const add = (icon, label, handler) => menu.add(this.menuButton(icon, label, handler));
      // Çoklu seçimde toplu uygulanan maddelerin etiketinde cihaz sayısı görünür.
      const count = devices.length > 1 ? ` (${devices.length} cihaz)` : "";
      // Alt menü yardımcıları: madde yoksa grup hiç eklenmez (yetkiye göre boş alt menü görünmesin).
      const sub = () => new qx.ui.menu.Menu();
      const subAdd = (target, icon, label, handler) => target.add(this.menuButton(icon, label, handler));
      // Cihazın durumuna bağlı madde (Uyut, Kilitle, Kilidi aç): yalnız uygun cihazlara uygulanır; uygun cihaz
      // yoksa (ör. zaten uykuda) görünür ama devre dışıdır.
      const stateAdd = (target, icon, label, list, handler) => {
        const button = this.menuButton(icon, label, () => handler(list));
        button.setEnabled(list.length > 0);
        target.add(button);
      };
      // Bilgisayarı aç (WoL) + Bilgisayarı kapat: her zaman yan yana (kullanıcı isteği), çevrimiçi/
      // çevrimdışı cihazda da. Her biri seçimin yalnız uygun kısmına uygulanır (aç → kapalı olanlar,
      // kapat → açık olanlar); uygulanacak cihaz yoksa madde görünür ama devre dışıdır.
      // "Kullanıcılar" ▸ Oturum geçmişi (kullanıcı isteği): Oturumlar sayfası o cihaza süzülmüş açılır
      // (bkz. page.Sessions.openWith, ui.sessions.List.showDevice). Tek cihaz: sağ tıklanan. Sayfa 'logs' ister.
      const sessionHistory = target => {
        if (can("logs")) {
          const name = device.label || device.hostname || device.ip || "#" + device.id;
          subAdd(target, ICON.sessions, "Oturum geçmişi", () => qx.event.message.Bus.dispatchByName(
            ankamon.ui.Shell.OPEN_PAGE, { page: "sessions", device: { id: device.id, name } }));
        }
      };
      const power = () => {
        if (!can("power")) {
          return;
        }
        const off = devices.filter(b => !b.online);
        const on = devices.filter(b => b.online);
        const n = list => (list.length > 1 ? ` (${list.length} cihaz)` : "");
        add(ICON.wol, "Bilgisayarı aç (WoL)" + n(off), () => this.wol(off, user, sessionOps));
        menu.getChildren()[menu.getChildren().length - 1].setEnabled(off.length > 0);
        add(ICON.shutdown, "Bilgisayarı kapat" + n(on), () => this.shutdown(on, user, sessionOps));
        menu.getChildren()[menu.getChildren().length - 1].setEnabled(on.length > 0);
        add(ICON.reboot, "Bilgisayarı yeniden başlat" + n(on), () => this.reboot(on, user));
        menu.getChildren()[menu.getChildren().length - 1].setEnabled(on.length > 0);
      };
      const group = (icon, label, submenu) => {
        if (submenu.getChildren().length) {
          menu.add(this.menuButton(icon, label, null, submenu));
        } else {
          submenu.dispose();
        }
      };
      if (device.online) {
        const online = devices.filter(b => b.online);
        // Komut çalıştır ▸ Hazır / Serbest komut çalıştır, Web terminal (kullanıcı isteği: sıra ve etiket bu).
        const commands = sub();
        if (can("actions") || can("shell")) {
          subAdd(commands, ICON.run, "Hazır / Serbest komut çalıştır" + count, () => this.run(devices, user));
        }
        if (can("shell")) {
          subAdd(commands, ICON.webshell, "Web terminal" + count, () =>
            devices.length > 1 ? this.webshellMulti(devices) : this.webshell(device));
        }
        // Komut menüsüne sabitlenen hazır komutlar (kullanıcı isteği 2026-11-23; Komut çalıştır penceresinde sabitlenir):
        // araç çubuğunun Komut düğmesi de bu alt menüden türer.
        ankamon.ui.devices.ReadyCommandPins.addMenuItems(commands, devices, user);
        group(ICON.run, "Komut çalıştır" + count, commands);

        // Yönet ▸ Ekranı göster, Bilgisayarı yönet, Uyandır, Uyut, giriş kilitleri, Web Filtre ▸ …
        // Ekran ▸ Ekranı kilitle, Ekran kilidini aç, Ekranımı yansıt ▸ <kalite> + Ses, Ekran görüntüsü al, Ekranı başka bilgisayara aktar…, Ekran aktarımını
        // durdur (kullanıcı isteği, 2026-11-05: eski "Ekran" grubu "Yönet" oldu, görüntü iletimi ayrı "Ekran" grubunda).
        // Araç çubuğu (ui.devices.ActionBar) aynı maddeleri kendi düğmelerine dağıtır — değişiklik orada da gözden geçirilir.
        const screens = sub();
        const display = sub();
        if (can("screen")) {
          subAdd(screens, ICON.screen, "Ekranı göster" + count, () => this.screen(os("Ekranı göster", devices), user));
        }
        if (can("screen") && can("screen.control")) {
          // Fare/klavye ile müdahale tek cihazda anlamlı: çoklu seçimde de yalnız sağ tıklanan cihaz.
          subAdd(screens, ICON.screenControl, "Bilgisayarı yönet", () => this.screen([device], user, true));
        }
        // Ekranı uyandır / Ekranı uyut (kullanıcı isteği 2026-11-13: araç çubuğunda Güç altında "Uyandır" bilgisayarı uyandırmak
        // sanılmasın diye başlarında "Ekranı" var). Uyandır: güç tasarrufuna girmiş (önizlemede siyah) ekranı uyandırır — çoklu seçimde tüm açık
        // cihazlar (bkz. worker executor/display.py). Ekranlar önizlemesinde iş penceresi açılmaz.
        if (can("screen")) {
          subAdd(screens, ICON.wakeScreen, "Ekranı uyandır" + count, () => (sessionOps && sessionOps.wake
            ? sessionOps.wake(online)
            : this.__job({ type: "wake", device_ids: online.map(b => b.id) }, "Ekranı uyandır")));
          // Uyut: ekranı güç tasarrufuna sokar (DPMS kapalı; cihaza dokunulunca açılır).
          stateAdd(screens, ICON.sleepScreen, "Ekranı uyut" + count, online.filter(b => !this.isScreenAsleep(b)), list => (sessionOps && sessionOps.sleep
            ? sessionOps.sleep(list)
            : this.__job({ type: "sleep", device_ids: list.map(b => b.id) }, "Ekranı uyut")));
        }
        // Ekranı kilitle: "Ekran kilidini aç"a dek cihazda tam ekran "Kilitli"; klavye, fare ve dokunmatik çalışmaz, yeniden
        // açılışta da sürer (bkz. worker executor/screenlock.py). Oturumu kilitle'den (parolayla açılır) ayrı. Ekran grubunda
        // (kullanıcı isteği 2026-11-11: Yönet'e taşınınca "artık yok" sanılıyordu); araç çubuğunda Ekran ve Kilit düğmelerinde.
        if (can("screen.lock")) {
          // Kapat/yeniden başlat gibi çıktı penceresinin altında "Bu pencereyi bir daha gösterme" kutusu
          // (kullanıcı isteği; __powerJob ile — kutu işaretliyse kilitleme yine yapılır, pencere açılmaz).
          // Durumu bilinmeyen cihaz (screen_locked gelmeyen çağıran) iki maddede de sayılır.
          stateAdd(display, ICON.screenLock, "Ekranı kilitle" + count, online.filter(b => b.screen_locked !== true), list => (sessionOps && sessionOps.screenLock
            ? sessionOps.screenLock(list, true)
            : this.__powerJob({ type: "screen_lock", device_ids: list.map(b => b.id) }, "Ekranı kilitle",
                "screen_lock", "kilitleme", user)));
          stateAdd(display, ICON.screenUnlock, "Ekran kilidini aç" + count, online.filter(b => b.screen_locked !== false), list => (sessionOps && sessionOps.screenLock
            ? sessionOps.screenLock(list, false)
            : this.__job({ type: "screen_unlock", device_ids: list.map(b => b.id) }, "Ekran kilidini aç")));
        }
        if (can("cast")) {
          display.add(this.menuButton(ICON.cast, "Ekranımı yansıt" + count, null, this.__castMenu(os("Ekranımı yansıt", online))));
        }
        // Ekran görüntüsü: Oturumlar ▸ Zaman çizelgesi'nde işaret olarak görünür (bkz. worker executor/screenshot.py).
        if (can("screen.screenshot")) {
          subAdd(display, ICON.screenshot, "Ekran görüntüsü al" + count, () => this.__powerJob(
            { type: "screenshot", device_ids: online.map(b => b.id) }, "Ekran görüntüsü", "screenshot", "görüntü alma", user));
        }
        // Ekran aktarımı: sağ tıklanan cihazın ekranı başka cihazlarda (bkz. ui.devices.RelayDialog, executor/relay.py).
        if (can("screen.relay")) {
          subAdd(display, ICON.relay, "Ekranı başka bilgisayara aktar…", () => ankamon.ui.devices.RelayDialog.open(device, os("Ekranı başka bilgisayara aktar…", online), user));
          stateAdd(display, ICON.relayStop, "Ekran aktarımını durdur", online.filter(b => b.relay_source || b.relay_is_source || b.relay_source === undefined),
            list => this.__powerJob({ type: "relay_stop", device_ids: list.map(b => b.id) }, "Ekran aktarımını durdur", "relay_stop", "durdurma", user));
        }
        // Klavye/fare/dokunmatik kilidi: seçili cihazların yalnız uygun olanlarına (bkz. worker executor/inputlock.py). Klavye
        // kilidi ekran klavyesini, fare kilidi dokunmayı da kapatır. Durumu bilinmeyen cihaz iki maddede de sayılır.
        if (can("screen.input")) {
          const locks = b => b.input_locks || [];
          const known = b => b.input_locks !== undefined;
          // Fare kilidi dokunmayı da tuttuğundan dokunmatik "kilitli" sayılır; kendi kilidi yoksa açılacak bir şey de yoktur.
          const held = (b, d) => locks(b).includes(d) || (d === "touch" && locks(b).includes("mouse"));
          const n = list => (list.length > 1 ? ` (${list.length} cihaz)` : "");
          [["keyboard", ICON.keyboard, "Klavyeyi kilitle", "Klavye kilidini aç", "Klavye kilitle"],
            ["mouse", ICON.mouse, "Fareyi kilitle", "Fare kilidini aç", "Fare kilitle"],
            ["touch", ICON.touch, "Dokunmatiği kilitle", "Dokunmatik kilidini aç", "Dokunmatik kilitle"]].forEach(([inputDev, icon, on, off, caption]) => {
            const lockable = online.filter(b => !known(b) || !held(b, inputDev));
            const unlockable = online.filter(b => !known(b) || locks(b).includes(inputDev));
            stateAdd(screens, icon, on + n(lockable), lockable, list => this.__powerJob(
              { type: "input_lock", device: inputDev, lock: true, device_ids: list.map(b => b.id) }, caption, "input_lock", "kilitleme", user));
            stateAdd(screens, ICON.unlockInput, off + n(unlockable), unlockable, list => this.__job(
              { type: "input_lock", device: inputDev, lock: false, device_ids: list.map(b => b.id) }, off));
          });
        }
        // Yönet ▸ Web filtresi (kullanıcı isteği): ETAP Pardus'taki eta-kisit ile kara/beyaz liste ve DNS sayıları (bkz.
        // ui.devices.EtaKisitWebFilter). Maddeler ne yaptıklarını söyler (kullanıcı: "kara liste" tek başına anlaşılmıyordu);
        // araç çubuğunda da Yönet ▸ Web filtresi alt menüsü olarak görünür (ActionBar mirror).
        if (can("devices.webfilter")) {
          const webFilter = ankamon.ui.devices.EtaKisitWebFilter;
          const online = os("Web filtresi", devices.filter(b => b.online));
          const filter = sub();
          subAdd(filter, ICON.webFilter, "Listedeki siteleri engelle (kara liste)…" + count, () => webFilter.open(online, devices, "denylist"));
          subAdd(filter, ICON.webFilter, "Yalnız listedeki sitelere izin ver (beyaz liste)…" + count, () => webFilter.open(online, devices, "allowlist"));
          subAdd(filter, ICON.webFilter, "Web filtresini kapat" + count, () => webFilter.turnOff(online));
          subAdd(filter, ICON.info, "Web filtresi durumu ve site sayıları…" + count, () => webFilter.open(online, devices));
          if (filter.getChildren().length) {
            screens.add(this.menuButton(ICON.webFilter, "Web filtresi", null, filter));
          }
        }
        group(ICON.screenControl, "Yönet" + count, screens);
        group(ICON.screen, "Ekran" + count, display);

        // "Bilgi kartı" burada değil: Cihazlar sayfasındaki "Logları göster"in hemen altında (kullanıcı
        // isteği) — bkz. page.Devices __rowMenu.

        // Oturumlar (eski etiketi "Kullanıcılar" — kullanıcı isteği 2026-11-09) ▸ Oturum aç ▸ <hesap>, Oturumu kapat, Oturumu
        // kilitle, Oturumları sorgula, Oturum geçmişi, Oturum hareketleri, Parola ayarla…, Kullanıcı ekle…, Kullanıcı sil…
        const sessions = sub();
        if (can("devices.login")) {
          sessions.add(this.menuButton(ICON.sessions, "Oturum aç" + count, null,
            this.__accountMenu(os("Oturum aç", online), "açılır", (acc, label) => this.__login(os("Oturum aç", online), acc, label, sessionOps))));
          subAdd(sessions, ICON.logout, "Oturumu kapat" + count, () => this.sessionAction("logout", online, sessionOps));
          // Yalnız açık (ve kilitli olmayan) oturumu olan cihazlar (kullanıcı isteği 2026-11-11: oturumsuz cihazda hiçbir
          // şey yapılmasın, "bir şey yapılmadı" iletisi de çıkmasın). Oturum bilgisi gelmeyen çağıranda cihaz uygun sayılır.
          const lockable = online.filter(b => (b.session_username === undefined || !!b.session_username) && b.session_locked !== true);
          stateAdd(sessions, ICON.lock, "Oturumu kilitle" + (lockable.length > 1 ? ` (${lockable.length} cihaz)` : ""), lockable,
            list => this.sessionAction("lock", list, sessionOps));
        }
        if (can("screen")) {
          // Ekranlar önizlemesinde sonuç kutucukların sol altında, grid'de iş penceresinde görünür; her
          // iki durumda da Cihazlar grid'inin "Oturum" sütunu güncellenir (bkz. runner whoami dalı).
          subAdd(sessions, ICON.sessions, "Oturumları sorgula" + count, () =>
            (sessionOps ? sessionOps.query(online) : this.__job({ type: "whoami", device_ids: online.map(b => b.id) }, "Oturumları sorgula")));
        }
        sessionHistory(sessions);
        if (can("logs")) {
          // Oturum hareketleri: Oturumlar ▸ Hareketler bu cihaza süzülmüş açılır (bkz. ui.sessions.Movements).
          subAdd(sessions, ICON.movements, "Oturum hareketleri", () => qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, {
            page: "sessions", movements: { device_id: device.id, device_name: device.label || device.hostname || device.ip }
          }));
        }
        // Parola ayarla…: bir ya da birçok hesaba ortak parola; etapadmin/root ayrı bölümde, kendi
        // parolasıyla ve ayrı yetkiyle (bkz. setPasswords; işi hazır işlem "user-password" yapar).
        if (can("devices.passwords")) {
          subAdd(sessions, ICON.password, "Parola ayarla…" + count, () => this.setPasswords(os("Parola ayarla…", online), user));
        }
        // Kullanıcı sil…: hesap(lar) seçilir, dosyaları silme varsayılan açık (bkz. deleteUsers; işi
        // hazır işlem "user-delete" yapar — Komut çalıştır listesinde de var).
        if (can("devices.users")) {
          // Kullanıcı ekle…: hazır işlem "user-add" (Komut çalıştır listesindeki) seçili açılır — kullanıcı isteği 2026-11-09.
          if (can("actions")) {
            subAdd(sessions, "＋", "Kullanıcı ekle…" + count, () => this.run(online, user, "user-add"));
          }
          subAdd(sessions, ICON.delete, "Kullanıcı sil…" + count, () => this.deleteUsers(os("Kullanıcı sil…", online)));
        }
        group(ICON.sessions, "Oturumlar", sessions);

        // Dosyalar ▸ Dosya yöneticisi, Bilgisayarlar arasında kopyala, Dosyaları dağıt/topla, Yedekle/Geri al (kullanıcı isteği: eski
        // "Yedekle" + "Dosya yöneticisi" tek grupta; Dosya yöneticisi ilk sırada). Bilgisayarı aç/kapat
        // çiftinin hemen üstünde.
        const files = sub();
        if (can("filemanager")) {
          subAdd(files, ICON.filemanager, "Dosya yöneticisi", () => this.filemanager(device));
          // İki panelli gezgin: bu cihazın kullanıcı dizinlerinden başka bir cihaza kopyalama.
          subAdd(files, ICON.copy, "Bilgisayarlar arasında kopyala", () => ankamon.ui.files.CopyWindow.open(device, user));
          // Toplu: bu bilgisayardan seçili cihazlardaki kullanıcıların bir konumuna (varsayılan Masaüstü) ve
          // tersi; tek pencerede "Dağıt" ve "Topla" sekmeleri (bkz. ui.files.BulkWindow). Cihaz seçimi değiştirilebilir.
          subAdd(files, ICON.bulk, "Dosyaları dağıt/topla" + count, () => ankamon.ui.files.BulkWindow.open(os("Dosyaları dağıt/topla", online), user));
        }
        if (can("devices.backup") || can("devices.restore")) {
          files.add(this.menuButton(ICON.backup, "Yedekle/Geri al" + count, () => ankamon.ui.homebackup.Window.open(os("Yedekle/Geri al", online), user)));
        }
        group(ICON.filemanager, "Dosyalar", files);
        // Görev yöneticisi (Windows'taki gibi; canlı SSH, pencere kapanınca biter — bkz. ui.taskmgr.Window):
        // "Dosyalar"ın hemen altında (kullanıcı isteği). Çoklu seçimde seçili çevrim içi cihazların HEPSİ tek pencerede
        // (cihaz başına ayrı pencere değil; Bilgisayar sütunu/süzgeciyle — bkz. ui.taskmgr.Window).
        if (can("taskmgr")) {
          add(ICON.taskmgr, "Görev yöneticisi" + count, () => ankamon.ui.taskmgr.Window.open(os("Görev yöneticisi", online), user));
        }
        // Web sitesi aç: seçili cihazlardan oturumu açık olanlarda varsayılan tarayıcıyla, tam ekran (bkz. worker executor/open_url.py).
        if (can("screen.web")) {
          const withSession = os("Web sitesi aç…", online).filter(b => b.session_username);
          const webCount = withSession.length > 1 ? ` (${withSession.length} cihaz)` : "";
          add(ICON.web, "Web sitesi aç…" + webCount, () => this.openWebsite(withSession));
          menu.getChildren()[menu.getChildren().length - 1].setEnabled(withSession.length > 0);
        }
        // Wi-Fi Monitör artık ankamon-wifi eklentisinde (kullanıcı isteği 2026-11-23): yüklü ve etkinse maddeyi kendisi ekler
        // (Extensions.addDeviceMenu — araç çubuğunda "Wi-Fi" düğmesiyle).
        // Sohbet: tek cihazda o cihazın penceresi; çoklu seçimde seçili çevrim içi cihazların HEPSİNE tek pencere (kullanıcı isteği
        // 2026-11-23 — karşı taraf varsayılan salt okur; bkz. ui.chat.Window).
        if (can("devices.chat")) {
          const chatTargets = os("Sohbet", online);
          const chatCount = chatTargets.length > 1 ? ` (${chatTargets.length} cihaz)` : "";
          add(ICON.chat, "Sohbet" + chatCount, () => ankamon.ui.chat.Window.open(chatTargets.length ? chatTargets : [device]));
        }
      } else {
        // Kapalı cihazda en olası iş onu açmak: Bilgisayarı aç (WoL) ve güç seçenekleri EN ÜSTTE (kullanıcı
        // isteği). Geçmiş yine anlamlı: "Kullanıcılar" yalnız "Oturum geçmişi" ile, altında.
        power();
        const sessions = sub();
        sessionHistory(sessions);
        group(ICON.sessions, "Oturumlar", sessions);
      }
      if (device.online) {
        power();
      }
      return menu.getChildren().length ? menu : null;
    },

    /** Web sitesi aç: adres sorar, açık oturumlu cihazlarda iş başlatır. */
    async openWebsite(devices) {
      const raw = await ankamon.ui.Dialog.prompt(
        `<b>${devices.length} bilgisayarda</b> varsayılan tarayıcıyla, ekranı kaplayarak açılacak site:`, "https://", "Aç", "Web sitesi aç");
      let url = (raw || "").trim();
      if (!url || url === "https://") {
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
      }
      this.__job({ type: "open_url", url, device_ids: devices.map(b => b.id) }, "Web sitesi aç");
    },

    /**
     * Kullanıcılar ▸ Kullanıcı sil…: seçili (çevrimiçi) cihazlardaki hesaplar tek listede (çoklu seçimde
     * birleşik; her hesabın kaç cihazda olduğu yazılır), silinecekler işaretlenir. "Tüm dosyaları sil"
     * varsayılan açık (kullanıcı isteği). İşi hazır işlem "user-delete" yapar (bkz. actions/user-delete):
     * hesabı olmayan cihazda o kullanıcı atlanır. Sonrasında hesap listesi önbellekleri düşürülür.
     */
    async deleteUsers(devices) {
      if (!devices.length) {
        ankamon.ui.Dialog.alert("Çevrimiçi cihaz yok.");
        return;
      }
      const esc = qx.bom.String.escape;
      const where = devices.length > 1 ? `${devices.length} cihaz` : esc(devices[0].label || devices[0].hostname || devices[0].ip);
      const win = ankamon.ui.Dialog.window(`Kullanıcı sil — ${devices.length > 1 ? devices.length + " cihaz" : devices[0].label || devices[0].hostname || devices[0].ip}`, 480);
      const status = new qx.ui.basic.Label("Hesaplar yükleniyor…").set({ rich: true, wrap: true, textColor: "app-muted" });
      win.add(status);
      // Listenin üstünde süzme kutusu: ad ya da tam adda geçen metne göre (işaretli olanlar gizlense de seçili kalır).
      const filter = new qx.ui.form.TextField().set({ placeholder: "Süz… (kullanıcı adı ya da tam ad)", liveUpdate: true });
      win.add(filter);
      const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
      // Scroll içeriği kadar büyümez: yükseklik hesaplar gelince satır sayısına göre verilir.
      const scroll = new qx.ui.container.Scroll(list).set({ height: 60 });
      win.add(scroll, { flex: 1 });
      const allFiles = new qx.ui.form.CheckBox("Kullanıcının tüm dosyalarını sil (ev dizini dahil)").set({ value: true });
      win.add(allFiles);
      const del = new qx.ui.form.Button("Sil").set({ enabled: false });
      ankamon.ui.Dialog.buttons(win, [del]);
      win.open();

      // Hesaplar: her cihazdan (önbellekten ya da "accounts" görevinden), ada göre birleştirilir.
      const results = await Promise.allSettled(devices.map(b => this.__accounts(b)));
      const merged = new Map();
      results.forEach(r => (r.status === "fulfilled" ? r.value : []).forEach(acc => {
        const hit = merged.get(acc.name) || { acc, n: 0 };
        hit.n++;
        merged.set(acc.name, hit);
      }));
      const failed = results.filter(r => r.status === "rejected").length;
      const boxes = [];
      const update = () => del.setEnabled(boxes.some(b => b.getValue()));
      // Cihazın yönetici hesabı listelenmez (sunucu da reddeder — bkz. JobsApi::UNDELETABLE_USERS).
      [...merged.values()].filter(({ acc }) => !["etapadmin", "root"].includes(acc.name)).forEach(({ acc, n }) => {
        const label = (acc.full_name && acc.full_name !== acc.name ? `${esc(acc.full_name)} (${esc(acc.name)})` : esc(acc.name)) +
          (devices.length > 1 ? ` <span style="opacity:.7">— ${n}/${devices.length} cihazda</span>` : "");
        const box = new qx.ui.form.CheckBox(label).set({ model: acc.name, rich: true });
        box.addListener("changeValue", update);
        box.setUserData("search", `${acc.name} ${acc.full_name || ""}`.toLocaleLowerCase("tr"));
        boxes.push(box);
        list.add(box);
      });
      const rootHeight = (qx.core.Init.getApplication().getRoot().getBounds() || { height: 800 }).height;
      // Daha uzun liste (kullanıcı isteği): en az ~12 satırlık yer, ekrana sığdığı kadar.
      // Pencerenin geri kalanı (başlık, durum, süzme kutusu, dosya seçeneği, düğmeler) ~330 px.
      scroll.setHeight(Math.max(Math.min(300, rootHeight - 330), Math.min(boxes.length * 24 + 8, rootHeight - 330)));
      filter.addListener("changeValue", () => {
        const q = (filter.getValue() || "").trim().toLocaleLowerCase("tr");
        boxes.forEach(b => b.setVisibility(!q || b.getUserData("search").includes(q) ? "visible" : "excluded"));
      });
      qx.ui.core.queue.Manager.flush(); // yeni yükseklik uygulanmadan center() eski boyuta göre ortalar
      win.center();
      status.setValue(boxes.length
        ? "Silinecek kullanıcıları işaretleyin." + (failed ? ` <span style="color:#c42b1c">${failed} cihazın hesapları okunamadı.</span>` : "")
        : "Silinebilecek kullanıcı hesabı bulunamadı" + (failed ? " (hesaplar okunamadı)." : "."));

      del.addListener("execute", async () => {
        const names = boxes.filter(b => b.getValue()).map(b => b.getModel());
        const files = allFiles.getValue();
        const shown = names.map(n => "• " + esc(n)).join("<br>");
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${where}</b> üzerinde ${names.length} kullanıcı <b>kalıcı olarak</b> silinsin mi?<br><br>${shown}<br><br>` +
          (files
            ? "Ev dizinleri ve sistemin başka yerlerindeki tüm dosyaları da <b>silinecek</b>; geri alınamaz."
            : "Yalnız hesaplar silinecek; dosyaları cihazda kalacak.") +
          "<br>Açık oturumları ve çalışan programları önce kapatılır.", "Sil");
        if (!ok) {
          return;
        }
        win.close();
        devices.forEach(b => delete this.__accountsCache[b.id]);
        this.__job({
          type: "action", action: "user-delete", device_ids: devices.map(b => b.id),
          values: { KULLANICILAR: names.join(" "), DOSYALAR: files ? "tum" : "koru" }
        }, `Kullanıcı sil — ${names.join(", ")}`);
      });
    },

    /**
     * Kullanıcılar ▸ Parola ayarla…: seçili (çevrimiçi) cihazlardaki hesaplar tek listede (bkz. deleteUsers);
     * işaretlenen hesaplara ortak bir parola verilir. Cihazın yönetici hesapları (etapadmin, root) bu
     * listede YOKTUR — gözden kaçıp öğrenci hesaplarıyla aynı parolayı almasınlar diye ayrı bir bölümde,
     * varsayılan kapalı, her biri kendi parolasıyla ve kendi yetkisiyle ("devices.passwords.<hesap>")
     * ayarlanır. Her parola iki kutuya yazılır; sonunda onay alınır. Her parola grubu ayrı bir görevdir
     * (hazır işlem "user-password"; parola görev bitince sunucudan silinir, denetim kaydına maskeli yazılır).
     * İkinci sekme: root ve etapadmin parolası yalnız seçilen bilgisayarda (bkz. ui.devices.AdminPasswordPanel).
     */
    async setPasswords(devices, user) {
      if (!devices.length) {
        ankamon.ui.Dialog.alert("Çevrimiçi cihaz yok.");
        return;
      }
      const esc = qx.bom.String.escape;
      const can = feature => user.is_admin || user.features.includes(feature);
      const ADMIN = ["etapadmin", "root"];
      const where = devices.length > 1 ? `${devices.length} cihaz` : esc(devices[0].label || devices[0].hostname || devices[0].ip);
      const win = ankamon.ui.Dialog.window(`Parola ayarla — ${devices.length > 1 ? devices.length + " cihaz" : devices[0].label || devices[0].hostname || devices[0].ip}`, 560);
      // İki sekme: "Kullanıcılar" (toplu) ve yönetici hesapları (tek bilgisayarda, bkz. ui.devices.AdminPasswordPanel).
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
      const pane = new qx.ui.tabview.Page("Kullanıcılar");
      pane.setLayout(new qx.ui.layout.VBox(12));
      pane.setPadding(10);
      tabs.add(pane);
      const ownAccounts = ADMIN.filter(name => can("devices.passwords." + name));
      if (ownAccounts.length) {
        tabs.add(new ankamon.ui.devices.AdminPasswordPanel(devices, ownAccounts));
      }
      win.setContentPadding(6);
      win.add(tabs, { flex: 1 });

      // Çift kutulu parola girişi: iki kutu ve anlık eşleşme notu. check() → hata metni ya da null.
      const pairs = [];
      const pairBox = bootWipe => {
        const box = new qx.ui.container.Composite(new qx.ui.layout.Grid(8, 6));
        box.getLayout().setColumnFlex(1, 1);
        const first = new qx.ui.form.PasswordField().set({ placeholder: "Yeni parola", liveUpdate: true });
        const second = new qx.ui.form.PasswordField().set({ placeholder: "Yeni parola (tekrar)", liveUpdate: true });
        const note = new qx.ui.basic.Label("").set({ rich: true });
        [first, second].forEach(f => f.getContentElement().setAttribute("autocomplete", "new-password"));
        box.add(new qx.ui.basic.Label("Parola:").set({ alignY: "middle" }), { row: 0, column: 0 });
        box.add(first, { row: 0, column: 1 });
        // Rastgele parola düğmesi + Göster (ui.PasswordDice): üretilen parola iki kutuya yazılır ve gösterilir.
        box.add(ankamon.ui.PasswordDice.controls([first, second]), { row: 0, column: 2 });
        box.add(new qx.ui.basic.Label("Tekrar:").set({ alignY: "middle" }), { row: 1, column: 0 });
        box.add(second, { row: 1, column: 1 });
        box.add(note, { row: 2, column: 1, colSpan: 2 });
        if (bootWipe) {
          // Uzun açıklama sarmalı ipucunda (tek satır ekranı boydan boya geçiyordu — kullanıcı bildirimi 2026-11-13).
          const tip = ankamon.ui.ToolTipPolicy.wrapped(this.BOOT_WIPE_HINT);
          box.add(new qx.ui.basic.Label(this.BOOT_WIPE_NOTE).set({ textColor: "app-warn", toolTip: tip, alignY: "middle" }), { row: 1, column: 2 });
          first.setToolTip(tip);
        }
        const pair = {
          box, first, second,
          value: () => first.getValue() || "",
          check() {
            const a = first.getValue() || "";
            const b = second.getValue() || "";
            if (!a) {
              return "Parola boş.";
            }
            if (a.length > 128) {
              return "Parola en çok 128 karakter olabilir.";
            }
            // Sunucu baştaki/sondaki boşlukları kırpar; kullanıcı bilmeden farklı bir parola almasın.
            if (a !== a.trim()) {
              return "Parola boşlukla başlayıp bitemez.";
            }
            if (/[\x00-\x1f\x7f]/.test(a)) {
              return "Parola denetim karakteri içeremez.";
            }
            return a === b ? null : "İki kutudaki parolalar aynı değil.";
          },
          showNote() {
            const err = (first.getValue() || second.getValue()) ? this.check() : null;
            note.setValue(err ? `<span style="color:#c42b1c">${esc(err)}</span>`
              : first.getValue() ? '<span style="color:#2fa84a">✓ Parolalar eşleşiyor</span>' : "");
          }
        };
        [first, second].forEach(f => f.addListener("changeValue", () => {
          pair.showNote();
          update();
        }));
        pairs.push(pair);
        return pair;
      };

      // 1) Kullanıcı hesapları: süzme kutusu + işaretlenebilir liste + ortak parola.
      const status = new qx.ui.basic.Label("Hesaplar yükleniyor…").set({ rich: true, wrap: true, textColor: "app-muted" });
      pane.add(status);
      const filter = new qx.ui.form.TextField().set({ placeholder: "Süz… (kullanıcı adı ya da tam ad)", liveUpdate: true });
      const all = new qx.ui.form.CheckBox("Görünenlerin tümü");
      const top = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      top.add(filter, { flex: 1 });
      top.add(all);
      pane.add(top);
      const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
      const scroll = new qx.ui.container.Scroll(list).set({ height: 60 });
      pane.add(scroll, { flex: 1 });
      const users = pairBox(true);
      pane.add(users.box);

      // 2) Yönetici hesapları: yalnız yetkisi olanlar; her biri ayrı onay kutusu ve ayrı çift kutulu parola.
      const admins = ADMIN.filter(name => can("devices.passwords." + name)).map(name => {
        const group = new qx.ui.groupbox.GroupBox(name === "root" ? "⚠ root (sistem yöneticisi)" : "⚠ etapadmin (cihazın yönetici hesabı)")
          .set({ layout: new qx.ui.layout.VBox(6) });
        const box = new qx.ui.form.CheckBox(`<b>${name}</b> parolasını da ayarla (ayrı parola)`).set({ rich: true });
        group.add(box);
        if (name === "root") {
          group.add(new qx.ui.basic.Label('<span style="color:#c42b1c">Ankamon cihazlara root ile bağlanır: yeni parola bu cihazlar ' +
            "için kaydedilir, bağlantı onunla sürer. Genel parola (Ayarlar ▸ SSH erişimi) değişmez.</span>")
            .set({ rich: true, wrap: true }));
        }
        const pair = pairBox();
        pair.box.setVisibility("excluded");
        group.add(pair.box);
        box.addListener("changeValue", e => {
          pair.box.setVisibility(e.getData() ? "visible" : "excluded");
          update();
          qx.ui.core.queue.Manager.flush(); // pencere uzadı/kısaldı: ekranda kalsın
          win.center();
        });
        pane.add(group);
        return { name, box, pair };
      });

      // Düğme neden kapalı: eksik/hatalı olan her şey düğmelerin üstünde, canlı.
      const problems = new qx.ui.basic.Label("").set({ rich: true, wrap: true });
      pane.add(problems);
      const apply = new qx.ui.form.Button("Parolayı ayarla").set({ enabled: false });
      ankamon.ui.Dialog.buttons(pane, [apply]);
      const boxes = [];
      const chosen = () => boxes.filter(b => b.getValue()).map(b => b.getModel());
      // Bir şey seçildiyse ve seçilen her grubun parolası geçerliyse etkin.
      const errors = () => {
        const out = [];
        const names = chosen();
        if (names.length && users.check()) {
          out.push("Kullanıcılar: " + users.check());
        }
        admins.filter(a => a.box.getValue()).forEach(a => {
          const err = a.pair.check();
          if (err) {
            out.push(`${a.name}: ${err}`);
          } else if (names.length && a.pair.value() === users.value()) {
            // Gözden kaçmaya karşı: yönetici hesabı öğrenci hesaplarıyla aynı parolayı alamaz.
            out.push(`${a.name}: parolası kullanıcı hesaplarınınkiyle aynı olamaz.`);
          }
        });
        if (!names.length && !admins.some(a => a.box.getValue())) {
          out.push("Parolası ayarlanacak bir hesap seçin.");
        }
        return out;
      };
      const update = () => {
        users.box.setEnabled(boxes.some(b => b.getValue()));
        const errs = errors();
        apply.setEnabled(!errs.length);
        problems.setValue(errs.map(e => `<span style="color:#c42b1c">• ${esc(e)}</span>`).join("<br>"));
      };
      win.open();

      const results = await Promise.allSettled(devices.map(b => this.__accounts(b)));
      const merged = new Map();
      results.forEach(r => (r.status === "fulfilled" ? r.value : []).forEach(acc => {
        const hit = merged.get(acc.name) || { acc, n: 0 };
        hit.n++;
        merged.set(acc.name, hit);
      }));
      const failed = results.filter(r => r.status === "rejected").length;
      [...merged.values()].filter(({ acc }) => !ADMIN.includes(acc.name)).forEach(({ acc, n }) => {
        const label = (acc.full_name && acc.full_name !== acc.name ? `${esc(acc.full_name)} (${esc(acc.name)})` : esc(acc.name)) +
          (devices.length > 1 ? ` <span style="opacity:.7">— ${n}/${devices.length} cihazda</span>` : "");
        const box = new qx.ui.form.CheckBox(label).set({ model: acc.name, rich: true });
        box.addListener("changeValue", update);
        box.setUserData("search", `${acc.name} ${acc.full_name || ""}`.toLocaleLowerCase("tr"));
        boxes.push(box);
        list.add(box);
      });
      const visible = () => boxes.filter(b => b.getVisibility() === "visible");
      all.addListener("execute", () => visible().forEach(b => b.setValue(all.getValue())));
      filter.addListener("changeValue", () => {
        const q = (filter.getValue() || "").trim().toLocaleLowerCase("tr");
        boxes.forEach(b => b.setVisibility(!q || b.getUserData("search").includes(q) ? "visible" : "excluded"));
        all.setValue(visible().length > 0 && visible().every(b => b.getValue()));
      });
      // Liste en çok ~13 satır; pencere ekrandan uzun olamaz — yönetici bölümü açılınca küçülen liste olur
      // (Scroll esnek: VBox fazlayı ondan keser).
      const rootHeight = (qx.core.Init.getApplication().getRoot().getBounds() || { height: 800 }).height;
      win.setMaxHeight(rootHeight - 20);
      scroll.set({ minHeight: 96, height: Math.min(boxes.length * 24 + 8, 320) });
      qx.ui.core.queue.Manager.flush();
      win.center();
      status.setValue((boxes.length
        ? "Parolası ayarlanacak kullanıcıları işaretleyin; işaretlenenlerin hepsine aynı parola verilir."
        : "Listelenecek kullanıcı hesabı bulunamadı" + (failed ? " (hesaplar okunamadı)." : ".")) +
        (failed && boxes.length ? ` <span style="color:#c42b1c">${failed} cihazın hesapları okunamadı.</span>` : ""));
      update();

      apply.addListener("execute", async () => {
        const errs = errors();
        if (errs.length) {
          ankamon.ui.Dialog.alert(errs.map(esc).join("<br>"));
          return;
        }
        const names = chosen();
        const picked = admins.filter(a => a.box.getValue());
        const lines = [];
        if (names.length) {
          lines.push(`${names.length} kullanıcı (aynı parola): ` + names.map(esc).join(", "));
        }
        picked.forEach(a => lines.push(`<b style="color:#c42b1c">${a.name}</b> — ayrı parola` +
          (a.name === "root" ? ' <span style="color:#c42b1c">(Ankamon bu cihazlara yeni parolayla bağlanır)</span>' : "")));
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${where}</b> üzerinde şu hesapların parolası değiştirilsin mi?<br><br>${lines.map(l => "• " + l).join("<br>")}` +
          "<br><br>Açık oturumlar kapanmaz; yeni parola bir sonraki girişte geçerli olur.", "Parolayı ayarla");
        if (!ok) {
          return;
        }
        win.close();
        const job = (accounts, password, caption) => this.__job({
          type: "action", action: "user-password", device_ids: devices.map(b => b.id),
          values: { KULLANICILAR: accounts.join(" "), PAROLA: password }
        }, caption);
        if (names.length) {
          job(names, users.value(), `Parola ayarla — ${names.length > 3 ? names.length + " kullanıcı" : names.join(", ")}`);
        }
        picked.forEach(a => job([a.name], a.pair.value(), `Parola ayarla — ${a.name}`));
      });
    },

    /**
     * Tek pencerede hem hazır işlem kataloğunu hem serbest komutu sunar (eski ayrı "Uzaktan işlemler" /
     * "Toplu komut" birleştirildi). Seçim kutusunun ilk satırı "— Serbest komut —"; o seçiliyken bir
     * komut kutusu, bir hazır işlem seçiliyken onun açıklaması + parametre formu gösterilir.
     * @param devices {Array} hedef cihazlar
     * @param user {Map} oturum sahibi — hangi seçeneklerin sunulacağını (actions/shell yetkisi) belirler
     * @param preselect {String?} pencere bu hazır işlem (actions/<id>) seçili açılır — ör. Bakım ▸ Sensörler
     *   uyarısındaki kurulum bağlantıları; işlem listede yoksa (yetki) ilk satır kalır
     *
     * Eklentilerin hazır komutları (ankamon.ext.Extensions.addReadyCommandSource — ör. TiHA adımları) listenin sonunda
     * kendi başlıklarıyla; seçilip Çalıştır'a basılınca eklentinin kendi yolu (penceresi/onayı) çalışır. Seçim kutusunun
     * yanındaki "Sabitle" düğmesi seçili hazır komutu Komut menüsüne sabitler (ui.devices.ReadyCommandPins — kullanıcı
     * isteği 2026-11-23); sabit olanların başında ★.
     */
    async run(devices, user, preselect = null) {
      const ids = devices.map(b => b.id);
      if (!ids.length) {
        ankamon.ui.Dialog.alert("Önce bir ya da daha fazla cihaz işaretleyin.");
        return;
      }
      const canActions = user.is_admin || user.features.includes("actions");
      const canCommand = user.is_admin || user.features.includes("shell");
      let actions = [];
      if (canActions) {
        try {
          actions = (await ankamon.io.Api.get("/actions")).actions;
        } catch (e) {
          ankamon.ui.Dialog.error(e);
          return;
        }
      }
      // Eklentilerin hazır komutları (yüklü, etkin ve kullanıcı yetkiliyse kaynak kayıtlıdır).
      const extEntries = await ankamon.ext.Extensions.readyCommands(user).catch(() => []);
      const Pins = ankamon.ui.devices.ReadyCommandPins;
      const pinEntry = model => (model.extEntry
        ? { key: model.extEntry.key, label: model.extEntry.label, platforms: model.extEntry.platforms || null }
        : { key: "action:" + model.id, label: model.title, platforms: model.platforms || null });
      Pins.refreshLabels(user, actions.map(pinEntry).concat(extEntries.map(e => pinEntry({ extEntry: e }))));

      // İşletim sistemine göre (kullanıcı isteği 2026-11-12; platforms/README.md): üstte hedeflerin aile dağılımı; hazır
      // işlemler desteklediği aileleri gösterir, seçili cihazların hiçbirinde betiği olmayan işlem seçilemez; serbest
      // komutta seçimde bulunan her aile için ayrı kutu (Linux/macOS bash, Windows PowerShell) — her cihaza kendi
      // ailesinin komutu gider (worker runner _command_for).
      const P = ankamon.ui.devices.Platforms;
      await P.load().catch(() => {});
      const present = P.counts(devices).map(([f]) => f);
      const win = ankamon.ui.Dialog.window(`Komut çalıştır — ${ids.length} cihaz`, 620);
      win.add(new qx.ui.basic.Label(`<b>Hedefler:</b> ${qx.bom.String.escape(P.summary(devices))}`)
        .set({ rich: true, toolTipText: "Cihazların işletim sistemi ailesi: komutlar ve hazır işlemler her cihaza kendi sistemine göre gönderilir." }));
      const select = new qx.ui.form.SelectBox();
      if (canCommand) {
        select.add(new qx.ui.form.ListItem("— Serbest komut —", null, null));
      }
      const famText = a => (a.platforms || ["linux"]).map(f => P.label(f)).join(", ");
      // Seçim satırının metni: sabitse başında ★ (sabitleme değişince yeniden yazılır — bkz. pinBtn).
      const itemText = (category, title, model) => `${Pins.isPinned(user, pinEntry(model).key) ? "★ " : ""}${category} — ${title}  [${famText(model.extEntry || model)}]`;
      const addItem = (category, title, model) => {
        const usable = present.filter(f => ((model.extEntry || model).platforms || ["linux"]).includes(f));
        const item = new qx.ui.form.ListItem(itemText(category, title, model), null, model);
        item.setUserData("ankamon.itemText", () => itemText(category, title, model));
        if (!usable.length) {
          item.set({ enabled: false, toolTipText: `Seçili cihazların sisteminde (${present.map(f => P.label(f)).join(", ")}) bu işlemin uygulaması yok.` });
        }
        select.add(item);
      };
      actions.forEach(a => addItem(a.category, a.title, a));
      extEntries.forEach(e => addItem(e.category || "Eklenti", e.label, { extEntry: e }));
      if (!select.getChildren().length) {
        ankamon.ui.Dialog.alert("Çalıştırabileceğiniz hazır işlem ya da komut izniniz yok.");
        win.close();
        return;
      }
      // Seçili hazır komutu Komut menüsüne (sağ menü Komut çalıştır ▸ ve araç çubuğu Komut düğmesi) sabitle / kaldır.
      const pinBtn = new qx.ui.form.Button("").set({ padding: [2, 8] });
      const selectRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
      selectRow.add(select, { flex: 1 });
      selectRow.add(pinBtn);
      win.add(selectRow);
      const syncPin = () => {
        const sel = select.getSelection()[0];
        const model = sel ? sel.getModel() : null;
        const pinned = !!model && Pins.isPinned(user, pinEntry(model).key);
        pinBtn.set({
          label: pinned ? "★ Sabitlendi" : "☆ Sabitle", enabled: !!model,
          toolTipText: !model ? "Serbest komut sabitlenemez; bir hazır komut seçin."
            : pinned ? "Komut menüsünde sabit — tıklayınca sabitleme kalkar."
              : "Komut menüsüne sabitle: sağ menüde Komut çalıştır ▸ altında ve araç çubuğundaki Komut düğmesinde doğrudan madde olur."
        });
      };
      pinBtn.addListener("execute", () => {
        const sel = select.getSelection()[0];
        if (!sel || !sel.getModel()) {
          return;
        }
        Pins.toggle(user, pinEntry(sel.getModel()));
        sel.setLabel(sel.getUserData("ankamon.itemText")());
        syncPin();
      });
      const desc = new qx.ui.basic.Label("").set({ rich: true, wrap: true, textColor: "app-muted" });
      win.add(desc);
      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox());
      win.add(body, { flex: 1 });

      let form = null;
      let commandArea = null;
      const showSel = () => {
        const sel = select.getSelection()[0];
        const action = sel ? sel.getModel() : null;
        body.removeAll().forEach(w => w.dispose());
        form = null;
        commandArea = null;
        syncPin();
        if (action && action.extEntry) {
          const entry = action.extEntry;
          const fams = entry.platforms || ["linux"];
          const skipped = devices.filter(b => !fams.includes(P.familyOf(b)));
          desc.setValue(qx.bom.String.escape(entry.hint || "") +
            `<br><span style="opacity:.8">Tanımlı olduğu sistemler: ${qx.bom.String.escape(famText(entry))}` +
            (skipped.length ? ` — <b>${skipped.length} cihaz (${qx.bom.String.escape(P.summary(skipped))}) atlanır</b>` : "") + "</span>" +
            `<br><b>${qx.bom.String.escape(entry.runNote || "Çalıştır, komutun kendi penceresini açar (ayarlar ve onay orada).")}</b>`);
        } else if (action === null) {
          // Aile başına komut kutusu (yalnız seçimde bulunan ve serbest komutu destekleyen aileler).
          const shells = present.filter(f => P.supports("Hazır / Serbest komut çalıştır", f));
          const other = present.filter(f => !shells.includes(f));
          desc.setValue("İşaretli cihazlarda çalıştırılacak komut — her cihaza kendi işletim sisteminin kutusundaki komut gider; " +
            "boş bırakılan sistemdeki cihazlar atlanır." + (other.length ? ` ${other.map(f => P.label(f)).join(", ")} cihazlarda serbest komut tanımlı değil.` : ""));
          commandArea = {};
          const hint = { linux: "ör. systemctl restart prometheus-node-exporter", windows: "ör. Get-Service | Where-Object Status -eq 'Running'",
            macos: "ör. softwareupdate -l" };
          shells.forEach(f => {
            const fam = P.catalog().families[f] || {};
            const n = P.counts(devices).find(([x]) => x === f)[1];
            body.add(new qx.ui.basic.Label(`<b>${qx.bom.String.escape(P.label(f))}</b> — ${n} cihaz · ${fam.shell === "powershell" ? "PowerShell" : "bash"}`)
              .set({ rich: true, marginTop: 4 }));
            commandArea[f] = new qx.ui.form.TextArea("").set({ font: "app-mono", height: shells.length > 1 ? 90 : 140, placeholder: hint[f] || "" });
            body.add(commandArea[f]);
          });
        } else {
          const usable = present.filter(f => (action.platforms || ["linux"]).includes(f));
          const skipped = devices.filter(b => !usable.includes(P.familyOf(b)));
          desc.setValue(qx.bom.String.escape(action.description) +
            `<br><span style="opacity:.8">Tanımlı olduğu sistemler: ${qx.bom.String.escape(famText(action))}` +
            (skipped.length ? ` — <b>${skipped.length} cihaz (${qx.bom.String.escape(P.summary(skipped))}) atlanır</b>` : "") + "</span>");
          if (action.ui) {
            // Kendi arayüzü olan hazır komut (ör. Disk editörü): Çalıştır o pencereyi açar.
            desc.setValue(desc.getValue() + `<br><b>${ids.length === 1 ? "Çalıştır, işlemin penceresini açar."
              : "Bu hazır komut tek cihazda çalışır — yalnız bir cihaz işaretleyin."}</b>`);
          } else {
            form = this.actionForm(action);
            if (form) {
              body.add(form);
            }
          }
        }
      };
      const pre = preselect && select.getChildren().find(i => i.getModel() && i.getModel().id === preselect);
      if (pre) {
        select.setSelection([pre]);
      }
      select.addListener("changeSelection", showSel);
      showSel();

      // Vazgeç düğmesi yok: pencerenin kendi kapatma (×) düğmesi yeterli (kullanıcı isteği).
      // "Çalıştır" ek onay sormaz: pencere hemen kapanır, görev beklemeden başlar ve canlı çıktı
      // penceresi açılır (bkz. ui.Jobs) — seçim + Çalıştır zaten bilinçli bir onaydır.
      const runBtn = new qx.ui.form.Button("Çalıştır");
      runBtn.addListener("execute", () => {
        const sel = select.getSelection()[0];
        const action = sel ? sel.getModel() : null;
        if (action && action.extEntry) {
          win.close();
          action.extEntry.run(devices, user);
          return;
        }
        if (action === null) {
          const commands = {};
          Object.entries(commandArea || {}).forEach(([f, area]) => {
            const text = (area.getValue() || "").trim();
            if (text) {
              commands[f] = text;
            }
          });
          if (!Object.keys(commands).length) {
            return;
          }
          win.close();
          this.__job({ type: "command", commands, device_ids: ids }, "Komut çıktısı");
          return;
        }
        if (action.ui) {
          if (ids.length !== 1) {
            ankamon.ui.Dialog.alert(`${action.title} tek cihazda çalışır — yalnız bir cihaz işaretleyin.`);
            return;
          }
          win.close();
          this.openActionUi(action, devices[0]);
          return;
        }
        win.close();
        this.__job({ type: "action", action: action.id, device_ids: ids, values: form ? form.values() : {} },
          `Komut çıktısı — ${action.title}`);
      });
      ankamon.ui.Dialog.buttons(win, [runBtn]);
      win.open();
    },

    /**
     * Hazır işlemin parametre formu (parametresi yoksa null) — Komut çalıştır ve web terminalin Hazır komutlar menüsü
     * (ui.ssh.TerminalActions) ortak kullanır.
     * @param action {Map} /api/actions öğesi
     * @return {ankamon.ui.Form|null}
     */
    actionForm(action) {
      if (!action.params.length) {
        return null;
      }
      const form = new ankamon.ui.Form();
      action.params.forEach(p => {
        if (p.type === "select") {
          form.select(p.key, p.label, p.options, p.default);
        } else if (p.type === "password") {
          // Gizli değer (ör. BIOS parolası): maskeli; tarayıcı kayıtlı oturum parolasını buraya
          // kendiliğinden doldurmasın diye "new-password" (Ankamon parolası BIOS'a yazılmasın).
          const field = form.password(p.key, p.label, null, p.boot_wipe_note ? { note: this.BOOT_WIPE_NOTE, hint: this.BOOT_WIPE_HINT } : null);
          field.getContentElement().setAttribute("autocomplete", "new-password");
        } else {
          form.text(p.key, p.label, p.default);
        }
      });
      // Salt okunur, başka alandan üretilen alan: yazıldıkça dolar (bkz. user-add "derive").
      action.params.filter(p => p.derive === "etap_username").forEach(p => {
        const target = form.getField(p.key).set({ readOnly: true, focusable: false });
        const source = form.getField(p.from).set({ liveUpdate: true });
        source.addListener("changeValue", e => target.setValue(this.etapUsername(e.getData())));
      });
      return form;
    },

    /**
     * Hazır işlemi Komut çalıştır penceresi olmadan çalıştırır — Komut menüsüne sabitlenmiş madde (ui.devices.ReadyCommandPins):
     * kendi arayüzü olan işlem (ör. Disk editörü) penceresini açar (tek cihaz); parametresi olan işlem önce parametre
     * penceresini; parametresizse action.json "confirm" verilmişse onay sorulur (menüden tek tıkla yeniden başlat/kapat
     * gibi işler kazara çalışmasın), sonra görev başlar ve canlı çıktı penceresi açılır.
     * @param action {Map} /api/actions öğesi
     */
    async runReadyAction(action, devices, user) {
      const ids = devices.map(b => b.id);
      if (!ids.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      if (action.ui) {
        if (ids.length !== 1) {
          ankamon.ui.Dialog.alert(`${esc(action.title)} tek cihazda çalışır — yalnız bir cihaz işaretleyin.`);
          return;
        }
        this.openActionUi(action, devices[0]);
        return;
      }
      const caption = `Komut çıktısı — ${action.title}`;
      const form = this.actionForm(action);
      if (!form) {
        if (action.confirm && !await ankamon.ui.Dialog.confirm(
          `<b>${esc(action.title)}</b> ${ids.length > 1 ? `<b>${ids.length} cihazda</b>` : "seçili cihazda"} çalıştırılsın mı?` +
          (action.description ? `<br><br>${esc(action.description)}` : ""), "Çalıştır")) {
          return;
        }
        this.__job({ type: "action", action: action.id, device_ids: ids, values: {} }, caption);
        return;
      }
      const P = ankamon.ui.devices.Platforms;
      const win = ankamon.ui.Dialog.window(`${action.title} — ${ids.length} cihaz`, 560);
      win.add(new qx.ui.basic.Label(`<b>Hedefler:</b> ${esc(P.summary(devices))}`).set({ rich: true }));
      win.add(new qx.ui.basic.Label(esc(action.description || "")).set({ rich: true, wrap: true, textColor: "app-muted" }));
      win.add(form);
      const runBtn = new qx.ui.form.Button("Çalıştır");
      runBtn.addListener("execute", () => {
        win.close();
        this.__job({ type: "action", action: action.id, device_ids: ids, values: form.values() }, caption);
      });
      ankamon.ui.Dialog.buttons(win, [runBtn]);
      win.open();
    },

    /**
     * Kendi arayüzü olan hazır komutu (action.json "ui") tek cihazda açar — ör. "disk-editor" → ui.disk.DiskEditor.
     * @param action {Map} /api/actions öğesi
     * @param device {Map} hedef cihaz
     */
    openActionUi(action, device) {
      if (action.ui === "disk-editor") {
        ankamon.ui.disk.DiskEditor.open(device);
      } else {
        ankamon.ui.Dialog.alert(`${action.title}: bu sürümde arayüzü yok.`);
      }
    },

    /** Görevi kuyruğa yazar ve canlı çıktı penceresini İSTEK SÜRERKEN açar (beklemeden). */
    __job(body, caption) {
      ankamon.ui.Jobs.show(ankamon.io.Api.post("/jobs", body).then(res => res.id), caption);
    },

    // "Oturum aç" hesap listesi, cihaz başına (tarayıcı tarafı; sunucu da 24 sa önbellekler —
    // bkz. worker executor/accounts.py). Her sağ tıkta yeni bir görev kaydı açılmasın diye.
    __accountsCache: {},
    ACCOUNTS_TTL_MS: 24 * 3600 * 1000,

    /**
     * Sağ menünün hesap alt menüsü ("Oturum aç"): cihazdaki hesaplar (çoklu seçimde İLK
     * cihazdan alınır), birine tıklanınca onPick(hesap, etiket) çağrılır — işlem seçili TÜM cihazlara
     * uygulanır. Liste alt menü ilk kez açılınca yüklenir (menü açılışını SSH beklemesiyle geciktirmemek için).
     * @param verb {String} çoklu seçim bilgi satırı için ("açılır")
     */
    __accountMenu(devices, verb, onPick) {
      const sub = new qx.ui.menu.Menu();
      const info = text => sub.add(new qx.ui.menu.Button(text).set({ enabled: false }));
      if (!devices.length) {
        info("Çevrimiçi cihaz yok");
        return sub;
      }
      info("Hesaplar yükleniyor…");
      let loaded = false;
      sub.addListener("appear", async () => {
        if (loaded) {
          return;
        }
        loaded = true;
        let list;
        try {
          list = await this.__accounts(devices[0]);
        } catch (e) {
          sub.removeAll().forEach(w => w.dispose());
          info("Hesaplar alınamadı: " + (e.message || e));
          loaded = false; // bir sonraki açılışta yeniden denensin
          return;
        }
        sub.removeAll().forEach(w => w.dispose());
        if (!list.length) {
          info("Cihazda kullanıcı hesabı yok");
          return;
        }
        if (devices.length > 1) {
          info(`Liste: ${devices[0].label || devices[0].hostname || devices[0].ip} · ${devices.length} cihazda ${verb}`);
        }
        list.forEach(acc => {
          const label = acc.full_name && acc.full_name !== acc.name ? `${acc.full_name} (${acc.name})` : acc.name;
          const btn = new qx.ui.menu.Button(label);
          btn.addListener("execute", () => onPick(acc, label));
          sub.add(btn);
        });
      });
      return sub;
    },

    /** Hesap listesi: tarayıcı önbelleği → yoksa "accounts" görevi (sonucunu bekler). */
    async __accounts(device) {
      const hit = this.__accountsCache[device.id];
      if (hit && Date.now() - hit.at < this.ACCOUNTS_TTL_MS) {
        return hit.list;
      }
      const jobId = (await ankamon.io.Api.post("/jobs", { type: "accounts", device_ids: [device.id] })).id;
      for (let i = 0; i < 60; i++) {
        const res = await ankamon.io.Api.get(`/jobs/${jobId}`);
        const t = ((res.job && res.job.targets) || [])[0];
        if (t && !["queued", "running"].includes(t.status)) {
          if (t.status !== "ok") {
            throw new Error(t.output || "cihaza bağlanılamadı");
          }
          const list = JSON.parse(t.output || "[]");
          this.__accountsCache[device.id] = { at: Date.now(), list };
          return list;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      throw new Error("zaman aşımı");
    },

    /** Cihazın hesap listesi (önbellekli — bkz. __accounts); Yedekle/Geri al penceresi de kullanır. */
    accountsOf(device) {
      return this.__accounts(device);
    },

    /** Cihazların hesap listesi önbelleğini düşürür (hesap eklenip silinince). */
    forgetAccounts(devices) {
      devices.forEach(b => delete this.__accountsCache[b.id]);
    },

    async __login(devices, acc, label, sessionOps) {
      const esc = qx.bom.String.escape;
      const where = devices.length > 1 ? `<b>${devices.length} cihazda</b>` : `<b>${esc(devices[0].label || devices[0].hostname || devices[0].ip)}</b> cihazında`;
      const ok = await ankamon.ui.Dialog.confirm(
        `${where} <b>${esc(label)}</b> hesabıyla oturum açılsın mı?<br><br>` +
        "Cihazda açık bir oturum varsa <b>kullanıcı değiştirilir</b>: mevcut oturum kapanmaz, programları arka planda çalışmaya devam eder.",
        "Oturum aç");
      if (!ok) {
        return;
      }
      if (sessionOps) {
        sessionOps.login(devices, acc);
      } else {
        this.__job({ type: "login", username: acc.name, device_ids: devices.map(b => b.id) }, `Oturum aç — ${label}`);
      }
    },

    /**
     * "Oturumu kapat" / "Oturumu kilitle" (bkz. worker executor/accounts.py logout/lock). Kilitlemede
     * oturum ve süreçleri açık kalır, cihaz giriş ekranına (greeter) geçer.
     * @param type {String} "logout" | "lock"
     * @param sessionOps {Map?} Ekranlar önizlemesinden: iş penceresi açmadan kutucuklarda gösterilir
     * @param username {String?} belirli kullanıcının oturumu (Oturumlar grid'i); yoksa cihazdaki etkin oturum
     */
    async sessionAction(type, devices, sessionOps = null, username = null) {
      if (!devices.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const lock = type === "lock";
      const title = lock ? "Oturumu kilitle" : "Oturumu kapat";
      const owner = username ? `<b>${esc(username)}</b> kullanıcısının oturumu` : "açık oturum";
      const where = devices.length > 1 ? `<b>${devices.length} cihazdaki</b> açık oturumlar` : `<b>${esc(devices[0].label || devices[0].hostname || devices[0].ip)}</b> cihazındaki ${owner}`;
      const ok = await ankamon.ui.Dialog.confirm(lock
        ? `${where} kilitlensin mi?<br><br>Oturum kapanmaz, açık programlar çalışmaya devam eder; cihaz giriş ekranına geçer ve kilidi açmak için kullanıcının parolası gerekir.`
        : `${where} kapatılsın mı?<br><br>Kaydedilmemiş işler kaybolur; cihaz giriş ekranına döner.`, title);
      if (!ok) {
        return;
      }
      if (sessionOps) {
        sessionOps[type](devices);
      } else {
        const body = { type, device_ids: devices.map(b => b.id) };
        if (username) {
          body.username = username;
        }
        this.__job(body, username ? `${title} — ${username}` : title);
      }
    }
  }
});
