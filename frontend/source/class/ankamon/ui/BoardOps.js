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
 * Tahta işlemleri (tek ya da çoklu): web terminal, kapatma, uyandırma (WoL), hazır işlem + serbest komut
 * (run — tek pencerede birleşik). Hem Tahtalar grid'i hem de sol ağaçtaki sağ menüler buradan çağırır.
 * Her işlem yetki ister; kullanıcıda yoksa düğme/menü zaten eklenmez, sunucu da ayrıca denetler.
 */
qx.Class.define("ankamon.ui.BoardOps", {
  type: "static",

  statics: {
    /** Tahtada açılışta parola sıfırlama servisi uyarısı: parola kutusunun yanındaki kısa not ve ipucu. */
    BOOT_WIPE_NOTE: "⚠ Açılışta sıfırlanabilir",
    BOOT_WIPE_HINT: "Tahtada açılışta parola sıfırlama servisi etkinse etapadmin dışındaki hesapların parolası her açılışta " +
      "rastgele bir değerle değişir: bu parola yalnız bir sonraki açılışa kadar geçerli olur, sonrasında giriş EBA-QR, PIN " +
      "ya da USB ile yapılır. Servis tahtada etkinse işlem çıktısı da bunu söyler.",

    /** Tahtanın ekranı güç tasarrufunda mı (uykuda; bkz. 025_board_display_state.sql). */
    isScreenAsleep(board) {
      return !!board.online && ["Off", "Standby", "Suspend"].includes(board.display_state);
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
    __terminalWindow(caption, url) {
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
      win.add(bar);
      win.add(frame, { flex: 1 });
      win.addListener("close", () => {
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

    /** @param board {Map} en az {id, label|hostname|ip} */
    async webshell(board) {
      try {
        const c = await ankamon.io.Api.get("/boards/" + board.id + "/shell");
        const name = board.label || board.hostname || board.ip;
        const url = "/webshell/?hostname=" + encodeURIComponent(c.hostname) +
          "&port=" + c.port + "&username=" + encodeURIComponent(c.username) +
          "&password=" + encodeURIComponent(c.password) + "&title=" + encodeURIComponent(name);
        this.__terminalWindow("Web terminal — " + name, url);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    /**
     * Dosya yöneticisini (FileBrowser Quantum, SFTP, root) uygulama içinde büyük bir pencerede
     * açar (yeni sekme yerine — bkz. screen() ile aynı iframe/Window deseni). Açılış köprüsü
     * (/filemanager-open/) önce tahtayı bu makineye bağlar (sshfs), sonra gezinmeye başlar.
     * @param board {Map} en az {id, label|hostname|ip}
     */
    async filemanager(board) {
      let c;
      try {
        c = await ankamon.io.Api.get("/boards/" + board.id + "/filemanager");
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const name = board.label || board.hostname || board.ip;
      // Kimlik bilgisi URL'ye konmaz (API de döndürmez): bağlama köprüsü onu kendisi okur.
      const url = "/filemanager-open/?board=" + c.board +
        "&hostname=" + encodeURIComponent(c.hostname) + "&title=" + encodeURIComponent(name);

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
     * Tahtanın canlı ekranını (salt izleme) yeniden boyutlanabilir, büyütülebilir bir pencerede gösterir;
     * pencere içindeki sayfa ayrıca tarayıcı tam ekranına geçebilir. Birden fazla tahta verilirse aynı
     * pencerede düşük kaliteli önizleme kutucukları (q=thumb) açılır. Görüntü /screen/ sayfasından
     * (noVNC) gelir; tahta listesi URL fragmanında taşınır. Pencere kapanınca akış(lar) ve tahtadaki
     * x11vnc biter.
     * Kullanıcının "screen.control" yetkisi varsa sayfada "🖱 Müdahale" düğmesi çıkar (fare/klavye ile
     * yönetim); sunucu (ekran köprüsü) bu yetkiyi ayrıca oturumdan denetler.
     * @param boards {Array} [{id, label|hostname|ip}]
     * @param user {Map?} oturum sahibi
     * @param manage {Boolean?} "Ekranı yönet" kipi (tek tahta)
     * Tek tahtalık pencere tahta başına BİR tane açılır (kullanıcı isteği): aynı tahtanın penceresi zaten
     * açıksa yenisi açılmaz, o öne getirilir ("Ekranı yönet" istenmişse izleme penceresi yönetim kipiyle
     * değiştirilir). Açık pencereler SCREEN_WINDOWS iletisiyle duyurulur — Ekranlar sekmesi o tahtanın
     * önizlemesini durdurup "Ayrı pencerede izleniyor" yazar (bkz. Boards.js, screen/index.html "tm-popped").
     */
    screen(boards, user, manage = false) {
      const list = boards.map(b => ({ id: b.id, name: b.label || b.hostname || b.ip || "#" + b.id, locks: b.input_locks || [] }));
      if (!list.length) {
        return;
      }
      const control = !!user && (user.is_admin || user.features.includes("screen.control"));
      // manage ("Ekranı yönet"): tek tahta, sayfa doğrudan müdahale (fare/klavye) kipinde açılır.
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
        open.win.close(); // izleme → yönetim: aynı tahtaya iki akış açık kalmasın
      }
      // input: başlıktaki klavye ve fare/dokunmatik kilidi düğmeleri. chat: sohbeti açık tahtalar yüksek çözünürlükte akar.
      const input = !!user && (user.is_admin || user.features.includes("screen.input"));
      const spec = { boards: list, q: list.length > 1 ? "thumb" : "view", control, manage, input, chat: ankamon.ui.chat.Window.openIds() };
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
      const caption = list.length > 1 ? `Ekranlar (${list.length} tahta)`
        : (manage ? "Ekran yönetimi — " : "Ekran — ") + list[0].name;

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
        frame.setSource("about:blank"); // WebSocket'ler hemen kapansın (tahtadaki x11vnc de biter)
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
        this.__screenWins.set(single, { win, manage, frame });
        this.__announceScreenWindows();
      }
    },

    /** Tahta kimliği → {win, manage}: açık tek tahtalık ekran pencereleri (bkz. screen). */
    __screenWins: new Map(),

    /** Message Bus konusu: açık ekran pencerelerinin tahta kimlikleri (veri: Array). */
    SCREEN_WINDOWS: "ankamon.screenWindows",

    /** Ekran penceresi şu an açık olan tahtaların kimlikleri. */
    screenWindowIds() {
      return [...this.__screenWins.keys()];
    },

    __announceScreenWindows() {
      qx.event.message.Bus.dispatchByName(this.SCREEN_WINDOWS, this.screenWindowIds());
    },

    /** Kapanan ekran pencerelerinin son kareleri: tahta id → JPEG veri adresi. */
    __lastFrames: new Map(),

    /** Bekleyen son kareleri verir ve unutur (bkz. page.Boards.__pushPopped). */
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

    /** Tahta listesi tazelendi: açık ekran pencerelerindeki kilit düğmeleri güncel duruma gelsin. */
    syncScreenLocks(boards) {
      this.__screenWins.forEach((open, id) => {
        const board = boards.find(b => b.id === id);
        const target = open.frame.getWindow();
        if (board && target) {
          target.postMessage({ type: "tm-locks", id, locks: board.input_locks || [] }, location.origin);
        }
      });
    },

    /**
     * Ekran penceresi başlığındaki kilit düğmesi: iş penceresi açılmaz, düğme işin sonucunu gösterir. Fare kilidi dokunmayı da
     * tuttuğundan (bkz. worker executor/inputlock.py) düğme ikisini birlikte temsil eder: açarken ayrı dokunmatik kilidi de kalkar.
     */
    async __toggleInputLock(id, device, lock, locks, frame) {
      const devices = !lock && device === "mouse" && locks.includes("touch") ? ["mouse", "touch"] : [device];
      // İş bitti denince tahta listesi henüz eski olabilir: başarılı işin sonucu bilinen durumdur, listeden okunmaz.
      let result = null;
      try {
        for (const dev of devices) {
          const jobId = (await ankamon.io.Api.post("/jobs", { type: "input_lock", device: dev, lock, board_ids: [id] })).id;
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
        result = lock ? [...new Set(locks.concat([device]))] : locks.filter(d => !devices.includes(d));
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        // Başarısız: hangi durumda kaldığı tahta listesinden okunur; okunamazsa eski durum gösterilir.
        result = await ankamon.io.Api.get("/boards").then(res => {
          const board = res.boards.find(b => b.id === id);
          return board ? board.input_locks || [] : locks;
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
     * "Bilgi kartı": seçili tahta(lar)ın donanım ve durum bilgisini (sistem, işlemci, bellek, disk ve
     * boş alan, disk/bölüm GUID'leri, kablolu ağ, Wi-Fi kartı ve bağlantı durumu, ekran, BIOS, UEFI açılış
     * girdileri ve tüm UEFI değişkenleri — bkz. ui.FactsView) gösterir.
     * Worker tahtaya SSH ile canlı bağlanıp toplar; aynı tahtaya 60 dakika içinde tekrar bağlanmaz,
     * son toplanan değeri döner (bkz. backend "facts" görev türü, worker/ankamon/executor/hwfacts.py
     * CACHE_SECONDS). Birden fazla tahta seçiliyse hepsi aynı pencerede listelenir; "Yazdır" ayrı bir
     * sekmede tahta başına bir kartlık yazdırılabilir sayfa açar.
     * @param boards {Array} [{id, label|hostname|ip}]
     */
    async infoCard(boards) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        return;
      }
      const name = b => b.label || b.hostname || b.ip || ("#" + b.id);
      // Kart başlığındaki kimlik (kod adı, MAC…) için tahta kaydı: Tahtalar sayfası tam satırı verir, başka
      // girişler (ör. Bakım ▸ Ahenk) yalnız id/ad verebilir — MAC'i eksikse liste bir kez okunur.
      const boardById = new Map(boards.map(b => [b.id, b]));
      if (boards.some(b => !b.mac)) {
        ankamon.io.Api.get("/boards").then(res => {
          (Array.isArray(res) ? res : (res.boards || [])).forEach(b => {
            if (boardById.has(b.id)) {
              boardById.set(b.id, Object.assign({}, b, boardById.get(b.id), { mac: b.mac }));
            }
          });
          if (!stop) {
            render();
          }
        }, () => {});
      }
      const caption = boards.length > 1 ? `Bilgi kartı (${boards.length} tahta)` : "Bilgi kartı — " + name(boards[0]);
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
          card.add(new qx.ui.basic.Label(qx.bom.String.escape(t.board)).set({ font: "bold" }));
          card.add(new qx.ui.basic.Label(this.__infoCardIdentity(boardById.get(t.board_id), facts))
            .set({ rich: true, selectable: true, textColor: "app-muted" }));
          if (facts) {
            card.add(new qx.ui.basic.Label(ankamon.ui.FactsView.html(facts, sensors.get(t.board_id))).set({ rich: true, selectable: true, allowGrowX: true }));
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
      printBtn.addListener("execute", () => this.__printInfoCard(targets, sensors, boardById));
      win.open();

      try {
        jobId = (await ankamon.io.Api.post("/jobs", { type: "facts", board_ids: ids })).id;
      } catch (e) {
        status.setValue("");
        ankamon.ui.Dialog.error(e);
        return;
      }
      tick();
    },

    /**
     * Bilgi kartı başlığındaki tahta kimliği: kod adı (takma ad), bilgisayar adı, MAC, IP, mimari, işlemci.
     * @param board {Map|undefined} tahta kaydı (label, hostname, mac, ip)
     * @param facts {Map|null} facts (arch, cpu_model)
     * @return {String} kaçırılmış HTML
     */
    __infoCardIdentity(board, facts) {
      const esc = qx.bom.String.escape;
      const b = board || {};
      const f = facts || {};
      return [["Kod adı", b.label], ["Bilgisayar adı", b.hostname], ["MAC", b.mac], ["IP", b.ip],
        ["Mimari", f.arch], ["İşlemci", f.cpu_model]]
        .filter(pair => pair[1])
        .map(([k, v]) => `${esc(k)}: <b>${esc(String(v))}</b>`)
        .join(" &nbsp;·&nbsp; ");
    },

    /** "Bilgi kartı" penceresindeki "Yazdır": qx pencere ağacı yerine YENİ, sade bir sekmede
     * yazdırılabilir sayfa açar — qx'in mutlak konumlu kutuları tarayıcı yazdırmasında güvenilmez
     * kırpılıyor (bkz. diğer özel görünümler: /screen/, /webshell/ — aynı "ayrı sade sayfa" deseni).
     * Her tahta yeni sayfadan başlar ve başlığında hangi tahta olduğu yazar. Kart sayfadan uzun olduğundan
     * bölünmesine izin verilir (eskiden "bölünmesin" kuralı kartı ikinci sayfaya itip ilk sayfayı boş
     * bırakıyordu); yalnız tablo satırları ve bölüm başlıkları sayfa sınırında bölünmez. */
    __printInfoCard(targets, sensors, boardById = new Map()) {
      const esc = qx.bom.String.escape;
      const when = esc(new Date().toLocaleString("tr-TR"));
      const cards = targets.map(t => {
        const facts = this.__parseFacts(t);
        const board = boardById.get(t.board_id) || {};
        return `<section class="card"><h1>Tahta bilgi kartı — ${esc(board.label || t.board)}</h1>` +
          `<div class="id">${this.__infoCardIdentity(board, facts)}</div><div class="when">${when}</div>` +
          (facts ? ankamon.ui.FactsView.html(facts, sensors.get(t.board_id)) : `<p>${esc(t.output || "Okunamadı")}</p>`) +
          "</section>";
      }).join("");
      const title = targets.length === 1 ? `Bilgi kartı — ${esc((boardById.get(targets[0].board_id) || {}).label || targets[0].board)}`
        : `Bilgi kartı (${targets.length} tahta)`;
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
     * "Ekranımı yansıt": bu bilgisayarın ekranını seçili (çevrimiçi) tahtalarda tam ekran gösterir.
     * Yayın sayfası (/cast/) AYRI bir tarayıcı penceresinde açılır: yayın sürerken Ankamon'da çalışmaya
     * devam edilebilir, pencereyi kapatmak yansıtmayı bitirir. Ekran yakalama HTTPS ister (nginx HTTP'yi
     * zaten HTTPS'e yönlendirir). Ayrıntı: docker/rootfs/cast/index.html, worker executor/cast.py.
     */
    cast(boards, preset = null) {
      const list = boards.map(b => ({ id: b.id, name: b.label || b.hostname || b.ip || "#" + b.id, online: !!b.online }));
      if (!list.length) {
        ankamon.ui.Dialog.alert("Önce bir ya da daha fazla tahta işaretleyin.");
        return;
      }
      // preset {quality, audio}: sağ menüden seçilen ayarlar — sayfa ayar sormaz (bkz. cast/index.html).
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(Object.assign({ boards: list }, preset || {})))));
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
    __castMenu(boards) {
      const m = new qx.ui.menu.Menu();
      if (!boards.length) {
        m.add(new qx.ui.menu.Button("Çevrimiçi tahta yok").set({ enabled: false }));
        return m;
      }
      this.CAST_QUALITIES.forEach(([quality, label]) => {
        const btn = new qx.ui.menu.Button(label);
        btn.addListener("execute", () => this.cast(boards, { quality, audio: this.__castAudio }));
        m.add(btn);
      });
      m.add(new qx.ui.menu.Separator());
      const audio = new qx.ui.menu.CheckBox("Ses").set({ value: this.__castAudio });
      audio.addListener("changeValue", e => { this.__castAudio = e.getData(); });
      m.add(audio);
      return m;
    },

    /**
     * Seçili tahtaları kapatır (SSH ile). Birden fazlaysa önce onay alır (onay her zaman sorulur; "bir
     * daha gösterme" yalnız çıktı penceresi içindir — bkz. __powerJob).
     * @param user {Map?} oturum sahibi (pencere gizleme tercihi)
     */
    async shutdown(boards, user) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        return;
      }
      if (ids.length > 1) {
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${ids.length} tahta</b> kapatılsın mı? Her biri SSH ile tek tek kapatılacak.`, "Kapat");
        if (!ok) {
          return;
        }
      }
      this.__powerJob({ type: "action", action: "shutdown", board_ids: ids }, "Kapatma çıktısı", "shutdown", "kapatma", user);
    },

    /** Seçili tahtaları yeniden başlatır (hazır işlem "reboot"). Birden fazlaysa önce onay alır. @param user {Map?} */
    async reboot(boards, user) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        return;
      }
      if (ids.length > 1) {
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${ids.length} tahta</b> yeniden başlatılsın mı? Açık oturumlar kapanır.`, "Yeniden başlat");
        if (!ok) {
          return;
        }
      }
      this.__powerJob({ type: "action", action: "reboot", board_ids: ids }, "Yeniden başlatma çıktısı", "reboot",
        "yeniden başlatma", user);
    },

    // "Bu pencereyi bir daha gösterme" (kullanıcı isteği) bu kadar süre geçerli; sonra pencere yeniden
    // görünür ve kutu işaretsiz gelir. Bitiş anı kullanıcı başına sunucuda, işlem başına ayrı:
    // users.ui_prefs["<wol|shutdown|reboot>.hideUntil"].
    POWER_HIDE_MS: 7 * 24 * 3600 * 1000,

    /**
     * Seçili (kapalı) tahtaları ağdan uyandırır (WoL). Pencere gizlenmişse (bkz. POWER_HIDE_MS) uyandırma
     * yine yapılır, yalnız çıktı penceresi açılmaz — başlatma hatası ise her durumda gösterilir.
     * @param user {Map?} oturum sahibi (pencere gizleme tercihi okunur/yazılır)
     */
    wol(boards, user) {
      const ids = boards.map(b => b.id);
      if (ids.length) {
        this.__powerJob({ type: "wol", board_ids: ids }, "Uyandırma (WoL)", "wol", "uyandırma", user, { intro: this.WOL_INTRO });
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

    __powerJob(body, caption, kind, verb, user, opts = {}) {
      const job = ankamon.io.Api.post("/jobs", body).then(res => res.id);
      const key = kind + ".hideUntil";
      const prefs = user ? user.ui_prefs || (user.ui_prefs = {}) : {};
      if ((prefs[key] || 0) > Date.now()) {
        job.catch(e => ankamon.ui.Dialog.error(e));
        return;
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
    },

    // Uyandırma penceresinin çıktı kutusunun başındaki sabit açıklama (bkz. ui.Jobs opts.intro):
    // "paket gönderildi" görünse de tahtanın neden açılmayabileceği ve TiHA'nın WoL ön koşulları.
    // Kaynak: TiHA sihirbazının "Wake-on-LAN" adımı (m15, tiha-wake-on-lan.service) — bkz.
    // https://github.com/enseitankado/tiha
    WOL_INTRO: [
      "UYANDIRMA (Wake-on-LAN) HAKKINDA",
      "",
      "Ankamon, tahtanın ağ kartına \"sihirli paket\" gönderir. Aşağıda \"gönderildi\" yazması paketin ağa",
      "çıktığını gösterir; tahtanın açılacağını garanti etmez. Tahta açılmazsa nedeni çoğunlukla tahtadadır:",
      "",
      "• Tahta düzgün kapatılmadıysa uyanmaz. Elektrik kesilmesi, güç düğmesine uzun basılması ya da",
      "  donma gibi ANİ kapanışlarda ağ kartı uyandırmaya hazırlanmaz ya da kartta bekleme gücü kalmaz;",
      "  sihirli paket ulaşsa bile tahta açılmaz. Böyle bir tahtayı bir kez elle açın; bundan sonra",
      "  Ankamon'dan \"Bilgisayarı kapat\" ile ya da tahtanın kendi menüsünden kapatılınca yeniden uyandırılabilir.",
      "• Tahtanın prizi, uzatma kablosu ya da sınıf sigortası kapalıysa uyanmaz (bekleme gücü yok).",
      "",
      "ÖN KOŞULLAR — TiHA sihirbazının \"Wake-on-LAN\" adımı (github.com/enseitankado/tiha):",
      "• TiHA'da bu adım uygulanmış olmalı: tahtaya tiha-wake-on-lan.service kurulur ve her açılışta",
      "  ağ kartında uyandırmayı açar (ethtool -s <arayüz> wol g).",
      "• Tahtanın BIOS'unda \"Wake on LAN\" AÇIK; \"ErP\" / \"Deep Sleep\" (derin uyku) KAPALI olmalı.",
      "• Tahta ile Ankamon sunucusu AYNI ağda (aynı VLAN / yayın alanında) olmalı; sihirli paket bir",
      "  yayındır, yönlendiriciden (router) öteye geçmez.",
      "• Tahtanın MAC adresi Ankamon'da kayıtlı olmalı (tahta bir kez açık görülünce kendiliğinden kaydedilir)."
    ].join("\n"),

    /**
     * Birden fazla tahtanın web terminalini, uygulama içinde tek pencerede yan yana panolar
     * hâlinde açar (bkz. /multishell/ — toplu komut yazma üstten yapılır). Her panonun bağlantı
     * bilgisi (host/kullanıcı/parola) ayrı ayrı /shell ucundan alınır (tek tahtadaki ile aynı uç,
     * aynı komut loguna işlenir), tarayıcıya hiç sunucuya gitmeyen URL fragmanıyla (#...) taşınır.
     */
    async webshellMulti(boards) {
      if (boards.length < 2) {
        if (boards.length === 1) {
          this.webshell(boards[0]);
        }
        return;
      }
      let panes;
      try {
        panes = await Promise.all(boards.map(async board => {
          const c = await ankamon.io.Api.get("/boards/" + board.id + "/shell");
          return { ...c, title: board.label || board.hostname || board.ip };
        }));
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(panes))));
      this.__terminalWindow(`Web terminal (${boards.length} tahta)`, "/multishell/#" + hash);
    },

    /**
     * Tek tahta için sağ menü (ağaçtaki tahta düğümü ve Tahtalar grid'indeki satır ortak kullanır).
     * Çevrimiçiyse: Web terminal, Komut çalıştır, …, Bilgisayarı aç/kapat. Çevrimdışıysa: yalnız
     * Bilgisayarı aç/kapat (kapat devre dışı).
     * @param boards {Array?} grid'de o satır işaretli ÇOKLU seçimin bir parçasıysa Web terminal
     *   (webshellMulti), Ekranı göster (screen — aynı pencerede önizleme kutucukları), Komut çalıştır,
     *   Bilgisayarı kapat ve Bilgisayarı aç (WoL) seçili TÜM tahtalara uygulanır; verilmezse/tek elemanlıysa
     *   yalnız bu tek tahtaya. Dosya yöneticisi (sshfs bağlama, tek seferde tek kök) doğası gereği tekildir.
     * @param sessionOps {Map?} Ekranlar önizlemesinden açılınca verilir: {login(boards, acc), logout(boards)}
     *   — "Oturum aç"/"Oturumu kapat" onaydan sonra iş penceresi AÇMADAN bunlara devredilir; durum
     *   kutucukların sol altında gösterilir (bkz. page.Boards __sessionJob). Verilmezse (grid satırı)
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
      // Araç çubuğu maddeyi bu anahtarla tanır (etiket, tahta sayısı eki olmadan — bkz. ui.boards.ActionBar).
      btn.setUserData("ankamon.menuKey", label.replace(/ \(\d+( tahta)?\)$/, ""));
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
     * menu()'nün dışında kalan iki ortak madde (Tahtalar sağ menüsünde Düzenle/Sil'in üstünde, Bakım ▸ Ahenk'te
     * de): Logları göster (Loglar sayfasını bu tahtaya süzülmüş açar — bkz. ui.Shell.OPEN_LOGS) ve hemen altında
     * Bilgi kartı (kullanıcı isteği; yalnız çevrimiçi tahtada). Yetkiye göre boş dizi dönebilir.
     */
    logsAndInfo(board, user, boards = [board]) {
      const can = feature => user.is_admin || user.features.includes(feature);
      const ICON = ankamon.ui.Shell.ICON;
      const items = [];
      if (can("logs")) {
        items.push(this.menuButton(ICON.logs, "Logları göster", () =>
          qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_LOGS, board.id)));
      }
      if (board.online && (can("boards") || can("screen"))) {
        const count = boards.length > 1 ? ` (${boards.length} tahta)` : "";
        items.push(this.menuButton(ICON.info, "Bilgi kartı" + count, () => this.infoCard(boards)));
      }
      return items;
    },

    /** Devre dışı sağ menü maddelerinin opaklığı (bkz. menuButton). */
    DISABLED_OPACITY: 0.38,

    menu(board, user, boards = [board], sessionOps = null) {
      const can = feature => user.is_admin || user.features.includes(feature);
      const menu = new qx.ui.menu.Menu();
      // Menü simgeleri resim değil, metne eklenen Unicode karakterdir — bkz. ankamon.ui.Shell.ICON
      // başındaki not (background-image tabanlı simgeler bu derlenmiş build'de güvenilmez).
      const ICON = ankamon.ui.Shell.ICON;
      const add = (icon, label, handler) => menu.add(this.menuButton(icon, label, handler));
      // Çoklu seçimde toplu uygulanan maddelerin etiketinde tahta sayısı görünür.
      const count = boards.length > 1 ? ` (${boards.length} tahta)` : "";
      // Alt menü yardımcıları: madde yoksa grup hiç eklenmez (yetkiye göre boş alt menü görünmesin).
      const sub = () => new qx.ui.menu.Menu();
      const subAdd = (target, icon, label, handler) => target.add(this.menuButton(icon, label, handler));
      // Tahtanın durumuna bağlı madde (Uyut, Kilitle, Kilidi aç): yalnız uygun tahtalara uygulanır; uygun tahta
      // yoksa (ör. zaten uykuda) görünür ama devre dışıdır.
      const stateAdd = (target, icon, label, list, handler) => {
        const button = this.menuButton(icon, label, () => handler(list));
        button.setEnabled(list.length > 0);
        target.add(button);
      };
      // Bilgisayarı aç (WoL) + Bilgisayarı kapat: her zaman yan yana (kullanıcı isteği), çevrimiçi/
      // çevrimdışı tahtada da. Her biri seçimin yalnız uygun kısmına uygulanır (aç → kapalı olanlar,
      // kapat → açık olanlar); uygulanacak tahta yoksa madde görünür ama devre dışıdır.
      // "Kullanıcılar" ▸ Oturum geçmişi (kullanıcı isteği): Oturumlar sayfası o tahtaya süzülmüş açılır
      // (bkz. page.Sessions.openWith, ui.sessions.List.showBoard). Tek tahta: sağ tıklanan. Sayfa 'logs' ister.
      const sessionHistory = target => {
        if (can("logs")) {
          const name = board.label || board.hostname || board.ip || "#" + board.id;
          subAdd(target, ICON.sessions, "Oturum geçmişi", () => qx.event.message.Bus.dispatchByName(
            ankamon.ui.Shell.OPEN_PAGE, { page: "sessions", board: { id: board.id, name } }));
        }
      };
      const power = () => {
        if (!can("power")) {
          return;
        }
        const off = boards.filter(b => !b.online);
        const on = boards.filter(b => b.online);
        const n = list => (list.length > 1 ? ` (${list.length} tahta)` : "");
        add(ICON.wol, "Bilgisayarı aç (WoL)" + n(off), () => this.wol(off, user));
        menu.getChildren()[menu.getChildren().length - 1].setEnabled(off.length > 0);
        add(ICON.shutdown, "Bilgisayarı kapat" + n(on), () => this.shutdown(on, user));
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
      if (board.online) {
        const online = boards.filter(b => b.online);
        // Komut çalıştır ▸ Hazır / Serbest komut çalıştır, Web terminal (kullanıcı isteği: sıra ve etiket bu).
        const commands = sub();
        if (can("actions") || can("shell")) {
          subAdd(commands, ICON.run, "Hazır / Serbest komut çalıştır" + count, () => this.run(boards, user));
        }
        if (can("shell")) {
          subAdd(commands, ICON.webshell, "Web terminal" + count, () =>
            boards.length > 1 ? this.webshellMulti(boards) : this.webshell(board));
        }
        group(ICON.run, "Komut çalıştır" + count, commands);

        // Yönet ▸ Ekranı göster, Bilgisayarı yönet, Uyandır, Uyut, Kilitle, Kilidi aç, giriş kilitleri, Web Filtre ▸ …
        // Ekran ▸ Ekranımı yansıt ▸ <kalite> + Ses, Ekran görüntüsü al, Ekranı başka bilgisayara aktar…, Ekran aktarımını
        // durdur (kullanıcı isteği, 2026-11-05: eski "Ekran" grubu "Yönet" oldu, görüntü iletimi ayrı "Ekran" grubunda).
        // Araç çubuğu (ui.boards.ActionBar) aynı maddeleri kendi düğmelerine dağıtır — değişiklik orada da gözden geçirilir.
        const screens = sub();
        const display = sub();
        if (can("screen")) {
          subAdd(screens, ICON.screen, "Ekranı göster" + count, () => this.screen(boards, user));
        }
        if (can("screen") && can("screen.control")) {
          // Fare/klavye ile müdahale tek tahtada anlamlı: çoklu seçimde de yalnız sağ tıklanan tahta.
          subAdd(screens, ICON.screenControl, "Bilgisayarı yönet", () => this.screen([board], user, true));
        }
        // Uyandır: güç tasarrufuna girmiş (önizlemede siyah) ekranı uyandırır — çoklu seçimde tüm açık
        // tahtalar (bkz. worker executor/display.py). Ekranlar önizlemesinde iş penceresi açılmaz.
        if (can("screen")) {
          subAdd(screens, ICON.wakeScreen, "Uyandır" + count, () => (sessionOps && sessionOps.wake
            ? sessionOps.wake(online)
            : this.__job({ type: "wake", board_ids: online.map(b => b.id) }, "Ekranı uyandır")));
          // Uyut: ekranı güç tasarrufuna sokar (DPMS kapalı; tahtaya dokunulunca açılır).
          stateAdd(screens, ICON.sleepScreen, "Uyut" + count, online.filter(b => !this.isScreenAsleep(b)), list => (sessionOps && sessionOps.sleep
            ? sessionOps.sleep(list)
            : this.__job({ type: "sleep", board_ids: list.map(b => b.id) }, "Ekranı uyut")));
        }
        // Kilitle: "Kilidi aç"a dek tahtada tam ekran "Kilitli"; klavye, fare ve dokunmatik çalışmaz, yeniden
        // açılışta da sürer (bkz. worker executor/screenlock.py). Oturumu kilitle'den (parolayla açılır) ayrı.
        if (can("screen.lock")) {
          // Kapat/yeniden başlat gibi çıktı penceresinin altında "Bu pencereyi bir daha gösterme" kutusu
          // (kullanıcı isteği; __powerJob ile — kutu işaretliyse kilitleme yine yapılır, pencere açılmaz).
          // Durumu bilinmeyen tahta (screen_locked gelmeyen çağıran) iki maddede de sayılır.
          stateAdd(screens, ICON.screenLock, "Kilitle" + count, online.filter(b => b.screen_locked !== true), list => (sessionOps && sessionOps.screenLock
            ? sessionOps.screenLock(list, true)
            : this.__powerJob({ type: "screen_lock", board_ids: list.map(b => b.id) }, "Ekranı kilitle",
                "screen_lock", "kilitleme", user)));
          stateAdd(screens, ICON.screenUnlock, "Kilidi aç" + count, online.filter(b => b.screen_locked !== false), list => (sessionOps && sessionOps.screenLock
            ? sessionOps.screenLock(list, false)
            : this.__job({ type: "screen_unlock", board_ids: list.map(b => b.id) }, "Ekran kilidini aç")));
        }
        if (can("cast")) {
          display.add(this.menuButton(ICON.cast, "Ekranımı yansıt" + count, null, this.__castMenu(online)));
        }
        // Ekran görüntüsü: Oturumlar ▸ Zaman çizelgesi'nde işaret olarak görünür (bkz. worker executor/screenshot.py).
        if (can("screen.screenshot")) {
          subAdd(display, ICON.screenshot, "Ekran görüntüsü al" + count, () => this.__powerJob(
            { type: "screenshot", board_ids: online.map(b => b.id) }, "Ekran görüntüsü", "screenshot", "görüntü alma", user));
        }
        // Ekran aktarımı: sağ tıklanan tahtanın ekranı başka tahtalarda (bkz. ui.boards.RelayDialog, executor/relay.py).
        if (can("screen.relay")) {
          subAdd(display, ICON.relay, "Ekranı başka bilgisayara aktar…", () => ankamon.ui.boards.RelayDialog.open(board, online, user));
          stateAdd(display, ICON.relayStop, "Ekran aktarımını durdur", online.filter(b => b.relay_source || b.relay_is_source || b.relay_source === undefined),
            list => this.__powerJob({ type: "relay_stop", board_ids: list.map(b => b.id) }, "Ekran aktarımını durdur", "relay_stop", "durdurma", user));
        }
        // Klavye/fare/dokunmatik kilidi: seçili tahtaların yalnız uygun olanlarına (bkz. worker executor/inputlock.py). Klavye
        // kilidi ekran klavyesini, fare kilidi dokunmayı da kapatır. Durumu bilinmeyen tahta iki maddede de sayılır.
        if (can("screen.input")) {
          const locks = b => b.input_locks || [];
          const known = b => b.input_locks !== undefined;
          // Fare kilidi dokunmayı da tuttuğundan dokunmatik "kilitli" sayılır; kendi kilidi yoksa açılacak bir şey de yoktur.
          const held = (b, d) => locks(b).includes(d) || (d === "touch" && locks(b).includes("mouse"));
          const n = list => (list.length > 1 ? ` (${list.length} tahta)` : "");
          [["keyboard", ICON.keyboard, "Klavyeyi kilitle", "Klavye kilidini aç", "Klavye kilitle"],
            ["mouse", ICON.mouse, "Fareyi kilitle", "Fare kilidini aç", "Fare kilitle"],
            ["touch", ICON.touch, "Dokunmatiği kilitle", "Dokunmatik kilidini aç", "Dokunmatik kilitle"]].forEach(([device, icon, on, off, caption]) => {
            const lockable = online.filter(b => !known(b) || !held(b, device));
            const unlockable = online.filter(b => !known(b) || locks(b).includes(device));
            stateAdd(screens, icon, on + n(lockable), lockable, list => this.__powerJob(
              { type: "input_lock", device, lock: true, board_ids: list.map(b => b.id) }, caption, "input_lock", "kilitleme", user));
            stateAdd(screens, ICON.unlockInput, off + n(unlockable), unlockable, list => this.__job(
              { type: "input_lock", device, lock: false, board_ids: list.map(b => b.id) }, off));
          });
        }
        // Yönet ▸ Web Filtre (kullanıcı isteği): ETAP Pardus'taki eta-kisit ile kara/beyaz liste ve DNS sayıları (bkz. ui.boards.EtaKisitWebFilter).
        if (can("boards.webfilter")) {
          const webFilter = ankamon.ui.boards.EtaKisitWebFilter;
          const filter = sub();
          subAdd(filter, ICON.webFilter, "Kara liste…" + count, () => webFilter.open(online, boards, "denylist"));
          subAdd(filter, ICON.webFilter, "Beyaz liste…" + count, () => webFilter.open(online, boards, "allowlist"));
          subAdd(filter, ICON.webFilter, "Filtreyi kapat" + count, () => webFilter.turnOff(online));
          subAdd(filter, ICON.info, "Durum ve sayılar…" + count, () => webFilter.open(online, boards));
          if (filter.getChildren().length) {
            screens.add(this.menuButton(ICON.webFilter, "Web Filtre", null, filter));
          }
        }
        group(ICON.screenControl, "Yönet" + count, screens);
        group(ICON.screen, "Ekran" + count, display);

        // "Bilgi kartı" burada değil: Tahtalar sayfasındaki "Logları göster"in hemen altında (kullanıcı
        // isteği) — bkz. page.Boards __rowMenu.

        // Kullanıcılar ▸ Oturum aç ▸ <hesap>, Oturumu kapat, Oturumu kilitle, Oturumları sorgula, Oturum geçmişi, Kullanıcı sil…
        const sessions = sub();
        if (can("boards.login")) {
          sessions.add(this.menuButton(ICON.sessions, "Oturum aç" + count, null,
            this.__accountMenu(online, "açılır", (acc, label) => this.__login(online, acc, label, sessionOps))));
          subAdd(sessions, ICON.logout, "Oturumu kapat" + count, () => this.sessionAction("logout", online, sessionOps));
          subAdd(sessions, ICON.lock, "Oturumu kilitle" + count, () => this.sessionAction("lock", online, sessionOps));
        }
        if (can("screen")) {
          // Ekranlar önizlemesinde sonuç kutucukların sol altında, grid'de iş penceresinde görünür; her
          // iki durumda da Tahtalar grid'inin "Oturum" sütunu güncellenir (bkz. runner whoami dalı).
          subAdd(sessions, ICON.sessions, "Oturumları sorgula" + count, () =>
            (sessionOps ? sessionOps.query(online) : this.__job({ type: "whoami", board_ids: online.map(b => b.id) }, "Oturumları sorgula")));
        }
        sessionHistory(sessions);
        if (can("logs")) {
          // Oturum hareketleri: Oturumlar ▸ Hareketler bu tahtaya süzülmüş açılır (bkz. ui.sessions.Movements).
          subAdd(sessions, ICON.movements, "Oturum hareketleri", () => qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, {
            page: "sessions", movements: { board_id: board.id, board_name: board.label || board.hostname || board.ip }
          }));
        }
        // Parola ayarla…: bir ya da birçok hesaba ortak parola; etapadmin/root ayrı bölümde, kendi
        // parolasıyla ve ayrı yetkiyle (bkz. setPasswords; işi hazır işlem "user-password" yapar).
        if (can("boards.passwords")) {
          subAdd(sessions, ICON.password, "Parola ayarla…" + count, () => this.setPasswords(online, user));
        }
        // Kullanıcı sil…: hesap(lar) seçilir, dosyaları silme varsayılan açık (bkz. deleteUsers; işi
        // hazır işlem "user-delete" yapar — Komut çalıştır listesinde de var).
        if (can("boards.users")) {
          subAdd(sessions, ICON.delete, "Kullanıcı sil…" + count, () => this.deleteUsers(online));
        }
        group(ICON.sessions, "Kullanıcılar", sessions);

        // Dosyalar ▸ Dosya yöneticisi, Bilgisayarlar arasında kopyala, Dosyaları dağıt/topla, Yedekle/Geri al (kullanıcı isteği: eski
        // "Yedekle" + "Dosya yöneticisi" tek grupta; Dosya yöneticisi ilk sırada). Bilgisayarı aç/kapat
        // çiftinin hemen üstünde.
        const files = sub();
        if (can("filemanager")) {
          subAdd(files, ICON.filemanager, "Dosya yöneticisi", () => this.filemanager(board));
          // İki panelli gezgin: bu tahtanın kullanıcı dizinlerinden başka bir tahtaya kopyalama.
          subAdd(files, ICON.copy, "Bilgisayarlar arasında kopyala", () => ankamon.ui.files.CopyWindow.open(board, user));
          // Toplu: bu bilgisayardan seçili tahtalardaki kullanıcıların bir konumuna (varsayılan Masaüstü) ve
          // tersi; tek pencerede "Dağıt" ve "Topla" sekmeleri (bkz. ui.files.BulkWindow). Tahta seçimi değiştirilebilir.
          subAdd(files, ICON.bulk, "Dosyaları dağıt/topla" + count, () => ankamon.ui.files.BulkWindow.open(online, user));
        }
        if (can("boards.backup") || can("boards.restore")) {
          files.add(this.menuButton(ICON.backup, "Yedekle/Geri al" + count, () => ankamon.ui.homebackup.Window.open(online, user)));
        }
        group(ICON.filemanager, "Dosyalar", files);
        // Görev yöneticisi (Windows'taki gibi; canlı SSH, pencere kapanınca biter — bkz. ui.taskmgr.Window):
        // "Dosyalar"ın hemen altında (kullanıcı isteği). Tek tahta: çoklu seçimde sağ tıklanan tahta için açılır.
        if (can("taskmgr")) {
          add(ICON.taskmgr, "Görev yöneticisi", () => ankamon.ui.taskmgr.Window.open(board, user));
        }
        // Web sitesi aç: seçili tahtalardan oturumu açık olanlarda varsayılan tarayıcıyla, tam ekran (bkz. worker executor/open_url.py).
        if (can("screen.web")) {
          const withSession = online.filter(b => b.session_username);
          const webCount = withSession.length > 1 ? ` (${withSession.length} tahta)` : "";
          add(ICON.web, "Web sitesi aç…" + webCount, () => this.openWebsite(withSession));
          menu.getChildren()[menu.getChildren().length - 1].setEnabled(withSession.length > 0);
        }
        // Wi-Fi Monitör: kart, bağlantı, çevredeki ağlar ve Bluetooth cihazları; kapalı radyo geçici açılır, sağ tıklanan tahta (bkz. ui.boards.WifiMonitor).
        if (can("screen")) {
          add(ICON.wifi, "Wi-Fi Monitör", () => ankamon.ui.boards.WifiMonitor.open(board));
        }
        // Sohbet: her bilgisayar için ayrı pencere; çoklu seçimde sağ tıklanan tahta (bkz. ui.chat.Window).
        if (can("boards.chat")) {
          add(ICON.chat, "Sohbet", () => ankamon.ui.chat.Window.open(board));
        }
      } else {
        // Kapalı tahtada en olası iş onu açmak: Bilgisayarı aç (WoL) ve güç seçenekleri EN ÜSTTE (kullanıcı
        // isteği). Geçmiş yine anlamlı: "Kullanıcılar" yalnız "Oturum geçmişi" ile, altında.
        power();
        const sessions = sub();
        sessionHistory(sessions);
        group(ICON.sessions, "Kullanıcılar", sessions);
      }
      if (board.online) {
        power();
      }
      return menu.getChildren().length ? menu : null;
    },

    /** Web sitesi aç: adres sorar, açık oturumlu tahtalarda iş başlatır. */
    async openWebsite(boards) {
      const raw = await ankamon.ui.Dialog.prompt(
        `<b>${boards.length} bilgisayarda</b> varsayılan tarayıcıyla, ekranı kaplayarak açılacak site:`, "https://", "Aç", "Web sitesi aç");
      let url = (raw || "").trim();
      if (!url || url === "https://") {
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
      }
      this.__job({ type: "open_url", url, board_ids: boards.map(b => b.id) }, "Web sitesi aç");
    },

    /**
     * Kullanıcılar ▸ Kullanıcı sil…: seçili (çevrimiçi) tahtalardaki hesaplar tek listede (çoklu seçimde
     * birleşik; her hesabın kaç tahtada olduğu yazılır), silinecekler işaretlenir. "Tüm dosyaları sil"
     * varsayılan açık (kullanıcı isteği). İşi hazır işlem "user-delete" yapar (bkz. actions/user-delete):
     * hesabı olmayan tahtada o kullanıcı atlanır. Sonrasında hesap listesi önbellekleri düşürülür.
     */
    async deleteUsers(boards) {
      if (!boards.length) {
        ankamon.ui.Dialog.alert("Çevrimiçi tahta yok.");
        return;
      }
      const esc = qx.bom.String.escape;
      const where = boards.length > 1 ? `${boards.length} tahta` : esc(boards[0].label || boards[0].hostname || boards[0].ip);
      const win = ankamon.ui.Dialog.window(`Kullanıcı sil — ${where}`, 480);
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

      // Hesaplar: her tahtadan (önbellekten ya da "accounts" görevinden), ada göre birleştirilir.
      const results = await Promise.allSettled(boards.map(b => this.__accounts(b)));
      const merged = new Map();
      results.forEach(r => (r.status === "fulfilled" ? r.value : []).forEach(acc => {
        const hit = merged.get(acc.name) || { acc, n: 0 };
        hit.n++;
        merged.set(acc.name, hit);
      }));
      const failed = results.filter(r => r.status === "rejected").length;
      const boxes = [];
      const update = () => del.setEnabled(boxes.some(b => b.getValue()));
      // Tahtanın yönetici hesabı listelenmez (sunucu da reddeder — bkz. JobsApi::UNDELETABLE_USERS).
      [...merged.values()].filter(({ acc }) => !["etapadmin", "root"].includes(acc.name)).forEach(({ acc, n }) => {
        const label = (acc.full_name && acc.full_name !== acc.name ? `${esc(acc.full_name)} (${esc(acc.name)})` : esc(acc.name)) +
          (boards.length > 1 ? ` <span style="opacity:.7">— ${n}/${boards.length} tahtada</span>` : "");
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
        ? "Silinecek kullanıcıları işaretleyin." + (failed ? ` <span style="color:#c42b1c">${failed} tahtanın hesapları okunamadı.</span>` : "")
        : "Silinebilecek kullanıcı hesabı bulunamadı" + (failed ? " (hesaplar okunamadı)." : "."));

      del.addListener("execute", async () => {
        const names = boxes.filter(b => b.getValue()).map(b => b.getModel());
        const files = allFiles.getValue();
        const shown = names.map(n => "• " + esc(n)).join("<br>");
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${where}</b> üzerinde ${names.length} kullanıcı <b>kalıcı olarak</b> silinsin mi?<br><br>${shown}<br><br>` +
          (files
            ? "Ev dizinleri ve sistemin başka yerlerindeki tüm dosyaları da <b>silinecek</b>; geri alınamaz."
            : "Yalnız hesaplar silinecek; dosyaları tahtada kalacak.") +
          "<br>Açık oturumları ve çalışan programları önce kapatılır.", "Sil");
        if (!ok) {
          return;
        }
        win.close();
        boards.forEach(b => delete this.__accountsCache[b.id]);
        this.__job({
          type: "action", action: "user-delete", board_ids: boards.map(b => b.id),
          values: { KULLANICILAR: names.join(" "), DOSYALAR: files ? "tum" : "koru" }
        }, `Kullanıcı sil — ${names.join(", ")}`);
      });
    },

    /**
     * Kullanıcılar ▸ Parola ayarla…: seçili (çevrimiçi) tahtalardaki hesaplar tek listede (bkz. deleteUsers);
     * işaretlenen hesaplara ortak bir parola verilir. Tahtanın yönetici hesapları (etapadmin, root) bu
     * listede YOKTUR — gözden kaçıp öğrenci hesaplarıyla aynı parolayı almasınlar diye ayrı bir bölümde,
     * varsayılan kapalı, her biri kendi parolasıyla ve kendi yetkisiyle ("boards.passwords.<hesap>")
     * ayarlanır. Her parola iki kutuya yazılır; sonunda onay alınır. Her parola grubu ayrı bir görevdir
     * (hazır işlem "user-password"; parola görev bitince sunucudan silinir, denetim kaydına maskeli yazılır).
     * İkinci sekme: root ve etapadmin parolası yalnız seçilen bilgisayarda (bkz. ui.boards.AdminPasswordPanel).
     */
    async setPasswords(boards, user) {
      if (!boards.length) {
        ankamon.ui.Dialog.alert("Çevrimiçi tahta yok.");
        return;
      }
      const esc = qx.bom.String.escape;
      const can = feature => user.is_admin || user.features.includes(feature);
      const ADMIN = ["etapadmin", "root"];
      const where = boards.length > 1 ? `${boards.length} tahta` : esc(boards[0].label || boards[0].hostname || boards[0].ip);
      const win = ankamon.ui.Dialog.window(`Parola ayarla — ${where}`, 560);
      // İki sekme: "Kullanıcılar" (toplu) ve yönetici hesapları (tek bilgisayarda, bkz. ui.boards.AdminPasswordPanel).
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
      const pane = new qx.ui.tabview.Page("Kullanıcılar");
      pane.setLayout(new qx.ui.layout.VBox(12));
      pane.setPadding(10);
      tabs.add(pane);
      const ownAccounts = ADMIN.filter(name => can("boards.passwords." + name));
      if (ownAccounts.length) {
        tabs.add(new ankamon.ui.boards.AdminPasswordPanel(boards, ownAccounts));
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
        box.add(new qx.ui.basic.Label("Parola:"), { row: 0, column: 0 });
        box.add(first, { row: 0, column: 1 });
        box.add(new qx.ui.basic.Label("Tekrar:"), { row: 1, column: 0 });
        box.add(second, { row: 1, column: 1 });
        box.add(note, { row: 2, column: 1 });
        if (bootWipe) {
          box.add(new qx.ui.basic.Label(this.BOOT_WIPE_NOTE).set({ textColor: "app-warn", toolTipText: this.BOOT_WIPE_HINT, alignY: "middle" }), { row: 0, column: 2 });
          first.setToolTipText(this.BOOT_WIPE_HINT);
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
      const admins = ADMIN.filter(name => can("boards.passwords." + name)).map(name => {
        const group = new qx.ui.groupbox.GroupBox(name === "root" ? "⚠ root (sistem yöneticisi)" : "⚠ etapadmin (tahtanın yönetici hesabı)")
          .set({ layout: new qx.ui.layout.VBox(6) });
        const box = new qx.ui.form.CheckBox(`<b>${name}</b> parolasını da ayarla (ayrı parola)`).set({ rich: true });
        group.add(box);
        if (name === "root") {
          group.add(new qx.ui.basic.Label('<span style="color:#c42b1c">Ankamon tahtalara root ile bağlanır: yeni parola bu tahtalar ' +
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

      const results = await Promise.allSettled(boards.map(b => this.__accounts(b)));
      const merged = new Map();
      results.forEach(r => (r.status === "fulfilled" ? r.value : []).forEach(acc => {
        const hit = merged.get(acc.name) || { acc, n: 0 };
        hit.n++;
        merged.set(acc.name, hit);
      }));
      const failed = results.filter(r => r.status === "rejected").length;
      [...merged.values()].filter(({ acc }) => !ADMIN.includes(acc.name)).forEach(({ acc, n }) => {
        const label = (acc.full_name && acc.full_name !== acc.name ? `${esc(acc.full_name)} (${esc(acc.name)})` : esc(acc.name)) +
          (boards.length > 1 ? ` <span style="opacity:.7">— ${n}/${boards.length} tahtada</span>` : "");
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
        (failed && boxes.length ? ` <span style="color:#c42b1c">${failed} tahtanın hesapları okunamadı.</span>` : ""));
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
          (a.name === "root" ? ' <span style="color:#c42b1c">(Ankamon bu tahtalara yeni parolayla bağlanır)</span>' : "")));
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${where}</b> üzerinde şu hesapların parolası değiştirilsin mi?<br><br>${lines.map(l => "• " + l).join("<br>")}` +
          "<br><br>Açık oturumlar kapanmaz; yeni parola bir sonraki girişte geçerli olur.", "Parolayı ayarla");
        if (!ok) {
          return;
        }
        win.close();
        const job = (accounts, password, caption) => this.__job({
          type: "action", action: "user-password", board_ids: boards.map(b => b.id),
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
     * @param boards {Array} hedef tahtalar
     * @param user {Map} oturum sahibi — hangi seçeneklerin sunulacağını (actions/shell yetkisi) belirler
     * @param preselect {String?} pencere bu hazır işlem (actions/<id>) seçili açılır — ör. Bakım ▸ Sensörler
     *   uyarısındaki kurulum bağlantıları; işlem listede yoksa (yetki) ilk satır kalır
     */
    async run(boards, user, preselect = null) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        ankamon.ui.Dialog.alert("Önce bir ya da daha fazla tahta işaretleyin.");
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

      const win = ankamon.ui.Dialog.window(`Komut çalıştır — ${ids.length} tahta`, 560);
      const select = new qx.ui.form.SelectBox();
      if (canCommand) {
        select.add(new qx.ui.form.ListItem("— Serbest komut —", null, null));
      }
      actions.forEach(a => select.add(new qx.ui.form.ListItem(`${a.category} — ${a.title}`, null, a)));
      if (!select.getChildren().length) {
        ankamon.ui.Dialog.alert("Çalıştırabileceğiniz hazır işlem ya da komut izniniz yok.");
        win.close();
        return;
      }
      win.add(select);
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
        if (action === null) {
          desc.setValue("İşaretli tahtalarda çalıştırılacak bash komutu.");
          commandArea = new qx.ui.form.TextArea("").set({
            font: "app-mono", height: 140, placeholder: "ör. systemctl restart prometheus-node-exporter"
          });
          body.add(commandArea);
        } else {
          desc.setValue(qx.bom.String.escape(action.description));
          if (action.params.length) {
            form = new ankamon.ui.Form();
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
            body.add(form);
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
        if (action === null) {
          const command = (commandArea.getValue() || "").trim();
          if (!command) {
            return;
          }
          win.close();
          this.__job({ type: "command", command, board_ids: ids }, "Komut çıktısı");
          return;
        }
        win.close();
        this.__job({ type: "action", action: action.id, board_ids: ids, values: form ? form.values() : {} },
          `Komut çıktısı — ${action.title}`);
      });
      ankamon.ui.Dialog.buttons(win, [runBtn]);
      win.open();
    },

    /** Görevi kuyruğa yazar ve canlı çıktı penceresini İSTEK SÜRERKEN açar (beklemeden). */
    __job(body, caption) {
      ankamon.ui.Jobs.show(ankamon.io.Api.post("/jobs", body).then(res => res.id), caption);
    },

    // "Oturum aç" hesap listesi, tahta başına (tarayıcı tarafı; sunucu da 24 sa önbellekler —
    // bkz. worker executor/accounts.py). Her sağ tıkta yeni bir görev kaydı açılmasın diye.
    __accountsCache: {},
    ACCOUNTS_TTL_MS: 24 * 3600 * 1000,

    /**
     * Sağ menünün hesap alt menüsü ("Oturum aç"): tahtadaki hesaplar (çoklu seçimde İLK
     * tahtadan alınır), birine tıklanınca onPick(hesap, etiket) çağrılır — işlem seçili TÜM tahtalara
     * uygulanır. Liste alt menü ilk kez açılınca yüklenir (menü açılışını SSH beklemesiyle geciktirmemek için).
     * @param verb {String} çoklu seçim bilgi satırı için ("açılır")
     */
    __accountMenu(boards, verb, onPick) {
      const sub = new qx.ui.menu.Menu();
      const info = text => sub.add(new qx.ui.menu.Button(text).set({ enabled: false }));
      if (!boards.length) {
        info("Çevrimiçi tahta yok");
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
          list = await this.__accounts(boards[0]);
        } catch (e) {
          sub.removeAll().forEach(w => w.dispose());
          info("Hesaplar alınamadı: " + (e.message || e));
          loaded = false; // bir sonraki açılışta yeniden denensin
          return;
        }
        sub.removeAll().forEach(w => w.dispose());
        if (!list.length) {
          info("Tahtada kullanıcı hesabı yok");
          return;
        }
        if (boards.length > 1) {
          info(`Liste: ${boards[0].label || boards[0].hostname || boards[0].ip} · ${boards.length} tahtada ${verb}`);
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
    async __accounts(board) {
      const hit = this.__accountsCache[board.id];
      if (hit && Date.now() - hit.at < this.ACCOUNTS_TTL_MS) {
        return hit.list;
      }
      const jobId = (await ankamon.io.Api.post("/jobs", { type: "accounts", board_ids: [board.id] })).id;
      for (let i = 0; i < 60; i++) {
        const res = await ankamon.io.Api.get(`/jobs/${jobId}`);
        const t = ((res.job && res.job.targets) || [])[0];
        if (t && !["queued", "running"].includes(t.status)) {
          if (t.status !== "ok") {
            throw new Error(t.output || "tahtaya bağlanılamadı");
          }
          const list = JSON.parse(t.output || "[]");
          this.__accountsCache[board.id] = { at: Date.now(), list };
          return list;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      throw new Error("zaman aşımı");
    },

    /** Tahtanın hesap listesi (önbellekli — bkz. __accounts); Yedekle/Geri al penceresi de kullanır. */
    accountsOf(board) {
      return this.__accounts(board);
    },

    /** Tahtaların hesap listesi önbelleğini düşürür (hesap eklenip silinince). */
    forgetAccounts(boards) {
      boards.forEach(b => delete this.__accountsCache[b.id]);
    },

    async __login(boards, acc, label, sessionOps) {
      const esc = qx.bom.String.escape;
      const where = boards.length > 1 ? `<b>${boards.length} tahtada</b>` : `<b>${esc(boards[0].label || boards[0].hostname || boards[0].ip)}</b> tahtasında`;
      const ok = await ankamon.ui.Dialog.confirm(
        `${where} <b>${esc(label)}</b> hesabıyla oturum açılsın mı?<br><br>` +
        "Tahtada açık bir oturum varsa <b>kullanıcı değiştirilir</b>: mevcut oturum kapanmaz, programları arka planda çalışmaya devam eder.",
        "Oturum aç");
      if (!ok) {
        return;
      }
      if (sessionOps) {
        sessionOps.login(boards, acc);
      } else {
        this.__job({ type: "login", username: acc.name, board_ids: boards.map(b => b.id) }, `Oturum aç — ${label}`);
      }
    },

    /**
     * "Oturumu kapat" / "Oturumu kilitle" (bkz. worker executor/accounts.py logout/lock). Kilitlemede
     * oturum ve süreçleri açık kalır, tahta giriş ekranına (greeter) geçer.
     * @param type {String} "logout" | "lock"
     * @param sessionOps {Map?} Ekranlar önizlemesinden: iş penceresi açmadan kutucuklarda gösterilir
     * @param username {String?} belirli kullanıcının oturumu (Oturumlar grid'i); yoksa tahtadaki etkin oturum
     */
    async sessionAction(type, boards, sessionOps = null, username = null) {
      if (!boards.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const lock = type === "lock";
      const title = lock ? "Oturumu kilitle" : "Oturumu kapat";
      const owner = username ? `<b>${esc(username)}</b> kullanıcısının oturumu` : "açık oturum";
      const where = boards.length > 1 ? `<b>${boards.length} tahtadaki</b> açık oturumlar` : `<b>${esc(boards[0].label || boards[0].hostname || boards[0].ip)}</b> tahtasındaki ${owner}`;
      const ok = await ankamon.ui.Dialog.confirm(lock
        ? `${where} kilitlensin mi?<br><br>Oturum kapanmaz, açık programlar çalışmaya devam eder; tahta giriş ekranına geçer ve kilidi açmak için kullanıcının parolası gerekir.`
        : `${where} kapatılsın mı?<br><br>Kaydedilmemiş işler kaybolur; tahta giriş ekranına döner.`, title);
      if (!ok) {
        return;
      }
      if (sessionOps) {
        sessionOps[type](boards);
      } else {
        const body = { type, board_ids: boards.map(b => b.id) };
        if (username) {
          body.username = username;
        }
        this.__job(body, username ? `${title} — ${username}` : title);
      }
    }
  }
});
