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
 * Dosya yöneticisi (FileBrowser Quantum) kenar çubuğuna "Hızlı işlemler" kartı (kullanıcı isteği 2026-11-23: "dosya
 * yöneticisinin solunda dosya yükle, yeni klasör oluştur vb. kullanışlı seçenekler olsun").
 *
 * FileBrowser'ın kendi ayarlarında bu işlemleri kenar çubuğunda tek tek gösteren bir seçenek yok (yalnız menü açan
 * "File actions" düğmesi — userDefaults.sidebar.hideFileActions). Bu betik nginx'in sub_filter'ıyla FileBrowser'ın
 * HTML'ine eklenir (bkz. nginx-default.conf location /filemanager/; aynı köken, CSP 'self'). İşlemleri kendisi YAPMAZ:
 * FileBrowser'ın kendi menü düğmelerine tıklar — yükleme, çakışma soruları, ilerleme, yetkiler, sahiplik köprüsü
 * (writes.py) olduğu gibi FileBrowser'da kalır:
 *  - Yükle / Yeni klasör / Yeni dosya: kenar çubuğundaki "File actions" (data-testid) menüsünden,
 *  - seçili öğe işlemleri (İndir, Yeniden adlandır, Kopyala, Taşı, Sil, Bilgi): seçili öğenin sağ tık menüsünden.
 * Menü öğeleri Material Symbols simge adıyla bulunur (dil/çeviri değişse de aynı); bulunamazsa menü görünür bırakılır.
 */
