/**
 * Tahta işlemleri (tek ya da çoklu): web terminal, kapatma, uyandırma (WoL), hazır işlem + serbest komut
 * (run — tek pencerede birleşik). Hem Tahtalar grid'i hem de sol ağaçtaki sağ menüler buradan çağırır.
 * Her işlem yetki ister; kullanıcıda yoksa düğme/menü zaten eklenmez, sunucu da ayrıca denetler.
 */
qx.Class.define("tihamon.ui.BoardOps", {
  type: "static",

  statics: {
    /**
     * Yeni sekme açmadan, uygulama içinde modal (büyütülebilir — qx.ui.window.Window varsayılanı)
     * bir pencerede iframe gösterir. webshell/webshellMulti ortak kullanır (bkz. screen()/
     * filemanager() ile aynı Grow+Iframe deseni; buradaki fark modal:true olması).
     */
    __terminalWindow(caption, url) {
      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1024, height: 700 };
      const win = new qx.ui.window.Window(caption).set({
        modal: true,
        showMinimize: false,
        contentPadding: 0,
        layout: new qx.ui.layout.Grow(),
        width: Math.min(1024, bounds.width - 40),
        height: Math.min(640, bounds.height - 40)
      });
      const frame = new qx.ui.embed.Iframe(url);
      win.add(frame);
      win.addListener("close", () => {
        frame.setSource("about:blank");
        win.destroy();
      });
      win.addListenerOnce("appear", () => win.center());
      root.add(win);
      win.open();
    },

    /** @param board {Map} en az {id, label|hostname|ip} */
    async webshell(board) {
      try {
        const c = await tihamon.io.Api.get("/boards/" + board.id + "/shell");
        const name = board.label || board.hostname || board.ip;
        const url = "/webshell/?hostname=" + encodeURIComponent(c.hostname) +
          "&port=" + c.port + "&username=" + encodeURIComponent(c.username) +
          "&password=" + encodeURIComponent(c.password) + "&title=" + encodeURIComponent(name);
        this.__terminalWindow("Web terminal — " + name, url);
      } catch (e) {
        tihamon.ui.Dialog.error(e);
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
        c = await tihamon.io.Api.get("/boards/" + board.id + "/filemanager");
      } catch (e) {
        tihamon.ui.Dialog.error(e);
        return;
      }
      const name = board.label || board.hostname || board.ip;
      // Kimlik bilgisi URL'ye konmaz (API de döndürmez): bağlama köprüsü onu kendisi okur.
      const url = "/filemanager-open/?board=" + c.board +
        "&hostname=" + encodeURIComponent(c.hostname) + "&title=" + encodeURIComponent(name);

      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1024, height: 700 };
      const win = new qx.ui.window.Window("Dosya yöneticisi — " + name).set({
        showMinimize: false,
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
     */
    screen(boards, user, manage = false) {
      const list = boards.map(b => ({ id: b.id, name: b.label || b.hostname || b.ip || "#" + b.id }));
      if (!list.length) {
        return;
      }
      const control = !!user && (user.is_admin || user.features.includes("screen.control"));
      // manage ("Ekranı yönet"): tek tahta, sayfa doğrudan müdahale (fare/klavye) kipinde açılır.
      manage = manage && control && list.length === 1;
      const spec = { boards: list, q: list.length > 1 ? "thumb" : "view", control, manage };
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
      const caption = list.length > 1 ? `Ekranlar (${list.length} tahta)`
        : (manage ? "Ekran yönetimi — " : "Ekran — ") + list[0].name;

      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1024, height: 700 };
      const win = new qx.ui.window.Window(caption).set({
        showMinimize: false,
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
      win.addListener("close", () => {
        frame.setSource("about:blank"); // WebSocket'ler hemen kapansın (tahtadaki x11vnc de biter)
        win.destroy();
      });
      win.addListenerOnce("appear", () => win.center());
      root.add(win);
      win.open();
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
     * boş alan, kablolu ağ, Wi-Fi kartı ve bağlantı durumu, ekran, BIOS — bkz. ui.FactsView) gösterir.
     * Worker tahtaya SSH ile canlı bağlanıp toplar; aynı tahtaya 60 dakika içinde tekrar bağlanmaz,
     * son toplanan değeri döner (bkz. backend "facts" görev türü, worker/tihamon/executor/hwfacts.py
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
      const caption = boards.length > 1 ? `Bilgi kartı (${boards.length} tahta)` : "Bilgi kartı — " + name(boards[0]);
      const win = tihamon.ui.Dialog.window(caption, 960, { maximizable: true });
      // Dialog.window pencereyi içeriğin DOĞAL yüksekliğine göre boyutlandırır; Scroll'un flex:1'i
      // onsuz küçük kalır (sarılacağı sabit bir yükseklik olmadan esneyecek yer bulamaz) — bkz.
      // benzer not Base.js _createTable civarında. Sabit bir yükseklik vererek Scroll'a gerçek alan açılır.
      win.setHeight(Math.min(560, (qx.core.Init.getApplication().getRoot().getBounds() || { height: 700 }).height - 80));
      const status = new qx.ui.basic.Label("Toplanıyor…").set({ textColor: "app-muted" });
      win.add(status);
      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(8));
      const scroll = new qx.ui.container.Scroll();
      scroll.add(body);
      win.add(scroll, { flex: 1 });

      const printBtn = new qx.ui.form.Button("Yazdır").set({ enabled: false });
      const closeBtn = new qx.ui.form.Button("Kapat");
      closeBtn.addListener("execute", () => win.close());
      tihamon.ui.Dialog.buttons(win, [printBtn, closeBtn]);

      let stop = false;
      win.addListener("close", () => { stop = true; });

      let jobId;
      let targets = [];
      // Sensörler (anlık + en düşük/en yüksek) facts görevinden bağımsız, hemen gelir — bkz. FactsView.__sensorRows.
      const sensors = new Map();
      ids.forEach(id => tihamon.io.Api.get(`/metrics/${id}/sensors`)
        .then(res => sensors.set(id, res.sensors || {}), () => sensors.set(id, null))
        .then(() => !stop && render()));
      const render = () => {
        body.removeAll().forEach(w => w.dispose());
        targets.forEach(t => {
          const card = new qx.ui.container.Composite(new qx.ui.layout.VBox(3)).set({
            padding: 10,
            decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border" })
          });
          card.add(new qx.ui.basic.Label(qx.bom.String.escape(t.board)).set({ font: "bold" }));
          const facts = this.__parseFacts(t);
          if (facts) {
            card.add(new qx.ui.basic.Label(tihamon.ui.FactsView.html(facts, sensors.get(t.board_id))).set({ rich: true, selectable: true, allowGrowX: true }));
          } else if (["queued", "running"].includes(t.status)) {
            card.add(new qx.ui.basic.Label("Toplanıyor…").set({ textColor: "app-muted" }));
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
          res = await tihamon.io.Api.get(`/jobs/${jobId}`);
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
        status.setValue(running ? "Toplanıyor…" : "");
        printBtn.setEnabled(!running);
        if (running) {
          qx.event.Timer.once(tick, this, 700);
        }
      };
      printBtn.addListener("execute", () => this.__printInfoCard(targets, sensors));
      win.open();

      try {
        jobId = (await tihamon.io.Api.post("/jobs", { type: "facts", board_ids: ids })).id;
      } catch (e) {
        status.setValue("");
        tihamon.ui.Dialog.error(e);
        return;
      }
      tick();
    },

    /** "Bilgi kartı" penceresindeki "Yazdır": qx pencere ağacı yerine YENİ, sade bir sekmede tek
     * sayfalık bir tablo açar — qx'in mutlak konumlu kutuları tarayıcı yazdırmasında güvenilmez
     * kırpılıyor (bkz. diğer özel görünümler: /screen/, /webshell/ — aynı "ayrı sade sayfa" deseni). */
    __printInfoCard(targets, sensors) {
      const esc = qx.bom.String.escape;
      // Tahta başına bir kart (pencereyle aynı HTML, bkz. ui.FactsView); kart sayfa ortasında bölünmez.
      const cards = targets.map(t => {
        const facts = this.__parseFacts(t);
        return `<div class="card"><h2>${esc(t.board)}</h2>` +
          (facts ? tihamon.ui.FactsView.html(facts, sensors.get(t.board_id)) : `<p>${esc(t.output || "Okunamadı")}</p>`) + "</div>";
      }).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bilgi kartı</title>
        <style>
          body{font-family:sans-serif;margin:24px;color:#111;font-size:13px}
          h1{font-size:18px;margin-bottom:4px}
          h2{font-size:15px;margin:0 0 4px}
          .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;margin-top:12px}
          .card{border:1px solid #ccc;padding:10px;break-inside:avoid;page-break-inside:avoid}
        </style></head><body>
        <h1>Tahta bilgi kartı</h1>
        <div>${esc(new Date().toLocaleString("tr-TR"))}</div>
        <div class="cards">${cards}</div>
        </body></html>`;
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
     * Yayın sayfası (/cast/) AYRI bir tarayıcı penceresinde açılır: yayın sürerken Tiha-Mon'da çalışmaya
     * devam edilebilir, pencereyi kapatmak yansıtmayı bitirir. Ekran yakalama HTTPS ister (nginx HTTP'yi
     * zaten HTTPS'e yönlendirir). Ayrıntı: docker/rootfs/cast/index.html, worker executor/cast.py.
     */
    cast(boards, preset = null) {
      const list = boards.map(b => ({ id: b.id, name: b.label || b.hostname || b.ip || "#" + b.id, online: !!b.online }));
      if (!list.length) {
        tihamon.ui.Dialog.alert("Önce bir ya da daha fazla tahta işaretleyin.");
        return;
      }
      // preset {quality, audio}: sağ menüden seçilen ayarlar — sayfa ayar sormaz (bkz. cast/index.html).
      const hash = btoa(unescape(encodeURIComponent(JSON.stringify(Object.assign({ boards: list }, preset || {})))));
      // Göreli adres: HTTP'deysek nginx HTTPS'e yönlendirir, tarayıcı fragmanı (#…) korur.
      const w = window.open("/cast/#" + hash, "tihamon-cast", "popup,width=560,height=720");
      if (!w) {
        tihamon.ui.Dialog.alert("Tarayıcı açılır pencereyi engelledi. Bu site için açılır pencerelere izin verip yeniden deneyin.");
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

    /** Seçili tahtaları kapatır (SSH ile). Birden fazlaysa önce onay alır. */
    async shutdown(boards) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        return;
      }
      if (ids.length > 1) {
        const ok = await tihamon.ui.Dialog.confirm(
          `<b>${ids.length} tahta</b> kapatılsın mı? Her biri SSH ile tek tek kapatılacak.`, "Kapat");
        if (!ok) {
          return;
        }
      }
      this.__job({ type: "action", action: "shutdown", board_ids: ids }, "Kapatma çıktısı");
    },

    /** Seçili tahtaları yeniden başlatır (hazır işlem "reboot"). Birden fazlaysa önce onay alır. */
    async reboot(boards) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        return;
      }
      if (ids.length > 1) {
        const ok = await tihamon.ui.Dialog.confirm(
          `<b>${ids.length} tahta</b> yeniden başlatılsın mı? Açık oturumlar kapanır.`, "Yeniden başlat");
        if (!ok) {
          return;
        }
      }
      this.__job({ type: "action", action: "reboot", board_ids: ids }, "Yeniden başlatma çıktısı");
    },

    /** Seçili (kapalı) tahtaları ağdan uyandırır (WoL). */
    wol(boards) {
      const ids = boards.map(b => b.id);
      if (ids.length) {
        tihamon.ui.Jobs.show(tihamon.io.Api.post("/jobs", { type: "wol", board_ids: ids }).then(res => res.id),
          "Uyandırma (WoL)", { intro: this.WOL_INTRO });
      }
    },

    // Uyandırma penceresinin çıktı kutusunun başındaki sabit açıklama (bkz. ui.Jobs opts.intro):
    // "paket gönderildi" görünse de tahtanın neden açılmayabileceği ve TiHA'nın WoL ön koşulları.
    // Kaynak: TiHA sihirbazının "Wake-on-LAN" adımı (m15, tiha-wake-on-lan.service) — bkz.
    // https://github.com/enseitankado/tiha
    WOL_INTRO: [
      "UYANDIRMA (Wake-on-LAN) HAKKINDA",
      "",
      "Tiha-Mon, tahtanın ağ kartına \"sihirli paket\" gönderir. Aşağıda \"gönderildi\" yazması paketin ağa",
      "çıktığını gösterir; tahtanın açılacağını garanti etmez. Tahta açılmazsa nedeni çoğunlukla tahtadadır:",
      "",
      "• Tahta düzgün kapatılmadıysa uyanmaz. Elektrik kesilmesi, güç düğmesine uzun basılması ya da",
      "  donma gibi ANİ kapanışlarda ağ kartı uyandırmaya hazırlanmaz ya da kartta bekleme gücü kalmaz;",
      "  sihirli paket ulaşsa bile tahta açılmaz. Böyle bir tahtayı bir kez elle açın; bundan sonra",
      "  Tiha-Mon'dan \"Bilgisayarı kapat\" ile ya da tahtanın kendi menüsünden kapatılınca yeniden uyandırılabilir.",
      "• Tahtanın prizi, uzatma kablosu ya da sınıf sigortası kapalıysa uyanmaz (bekleme gücü yok).",
      "",
      "ÖN KOŞULLAR — TiHA sihirbazının \"Wake-on-LAN\" adımı (github.com/enseitankado/tiha):",
      "• TiHA'da bu adım uygulanmış olmalı: tahtaya tiha-wake-on-lan.service kurulur ve her açılışta",
      "  ağ kartında uyandırmayı açar (ethtool -s <arayüz> wol g).",
      "• Tahtanın BIOS'unda \"Wake on LAN\" AÇIK; \"ErP\" / \"Deep Sleep\" (derin uyku) KAPALI olmalı.",
      "• Tahta ile Tiha-Mon sunucusu AYNI ağda (aynı VLAN / yayın alanında) olmalı; sihirli paket bir",
      "  yayındır, yönlendiriciden (router) öteye geçmez.",
      "• Tahtanın MAC adresi Tiha-Mon'da kayıtlı olmalı (tahta bir kez açık görülünce kendiliğinden kaydedilir)."
    ].join("\n"),

    /**
     * Birden fazla tahtanın web terminalini, uygulama içinde tek modal pencerede yan yana panolar
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
          const c = await tihamon.io.Api.get("/boards/" + board.id + "/shell");
          return { ...c, title: board.label || board.hostname || board.ip };
        }));
      } catch (e) {
        tihamon.ui.Dialog.error(e);
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
      if (handler) {
        btn.addListener("execute", handler, this);
      }
      return btn;
    },

    menu(board, user, boards = [board], sessionOps = null) {
      const can = feature => user.is_admin || user.features.includes(feature);
      const menu = new qx.ui.menu.Menu();
      // Menü simgeleri resim değil, metne eklenen Unicode karakterdir — bkz. tihamon.ui.Shell.ICON
      // başındaki not (background-image tabanlı simgeler bu derlenmiş build'de güvenilmez).
      const ICON = tihamon.ui.Shell.ICON;
      const add = (icon, label, handler) => menu.add(this.menuButton(icon, label, handler));
      // Çoklu seçimde toplu uygulanan maddelerin etiketinde tahta sayısı görünür.
      const count = boards.length > 1 ? ` (${boards.length} tahta)` : "";
      // Alt menü yardımcıları: madde yoksa grup hiç eklenmez (yetkiye göre boş alt menü görünmesin).
      const sub = () => new qx.ui.menu.Menu();
      const subAdd = (target, icon, label, handler) => target.add(this.menuButton(icon, label, handler));
      // Bilgisayarı aç (WoL) + Bilgisayarı kapat: her zaman yan yana (kullanıcı isteği), çevrimiçi/
      // çevrimdışı tahtada da. Her biri seçimin yalnız uygun kısmına uygulanır (aç → kapalı olanlar,
      // kapat → açık olanlar); uygulanacak tahta yoksa madde görünür ama devre dışıdır.
      const power = () => {
        if (!can("power")) {
          return;
        }
        const off = boards.filter(b => !b.online);
        const on = boards.filter(b => b.online);
        const n = list => (list.length > 1 ? ` (${list.length} tahta)` : "");
        add(ICON.wol, "Bilgisayarı aç (WoL)" + n(off), () => this.wol(off));
        menu.getChildren()[menu.getChildren().length - 1].setEnabled(off.length > 0);
        add(ICON.shutdown, "Bilgisayarı kapat" + n(on), () => this.shutdown(on));
        menu.getChildren()[menu.getChildren().length - 1].setEnabled(on.length > 0);
        add(ICON.reboot, "Bilgisayarı yeniden başlat" + n(on), () => this.reboot(on));
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
        // Komut çalıştır ▸ Web terminal, Serbest/hazır komut çalıştır (kullanıcı isteği: ikisi bir arada).
        const commands = sub();
        if (can("shell")) {
          subAdd(commands, ICON.webshell, "Web terminal" + count, () =>
            boards.length > 1 ? this.webshellMulti(boards) : this.webshell(board));
        }
        if (can("actions") || can("shell")) {
          subAdd(commands, ICON.run, "Serbest/hazır komut çalıştır" + count, () => this.run(boards, user));
        }
        group(ICON.run, "Komut çalıştır" + count, commands);

        // Ekran ▸ Ekranı göster, Ekranımı yansıt ▸ <kalite> + Ses (ayar penceresi sorulmaz — bkz. cast()).
        const screens = sub();
        if (can("screen")) {
          subAdd(screens, ICON.screen, "Ekranı göster" + count, () => this.screen(boards, user));
        }
        if (can("screen") && can("screen.control")) {
          // Fare/klavye ile müdahale tek tahtada anlamlı: çoklu seçimde de yalnız sağ tıklanan tahta.
          subAdd(screens, ICON.screenControl, "Ekranı yönet", () => this.screen([board], user, true));
        }
        if (can("cast")) {
          screens.add(this.menuButton(ICON.cast, "Ekranımı yansıt" + count, null, this.__castMenu(online)));
        }
        group(ICON.screen, "Ekran" + count, screens);

        // "Bilgi kartı" burada değil: Tahtalar sayfasındaki "Logları göster"in hemen altında (kullanıcı
        // isteği) — bkz. page.Boards __rowMenu.

        // Oturum… ▸ Oturum aç ▸ <hesap>, Oturumu kapat, Oturumu kilitle, Oturumları sorgula.
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
        group(ICON.sessions, "Oturum…", sessions);

        // Dosyalar ▸ Dosya yöneticisi, Dosyaları kopyala, Yedekle ▸ <hesap> (kullanıcı isteği: eski
        // "Yedekle" + "Dosya yöneticisi" tek grupta; Dosya yöneticisi ilk sırada). Bilgisayarı aç/kapat
        // çiftinin hemen üstünde.
        const files = sub();
        if (can("filemanager")) {
          subAdd(files, ICON.filemanager, "Dosya yöneticisi", () => this.filemanager(board));
          // İki panelli gezgin: bu tahtanın kullanıcı dizinlerinden başka bir tahtaya kopyalama.
          subAdd(files, ICON.copy, "Dosyaları kopyala", () => tihamon.ui.files.CopyWindow.open(board));
        }
        if (can("boards.backup")) {
          files.add(this.menuButton(ICON.backup, "Yedekle" + count, null,
            this.__accountMenu(online, "yedeklenir", (acc, label) => this.__backup(online, acc, label))));
        }
        group(ICON.filemanager, "Dosyalar", files);
      }
      power();
      return menu.getChildren().length ? menu : null;
    },

    /**
     * Tek pencerede hem hazır işlem kataloğunu hem serbest komutu sunar (eski ayrı "Uzaktan işlemler" /
     * "Toplu komut" birleştirildi). Seçim kutusunun ilk satırı "— Serbest komut —"; o seçiliyken bir
     * komut kutusu, bir hazır işlem seçiliyken onun açıklaması + parametre formu gösterilir.
     * @param boards {Array} hedef tahtalar
     * @param user {Map} oturum sahibi — hangi seçeneklerin sunulacağını (actions/shell yetkisi) belirler
     */
    async run(boards, user) {
      const ids = boards.map(b => b.id);
      if (!ids.length) {
        tihamon.ui.Dialog.alert("Önce bir ya da daha fazla tahta işaretleyin.");
        return;
      }
      const canActions = user.is_admin || user.features.includes("actions");
      const canCommand = user.is_admin || user.features.includes("shell");
      let actions = [];
      if (canActions) {
        try {
          actions = (await tihamon.io.Api.get("/actions")).actions;
        } catch (e) {
          tihamon.ui.Dialog.error(e);
          return;
        }
      }

      const win = tihamon.ui.Dialog.window(`Komut çalıştır — ${ids.length} tahta`, 560);
      const select = new qx.ui.form.SelectBox();
      if (canCommand) {
        select.add(new qx.ui.form.ListItem("— Serbest komut —", null, null));
      }
      actions.forEach(a => select.add(new qx.ui.form.ListItem(`${a.category} — ${a.title}`, null, a)));
      if (!select.getChildren().length) {
        tihamon.ui.Dialog.alert("Çalıştırabileceğiniz hazır işlem ya da komut izniniz yok.");
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
            form = new tihamon.ui.Form();
            action.params.forEach(p => {
              if (p.type === "select") {
                form.select(p.key, p.label, p.options, p.default);
              } else if (p.type === "password") {
                // Gizli değer (ör. BIOS parolası): maskeli; tarayıcı kayıtlı oturum parolasını buraya
                // kendiliğinden doldurmasın diye "new-password" (Tiha-Mon parolası BIOS'a yazılmasın).
                form.password(p.key, p.label).getContentElement().setAttribute("autocomplete", "new-password");
              } else {
                form.text(p.key, p.label, p.default);
              }
            });
            body.add(form);
          }
        }
      };
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
      tihamon.ui.Dialog.buttons(win, [runBtn]);
      win.open();
    },

    /** Görevi kuyruğa yazar ve canlı çıktı penceresini İSTEK SÜRERKEN açar (beklemeden). */
    __job(body, caption) {
      tihamon.ui.Jobs.show(tihamon.io.Api.post("/jobs", body).then(res => res.id), caption);
    },

    // "Oturum aç" hesap listesi, tahta başına (tarayıcı tarafı; sunucu da 24 sa önbellekler —
    // bkz. worker executor/accounts.py). Her sağ tıkta yeni bir görev kaydı açılmasın diye.
    __accountsCache: {},
    ACCOUNTS_TTL_MS: 24 * 3600 * 1000,

    /**
     * Sağ menünün hesap alt menüsü ("Oturum aç", "Yedekle"): tahtadaki hesaplar (çoklu seçimde İLK
     * tahtadan alınır), birine tıklanınca onPick(hesap, etiket) çağrılır — işlem seçili TÜM tahtalara
     * uygulanır. Liste alt menü ilk kez açılınca yüklenir (menü açılışını SSH beklemesiyle geciktirmemek için).
     * @param verb {String} çoklu seçim bilgi satırı için ("açılır", "yedeklenir")
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
      const jobId = (await tihamon.io.Api.post("/jobs", { type: "accounts", board_ids: [board.id] })).id;
      for (let i = 0; i < 60; i++) {
        const res = await tihamon.io.Api.get(`/jobs/${jobId}`);
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

    /**
     * Seçilen hesabın ev dizinini (izinler + sahiplik + ACL/xattr) her tahtada tar.gz yapar ve indirir
     * (bkz. worker executor/backup.py, backend HomeBackupApi). Canlı rapor + toplam ilerleme çubuğu
     * görev penceresinde; biten her tahtanın yedeği aralıklı, sırayla indirilir (bkz. ui.Jobs).
     */
    __backup(boards, acc, label) {
      if (!boards.length) {
        return;
      }
      tihamon.ui.Jobs.show(
        tihamon.io.Api.post("/jobs", { type: "backup_home", username: acc.name, board_ids: boards.map(b => b.id) }).then(res => res.id),
        `Yedekle — ${label}` + (boards.length > 1 ? ` (${boards.length} tahta)` : ""),
        { progress: true, downloads: (jobId, name) => `/api/home-backups/${jobId}?file=${encodeURIComponent(name)}` });
    },

    async __login(boards, acc, label, sessionOps) {
      const esc = qx.bom.String.escape;
      const where = boards.length > 1 ? `<b>${boards.length} tahtada</b>` : `<b>${esc(boards[0].label || boards[0].hostname || boards[0].ip)}</b> tahtasında`;
      const ok = await tihamon.ui.Dialog.confirm(
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
      const ok = await tihamon.ui.Dialog.confirm(lock
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