(function () {
  "use strict";
  if (window.__ankamonFbHizli) {
    return;
  }
  window.__ankamonFbHizli = true;

  var CARD_ID = "ankamon-fb-hizli";
  // [simge (FileBrowser menüsündeki), etiket, kaynak: "create" (File actions menüsü) | "sel" (seçili öğenin sağ tık menüsü)]
  var ACTIONS = [
    ["file_upload", "Dosya yükle", "create", "Bu klasöre dosya ya da klasör yükle"],
    ["create_new_folder", "Yeni klasör", "create", "Bu klasörde yeni klasör oluştur"],
    ["note_add", "Yeni dosya", "create", "Bu klasörde yeni (boş) dosya oluştur"],
    null,
    ["file_download", "İndir", "sel", "Seçili öğeleri indir"],
    ["edit", "Yeniden adlandır", "sel", "Seçili öğenin adını değiştir"],
    ["file_copy", "Kopyala…", "sel", "Seçili öğeleri başka bir klasöre kopyala"],
    ["forward", "Taşı…", "sel", "Seçili öğeleri başka bir klasöre taşı"],
    ["delete", "Sil", "sel", "Seçili öğeleri sil (onay sorulur)"],
    ["info", "Bilgi", "sel", "Seçili öğenin boyutu, tarihi, izinleri"]
  ];

  var style = document.createElement("style");
  style.textContent =
    "#" + CARD_ID + "{padding:.6em .5em;display:flex;flex-direction:column;gap:2px}" +
    "#" + CARD_ID + " .ahi-baslik{font-size:.85em;font-weight:600;opacity:.7;padding:0 .5em .3em;text-transform:none}" +
    "#" + CARD_ID + " .ahi-ayrac{height:1px;margin:.35em .4em;background:currentColor;opacity:.15}" +
    "#" + CARD_ID + " button{display:flex;align-items:center;justify-content:flex-start!important;gap:.6em;width:100%;margin:0;padding:.45em .6em;border:0;border-radius:.5em;" +
    "background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}" +
    "#" + CARD_ID + " button:hover:not(:disabled){background:var(--primaryColor, #2196f3);color:#fff}" +
    "#" + CARD_ID + " button:disabled{opacity:.4;cursor:default}" +
    "#" + CARD_ID + " button i{font-size:1.4em}" +
    "#" + CARD_ID + " .ahi-not{font-size:.8em;opacity:.65;padding:.2em .6em 0}" +
    // Betik menüyü açıp öğesine tıklarken menü bir an görünmesin (öğe bulunamazsa sınıf kalkar, menü görünür).
    "html.ahi-sessiz #context-menu{opacity:0!important;pointer-events:none}";
  document.head.appendChild(style);

  function selectedItems() {
    return document.querySelectorAll(".listing-item.activebutton");
  }

  function wait(test, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() {
        var v = test();
        if (v || Date.now() - t0 > ms) {
          resolve(v || null);
          return;
        }
        setTimeout(tick, 40);
      })();
    });
  }

  function menuButton(icon) {
    var menu = document.querySelector("#context-menu");
    if (!menu) {
      return null;
    }
    var list = menu.querySelectorAll("button");
    for (var i = 0; i < list.length; i++) {
      var ic = list[i].querySelector("i");
      if (ic && ic.textContent.trim() === icon && list[i].offsetParent !== null) {
        return list[i];
      }
    }
    return null;
  }

  function closeMenu() {
    var ov = document.querySelector(".overlay");
    if (ov && getComputedStyle(ov).display !== "none") {
      ov.click();
    }
  }

  /** FileBrowser'ın menüsünü açar ve simgesi "icon" olan öğesine tıklar. */
  function run(action) {
    var icon = action[0];
    var opener;
    if (action[2] === "create") {
      opener = document.querySelector("[data-testid='file-actions-button']");
      if (!opener) {
        return;
      }
    } else {
      opener = selectedItems()[0];
      if (!opener) {
        return;
      }
    }
    closeMenu();
    document.documentElement.classList.add("ahi-sessiz");
    if (action[2] === "create") {
      opener.click();
    } else {
      var r = opener.getBoundingClientRect();
      opener.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    }
    wait(function () { return menuButton(icon); }, 1500).then(function (btn) {
      if (btn) {
        btn.click();
        setTimeout(function () { document.documentElement.classList.remove("ahi-sessiz"); }, 350);
      } else {
        // Öğe yok (yetki ya da sürüm farkı): menü görünür kalsın, kullanıcı oradan seçsin.
        document.documentElement.classList.remove("ahi-sessiz");
      }
    });
  }

  function build() {
    var card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "card";
    var head = document.createElement("div");
    head.className = "ahi-baslik";
    head.textContent = "Hızlı işlemler";
    card.appendChild(head);
    ACTIONS.forEach(function (a) {
      if (!a) {
        var sep = document.createElement("div");
        sep.className = "ahi-ayrac";
        card.appendChild(sep);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-ahi", a[0]);
      b.setAttribute("data-kaynak", a[2]);
      b.title = a[3];
      var i = document.createElement("i");
      i.className = "material-symbols";
      i.textContent = a[0];
      var s = document.createElement("span");
      s.textContent = a[1];
      b.appendChild(i);
      b.appendChild(s);
      b.addEventListener("click", function () { run(a); });
      card.appendChild(b);
    });
    var note = document.createElement("div");
    note.className = "ahi-not";
    card.appendChild(note);
    return card;
  }

  /** Kart yerinde mi (Vue kenar çubuğunu yeniden çizebilir), görünür mü (yalnız klasör listesinde), düğmeler etkin mi. */
  function sync() {
    var sidebar = document.getElementById("sidebar");
    var listing = document.querySelector("[data-testid='file-actions-button']");
    var card = document.getElementById(CARD_ID);
    if (!sidebar) {
      return;
    }
    if (!card) {
      card = build();
    }
    var anchor = sidebar.querySelector(".headline-card");
    if (anchor && card.previousElementSibling !== anchor) {
      anchor.after(card);
    } else if (!anchor && card.parentNode !== sidebar) {
      sidebar.insertBefore(card, sidebar.firstChild);
    }
    card.style.display = listing ? "" : "none";
    var n = selectedItems().length;
    card.querySelectorAll("button[data-kaynak='sel']").forEach(function (b) {
      var single = b.getAttribute("data-ahi") === "edit" || b.getAttribute("data-ahi") === "info";
      b.disabled = n === 0 || (single && n > 1);
    });
    card.querySelector(".ahi-not").textContent = n === 0 ? "Seçili öğe işlemleri için listeden bir öğe seçin."
      : n + " öğe seçili";
  }

  var pending = 0;
  function later() {
    if (!pending) {
      pending = setTimeout(function () { pending = 0; sync(); }, 60);
    }
  }
  function start() {
    sync();
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
