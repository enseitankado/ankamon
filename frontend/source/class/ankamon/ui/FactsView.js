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
 * "Bilgi kartı"nın içeriği: bir tahtanın facts'ini (bkz. worker/ankamon/executor/hwfacts.py _FIELDS)
 * bölümlere ayrılmış bir HTML tablosuna çevirir. Hem pencere (rich Label) hem "Yazdır" sayfası aynı
 * HTML'i kullanır — biri değişince öteki de değişsin diye tek kaynak.
 * Durum bilgileri (boş disk, wifi bağlantısı, açık kalma süresi, sıcaklık) toplandıkları ana aittir.
 */
qx.Class.define("ankamon.ui.FactsView", {
  type: "static",

  statics: {
    // nmcli device STATE değerleri (LC_ALL=C).
    WIFI_STATE: {
      connected: "Bağlı",
      disconnected: "Bağlı değil",
      unavailable: "Kullanılamıyor",
      unmanaged: "Yönetilmiyor",
      connecting: "Bağlanıyor",
      "connecting (configuring)": "Bağlanıyor",
      "connecting (getting IP configuration)": "Bağlanıyor (IP alınıyor)"
    },

    // Pencere ve yazdırma sayfası için ortak görünüm (rich Label içinde <style> çalışmaz — satır içi).
    __TABLE: "border-collapse:collapse;width:100%",
    __SECTION: "padding:8px 0 2px;font-weight:bold;border-bottom:1px solid #ccc",
    __KEY: "padding:2px 12px 2px 0;white-space:nowrap;vertical-align:top;opacity:.75;width:1%",
    __VAL: "padding:2px 0;vertical-align:top",

    /** Gün de içeren süre (F.duration yalnız saat/dakika yazar: 3 gün → "72 sa"). */
    __uptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const rest = ankamon.util.Format.duration(seconds % 86400);
      return days ? `${days} gün ${rest}` : rest;
    },

    /**
     * RAM metni (Bilgi kartı, Tahtalar grid'i, Ekranlar donanım satırı ortak): TAKILI bellek (SMBIOS,
     * mem_installed_bytes — "8 GB DDR3"); henüz toplanmamışsa işletim sisteminin gördüğü MemTotal
     * (~7.2 GB). Takılı değer GiB tam sayıysa ondalıksız yazılır. Tümleşik (paylaşımlı) grafik
     * RAM'den pay ayırıyorsa (gpu_shared_bytes — bkz. worker executor/hwfacts.py) o da eklenir.
     * @param withType {Boolean?} bellek türü (DDR3…) ve paylaşımlı ekran belleği — varsayılan evet
     *   (Tahtalar grid'inin dar RAM sütunu yalnız boyutu ister)
     */
    ramText(f, withType = true) {
      if (f.mem_installed_bytes) {
        const gib = f.mem_installed_bytes / 1073741824;
        const size = (Number.isInteger(gib) ? gib : gib.toFixed(1)) + " GB";
        if (!withType) {
          return size;
        }
        const shared = f.gpu_shared_bytes
          ? ` (${f.gpu_shared_bytes >= 1073741824 ? (f.gpu_shared_bytes / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB"
            : Math.round(f.gpu_shared_bytes / 1048576) + " MB"} ekran belleği)` : "";
        return (f.mem_type ? `${size} ${f.mem_type}` : size) + shared;
      }
      return f.mem_total_bytes ? ankamon.util.Format.bytes(f.mem_total_bytes) : "";
    },

    /**
     * Wi-Fi kartının etkin olup olmadığı — Bilgi kartı ve Tahtalar grid'inin "Wi-Fi" sütunu aynı
     * kuralı kullanır. Etkin = kart var + NetworkManager radyosu açık + rfkill engeli yok (actions/
     * wifi-on, wifi-off radyoyu değiştirir; runner işlemden sonra facts'i günceller).
     * @return {Map|null} {text, kind} — kind: ok | idle | bad; bilgi hiç toplanmamışsa null
     */
    wifiStatus(f) {
      if (!f || !("wifi_iface" in f)) {
        return null;
      }
      if (!f.wifi_iface) {
        return { text: "Kart yok", kind: "idle" };
      }
      if (f.wifi_blocked === "hard") {
        return { text: "Devre dışı (donanım anahtarı/BIOS)", kind: "bad" };
      }
      if (f.wifi_blocked === "soft" || f.wifi_radio === "disabled") {
        return { text: "Devre dışı", kind: "idle" };
      }
      if (f.wifi_radio === "enabled") {
        return { text: f.wifi_state === "connected" ? "Etkin · bağlı" : "Etkin", kind: "ok" };
      }
      return { text: "Bilinmiyor", kind: "idle" };
    },

    /** Durum rozetinin rengi: ok=yeşil, warn=turuncu, bad=kırmızı, idle=gri. */
    __badge(text, kind) {
      const color = { ok: "#1e8e3e", warn: "#e37400", bad: "#c5221f", idle: "#80868b" }[kind] || "#80868b";
      return `<span style="color:${color};font-weight:bold">●</span> ${qx.bom.String.escape(text)}`;
    },

    // Sensör göstergeleri (bkz. backend Core/BoardSensors.php): [anahtar, etiket, birim, ondalık, uyarı, kritik, alt eşik mi].
    __SENSORS: [
      ["cpu_temp", "İşlemci sıcaklığı", "°C", 0, 70, 85, false],
      ["board_temp", "Anakart sıcaklığı", "°C", 0, 50, 60, false],
      ["acpi_temp", "Kasa içi (ACPI)", "°C", 0, 50, 60, false],
      ["disk_temp", "Disk sıcaklığı", "°C", 0, 50, 60, false],
      ["fan_rpm", "İşlemci fanı", "RPM", 0, null, null, false],
      ["battery_v", "CMOS pili", "V", 2, 2.8, 2.5, true]
    ],

    /**
     * "Sensörler" bölümünün satırları: anlık değer + saklanan geçmişteki en düşük/en yüksek (ve ne zaman).
     * @param sensors {Map|null|undefined} /api/metrics/{id}/sensors yanıtı; undefined = yükleniyor
     */
    __sensorRows(sensors, row) {
      if (sensors === undefined) {
        row("Durum", "Yükleniyor…");
        return;
      }
      const keys = Object.keys(sensors || {});
      if (!keys.length) {
        row("Durum", "Sensör verisi yok (tahta kapalı ya da sensör portu okunamıyor)");
        return;
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      this.__SENSORS.forEach(([key, label, unit, digits, warn, crit, low]) => {
        const s = sensors[key];
        if (!s) {
          return;
        }
        const fmt = v => `${Number(v).toFixed(digits)} ${unit}`;
        const kind = v => warn === null ? "ok"
          : low ? (v <= crit ? "bad" : v <= warn ? "warn" : "ok") : (v >= crit ? "bad" : v >= warn ? "warn" : "ok");
        const when = t => (t ? ` <span style="opacity:.6">(${esc(F.dateTime(t * 1000).slice(0, 16))})</span>` : "");
        const now = s.value === null ? '<span style="opacity:.6">şu an ölçüm yok</span>' : this.__badge(fmt(s.value), kind(s.value));
        const range = s.min === null ? "" : ` &nbsp;·&nbsp; en düşük ${esc(fmt(s.min))}${when(s.min_at)}` +
          ` &nbsp;·&nbsp; en yüksek ${esc(fmt(s.max))}${when(s.max_at)}`;
        row(label, { html: now + range });
      });
      if (!sensors.fan_rpm && !sensors.battery_v) {
        row("Not", "Fan devri, CMOS pili ve anakart sıcaklığı için \"Fan/pil/anakart sensörlerini etkinleştir\" işlemini çalıştırın");
      }
    },

    /** GUID, UUID, aygıt yolu gibi makine değerleri: eşit aralıklı yazı (kaçırılmış HTML). */
    __mono(text) {
      return `<span style="font-family:monospace">${qx.bom.String.escape(String(text))}</span>`;
    },

    /** Yüzde boş alanın rozeti: %10 altı kırmızı, %20 altı turuncu. */
    __freeBadge(free, total) {
      const F = ankamon.util.Format;
      const pct = Math.round(100 * free / total);
      return this.__badge(`${F.bytes(free)} boş / ${F.bytes(total)} (%${pct})`, pct < 10 ? "bad" : pct < 20 ? "warn" : "ok");
    },

    /**
     * Disk başına bir bölüm: kimlik, bölüm tablosu (GPT disk GUID'i / MBR imzası, LBA aralığı,
     * bölümlenmemiş alan, GPT denetimi, MBR açılış kodu) ve her bölümün GUID'leri, dosya sistemi ve
     * boş alanı (bkz. worker executor/hwfacts.py _disk_layout).
     */
    __diskLayoutRows(disks, section, row) {
      if (!Array.isArray(disks)) {
        return;
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const join = (...parts) => parts.filter(p => p !== null && p !== undefined && p !== "").join(" · ");
      const has = v => v !== null && v !== undefined;
      disks.forEach(d => {
        section(`Disk ${d.path || d.name} — bölüm tablosu ve bölümler`);
        row("Aygıt", join(d.model, d.size ? F.bytes(d.size) : null,
          d.rota === false ? "SSD" : d.rota === true ? "HDD" : null, d.tran ? d.tran.toUpperCase() : null,
          d.rm ? "çıkarılabilir" : null, d.ro ? "salt okunur" : null));
        row("Seri no / firmware", join(d.serial, d.rev ? "firmware " + d.rev : null));
        row("WWN", d.wwn ? { html: this.__mono(d.wwn) } : null);
        row("Sektör boyutu", d.log_sec ? `${d.log_sec} B mantıksal / ${d.phy_sec || "?"} B fiziksel` : null);
        const gpt = d.pttype === "gpt";
        row("Bölüm tablosu", d.pttype ? (gpt ? "GPT" : d.pttype === "dos" ? "MBR (DOS)" : d.pttype.toUpperCase())
          : (d.fs ? "yok (disk doğrudan dosya sistemi taşıyor)" : "yok"));
        row(gpt ? "Disk GUID" : "Disk imzası", d.ptuuid ? { html: this.__mono(d.ptuuid) } : null);
        row("Kullanılabilir LBA", gpt && has(d.first_lba) ? `${d.first_lba.toLocaleString("tr-TR")} – ${d.last_lba.toLocaleString("tr-TR")}` : null);
        row("Bölümlenmemiş alan", has(d.free_bytes) ? (d.free_bytes ? F.bytes(d.free_bytes) : "yok") : null);
        if (d.gpt_check) {
          const ok = /No problems found/.test(d.gpt_check);
          row("GPT denetimi", { html: this.__badge(ok ? "Sorun yok (birincil/yedek başlık ve tablo tutarlı)" : d.gpt_check, ok ? "ok" : "bad") });
        }
        row("MBR açılış kodu", { empty: "boş (legacy önyükleyici yok)", grub: "GRUB (legacy/BIOS açılışı)", other: "var (GRUB dışı)" }[d.mbr_code] || null);
        if (d.fs) {
          row("Dosya sistemi", join(d.fs.fstype, d.fs.uuid, d.fs.mount));
        }
        (d.partitions || []).forEach(p => {
          const lines = [];
          lines.push(join(`<b>${esc(p.type_name || p.type_guid || "bölüm")}</b>`, p.size ? esc(F.bytes(p.size)) : null,
            p.fstype ? esc(join(p.fstype, p.fsver)) : "dosya sistemi yok",
            p.label ? `etiket "${esc(p.label)}"` : null,
            p.mount ? `bağlı: ${this.__mono(p.mount)}` : "bağlı değil",
            p.bootable ? "etkin (açılış) bölümü" : null));
          if (p.fs_size && has(p.fs_avail)) {
            lines.push(this.__freeBadge(p.fs_avail, p.fs_size) + (has(p.fs_used) ? ` &nbsp;·&nbsp; dolu ${esc(F.bytes(p.fs_used))}` : ""));
          }
          lines.push(join(p.part_uuid ? "Bölüm GUID " + this.__mono(p.part_uuid) : null,
            p.part_label ? `ad "${esc(p.part_label)}"` : null));
          lines.push(join(p.type_guid ? (gpt ? "Tür GUID " : "Tür ") + this.__mono(p.type_guid) : null,
            p.attrs ? "öznitelikler " + esc(p.attrs) : null, p.flags ? "bayraklar " + this.__mono(p.flags) : null));
          lines.push(join(p.uuid ? "Dosya sistemi UUID " + this.__mono(p.uuid) : null,
            has(p.start) ? `başlangıç sektörü ${p.start.toLocaleString("tr-TR")}` : null,
            p.sectors ? `${p.sectors.toLocaleString("tr-TR")} sektör` : null));
          (p.holders || []).forEach(h => lines.push("İçinde: " + esc(join(h.name, h.type, h.fstype, h.uuid, h.mount))));
          row(p.name, { html: lines.filter(Boolean).join("<br>") });
        });
      });
    },

    /**
     * "UEFI / önyükleme": firmware kipi ve sürümü, Secure Boot, değişken deposu (NVRAM) doluluğu, açılış
     * sırası ve girdileri (hangi bölümden açıldığı), EFI bölümündeki önyükleyiciler, TPM, çekirdek komut
     * satırı (bkz. worker executor/hwfacts.py _firmware_boot).
     */
    __firmwareRows(fw, cmdline, section, row, disks) {
      if (!fw) {
        return;
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const join = (...parts) => parts.filter(p => p !== null && p !== undefined && p !== "").join(" · ");
      section("UEFI / önyükleme");
      row("Firmware kipi", fw.mode === "uefi"
        ? join("UEFI" + (fw.bits ? ` (${fw.bits} bit)` : ""), fw.efi_version ? "EFI " + fw.efi_version : null, fw.efi_vendor)
        : fw.mode === "legacy" ? "Legacy BIOS (CSM) — işletim sistemi UEFI değişkenlerini okuyamaz" : null);
      if (fw.secure_boot !== null && fw.secure_boot !== undefined) {
        row("Secure Boot", { html: this.__badge(fw.secure_boot ? "Açık" : "Kapalı", fw.secure_boot ? "ok" : "idle") });
      }
      if (fw.setup_mode !== null && fw.setup_mode !== undefined) {
        row("Anahtar kipi", fw.setup_mode ? "Kurulum kipi (Setup Mode — platform anahtarı PK yüklü değil)" : "Kullanıcı kipi (PK yüklü)");
      }
      if (fw.store_total) {
        const usedPct = Math.round(100 * fw.store_used / fw.store_total);
        row("Değişken deposu (NVRAM)", {
          html: this.__freeBadge(fw.store_free, fw.store_total) + ` &nbsp;·&nbsp; dolu ${esc(F.bytes(fw.store_used))}` +
            "<br>" + this.__bar(usedPct) + ` %${usedPct} dolu`
        });
      }
      const entries = fw.boot_entries || [];
      const desc = num => (entries.find(e => e.num === num) || {}).desc;
      if (fw.boot_order && fw.boot_order.length) {
        row("Açılış sırası", fw.boot_order.map(n => `${n} ${desc(n) || ""}`.trim()).join("  →  "));
      }
      row("Şu an açılan", fw.boot_current ? join("Boot" + fw.boot_current, desc(fw.boot_current)) : null);
      row("Sonraki açılış (BootNext)", fw.boot_next ? join("Boot" + fw.boot_next, desc(fw.boot_next)) : null);
      row("Menü bekleme süresi", fw.timeout !== null && fw.timeout !== undefined ? `${fw.timeout} sn` : null);
      entries.forEach(e => {
        const head = `<b>${esc(e.desc || "(adsız)")}</b>` + (e.active ? "" : " (devre dışı)") +
          (e.num === fw.boot_current ? " · " + this.__badge("şu an bu girdiden açıldı", "ok") : "");
        const path = e.path ? "<br>" + this.__mono(e.path) : "";
        const part = e.part ? `<br>→ ${this.__mono(e.part)}${e.part_type ? " (" + esc(e.part_type) + ")" : ""}` : "";
        const match = this.__bootEntryMatch(e, fw, disks);
        row("Boot" + e.num, { html: head + path + part + (match ? "<br>" + match : "") });
      });
      row("EFI bölümündeki önyükleyiciler", fw.esp_dirs ? fw.esp_dirs.map(d => "EFI/" + d).join(", ") : null);
      const t = fw.tpm;
      if (t) {
        const flag = (v, yes, no) => (v === true ? yes : v === false ? no : null);
        row("TPM", join("TPM " + (t.version || "?"), t.maker, t.firmware ? "firmware " + t.firmware : null,
          flag(t.enabled, "etkin", "devre dışı (BIOS'ta kapalı)"), flag(t.active, "aktif", "aktif değil"),
          flag(t.owned, "sahiplenilmiş", "sahipsiz")));
      } else if (fw.mode) {
        row("TPM", "bulunamadı");
      }
      if (cmdline) {
        const rootMatch = this.__rootMatch(cmdline, disks);
        row("Çekirdek komut satırı", { html: this.__mono(cmdline) + (rootMatch ? "<br>" + rootMatch : "") });
      }
    },

    /** Yatay doluluk çubuğu (yeşil); yazdırmada da renkli basılır. */
    __bar(pct, color = "#1e8e3e") {
      const w = Math.max(0, Math.min(100, pct));
      return '<span style="display:inline-block;width:240px;height:10px;border:1px solid #9aa0a6;border-radius:3px;' +
        'vertical-align:middle;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact">' +
        `<span style="display:block;width:${w}%;height:100%;background:${color}"></span></span>`;
    },

    /** Bölüm numarası aygıt adından: sda1 → 1, nvme0n1p2 → 2, mmcblk0p1 → 1. */
    __partNumber(name) {
      const m = /(\d+)$/.exec(name || "");
      return m ? Number(m[1]) : null;
    },

    /**
     * Açılış girdisinin aygıt yolundaki disk/bölüm kimliğini tahtanın diskleriyle karşılaştırır.
     * HD(numara, GPT, <bölüm GUID'i>, başlangıç, boyut) — MBR'de üçüncü alan disk imzası. Firmware girdiyi
     * bu kimlikle bulur: bölüm GUID'i diskte yoksa, konumu/boyutu değiştiyse ya da File(…) önyükleyicisi EFI
     * bölümünde yoksa girdi AÇILAMAZ (tahta açılışta "önyüklenebilir aygıt yok"a düşer ya da sonraki girdiye
     * geçer). "uyuşmuyor" yalnız bu açılamama riskinde yazılır; uyuşuyorsa yeşil teyit.
     * @return {String|null} rozet HTML'i; yolda disk kimliği yoksa (BBS, ağ, kabuk) null
     */
    __bootEntryMatch(e, fw, disks) {
      const m = /HD\((\d+),(GPT|MBR),([^,]+),(0x[0-9a-fA-F]+),(0x[0-9a-fA-F]+)\)/.exec(e.path || "");
      if (!m || !Array.isArray(disks)) {
        return null;
      }
      const [, num, kind, id, start, size] = m;
      let hit = null;
      if (kind === "GPT") {
        disks.forEach(d => (d.partitions || []).forEach(p => {
          if ((p.part_uuid || "").toLowerCase() === id.toLowerCase()) {
            hit = { d, p };
          }
        }));
      } else {
        const disk = disks.find(d => d.pttype === "dos" && d.ptuuid && parseInt(d.ptuuid, 16) === parseInt(id, 16));
        const p = disk && (disk.partitions || []).find(x => this.__partNumber(x.name) === Number(num));
        hit = p ? { d: disk, p } : null;
      }
      const what = kind === "GPT" ? "disk/bölüm GUID'i" : "disk imzası (MBR)";
      if (!hit) {
        return this.__badge(`${what} ile uyuşmuyor — bu kimlik tahtanın hiçbir diskinde yok: firmware bu ` +
          "girdiden açamaz (disk değişmiş ya da yeniden bölümlenmiş)", "bad");
      }
      const problems = [];
      if (this.__partNumber(hit.p.name) !== Number(num)) {
        problems.push(`bölüm numarası girdide ${num}, diskte ${this.__partNumber(hit.p.name)}`);
      }
      if (hit.p.start !== null && hit.p.start !== undefined && parseInt(start, 16) !== hit.p.start) {
        problems.push(`başlangıç sektörü girdide ${parseInt(start, 16)}, diskte ${hit.p.start}`);
      }
      if (hit.p.sectors && parseInt(size, 16) !== hit.p.sectors) {
        problems.push(`boyut girdide ${parseInt(size, 16)}, diskte ${hit.p.sectors} sektör`);
      }
      const file = /File\(([^)]*)\)/.exec(e.path);
      let fileNote = "";
      if (file && Array.isArray(fw.esp_files) && hit.p.mount === "/boot/efi") {
        // FAT büyük/küçük harf ayırmaz; firmware yolu ters bölüyle yazar.
        const want = file[1].replace(/\\/g, "/").toLowerCase();
        if (fw.esp_files.some(f => f.toLowerCase() === want)) {
          fileNote = " · önyükleyici dosyası EFI bölümünde var";
        } else {
          problems.push(`önyükleyici dosyası (${file[1]}) EFI bölümünde yok`);
        }
      }
      const where = `${hit.p.path}${hit.d.path ? " (" + hit.d.path + ")" : ""}`;
      if (problems.length) {
        return this.__badge(`${what} ile uyuşmuyor — ${problems.join("; ")}: firmware bu girdiden ` +
          "açamayabilir", "bad");
      }
      return this.__badge(`${what} ile uyuşuyor — ${where}, başlangıç ve boyut aynı${fileNote}`, "ok");
    },

    /**
     * Çekirdek komut satırındaki root=UUID=… / root=PARTUUID=… değerini disklerdeki dosya sistemi/bölüm
     * kimlikleriyle karşılaştırır: bulunamazsa sonraki açılışta çekirdek kök dosya sistemini bulamaz.
     */
    __rootMatch(cmdline, disks) {
      const m = /(?:^|\s)root=(UUID|PARTUUID)=(\S+)/.exec(cmdline || "");
      if (!m || !Array.isArray(disks)) {
        return null;
      }
      const [, kind, id] = m;
      const parts = [];
      disks.forEach(d => (d.partitions || []).forEach(p => parts.push(p)));
      const key = kind === "UUID" ? "uuid" : "part_uuid";
      const label = kind === "UUID" ? "disk/bölüm UUID'si (kök dosya sistemi)" : "disk/bölüm GUID'i (kök bölüm)";
      const p = parts.find(x => (x[key] || "").toLowerCase() === id.toLowerCase());
      if (!p) {
        return this.__badge(`${label} ile uyuşmuyor — bu kimlikte dosya sistemi yok: çekirdek kök dosya ` +
          "sistemini bulamaz, açılış durur", "bad");
      }
      if (p.mount !== "/") {
        return this.__badge(`${label} ile uyuşmuyor — kimlik ${p.path} bölümünde ama kök (/) oraya bağlı ` +
          "değil: sonraki açılışta başka bir sistem açılabilir", "bad");
      }
      return this.__badge(`${label} ile uyuşuyor — ${p.path} (/)`, "ok");
    },

    /**
     * "UEFI değişkenleri": firmware'in NVRAM'deki tüm değişkenleri — ad, üretici GUID'i, boyut,
     * öznitelikler, değiştirilemez mi (🔒) ve değer (standart olanlar çözülür, ötekiler ilk baytlar).
     */
    __uefiVarRows(vars, section, row) {
      if (!Array.isArray(vars) || !vars.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const locked = vars.filter(v => v.immutable).length;
      section(`UEFI değişkenleri (${vars.length})`);
      row("Açıklama", `${vars.length} değişken, ${locked} tanesi değiştirilemez (🔒 — çekirdek bilinmeyen üretici ` +
        "değişkenlerini kazara silinmeye karşı korur). Öznitelikler: NV kalıcı, BS açılış servisi, RT çalışma zamanı, " +
        "AUTH imzalı yazma. Değer: standart değişkenler çözülür, ötekilerin ilk baytları onaltılık.");
      vars.forEach(v => {
        const parts = [v.vendor ? esc(v.vendor) : this.__mono(v.guid)];
        if (v.size !== null && v.size !== undefined) {
          parts.push(`${v.size.toLocaleString("tr-TR")} B`);
        }
        if (v.attrs) {
          parts.push(esc(v.attrs));
        }
        if (v.value) {
          parts.push(this.__mono(v.value));
        }
        row(v.name + (v.immutable ? " 🔒" : ""), { html: parts.join(" · ") });
      });
    },

    /**
     * @param sensors {Map|null|undefined} isteğe bağlı sensör özeti (bkz. __sensorRows); verilmezse bölüm yazılmaz
     * @return {String} facts'in bölümlü HTML tablosu
     */
    html(f, sensors) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const sections = [];
      let rows = null;
      const section = title => {
        rows = [];
        sections.push({ title, rows });
      };
      // value: düz metin (kaçırılır) ya da {html} (zaten güvenli HTML). Boşsa satır hiç yazılmaz.
      const row = (label, value) => {
        if (value === null || value === undefined || value === "") {
          return;
        }
        rows.push([label, typeof value === "object" ? value.html : esc(String(value))]);
      };
      const bytes = v => (v ? F.bytes(v) : null);
      const join = (...parts) => parts.filter(p => p !== null && p !== undefined && p !== "").join(" · ");

      section("Sistem");
      row("İşletim sistemi", join(f.os_name, f.arch));
      row("Çekirdek sürümü", f.kernel_version);
      row("TiHA imajı", f.tiha_version
        ? join("sürüm " + f.tiha_version, f.tiha_prepared_at ? "hazırlanma " + F.dateTime(Date.parse(f.tiha_prepared_at)) : null)
        : null);
      row("Açık kalma süresi", f.uptime_seconds ? this.__uptime(f.uptime_seconds) : null);
      row("Ürün", f.product);
      row("Seri numarası", f.serial);

      section("İşlemci");
      row("Üretici", f.cpu_vendor);
      row("Model", f.cpu_model);
      row("Çekirdek", f.cpu_phys_cores
        ? `${f.cpu_phys_cores} fiziksel çekirdek / ${f.cpu_cores || "?"} iş parçacığı`
        : (f.cpu_cores ? `${f.cpu_cores} iş parçacığı` : null));
      row("Azami hız", f.cpu_max_mhz ? `${(f.cpu_max_mhz / 1000).toFixed(2)} GHz` : null);
      // Sensör bölümü varsa işlemci sıcaklığı orada (canlı, en düşük/en yüksekle) — buradaki toplama anı değeri yazılmaz.
      row("Sıcaklık", f.cpu_temp_c && arguments.length < 2
        ? { html: this.__badge(`${f.cpu_temp_c} °C`, f.cpu_temp_c >= 85 ? "bad" : f.cpu_temp_c >= 70 ? "warn" : "ok") }
        : null);

      if (arguments.length > 1) {
        section("Sensörler");
        this.__sensorRows(sensors, row);
      }

      section("Bellek");
      row("RAM", f.mem_installed_bytes || f.mem_total_bytes
        ? join(ankamon.ui.FactsView.ramText(f, false) + (f.mem_type ? ` ${f.mem_type}` : "") +
            (f.mem_speed ? ` ${f.mem_speed}` : "") + (f.mem_modules > 1 ? ` (${f.mem_modules} modül)` : ""),
          f.gpu_shared_bytes ? `ekran belleği ${bytes(f.gpu_shared_bytes)}` : null,
          f.mem_installed_bytes && f.mem_total_bytes ? `sistemde ${bytes(f.mem_total_bytes)}` : null,
          f.mem_available_bytes ? `kullanılabilir ${bytes(f.mem_available_bytes)}` : null)
        : null);
      row("Takas (swap)", f.swap_total_bytes === 0 ? "yok" : bytes(f.swap_total_bytes));

      section("Disk");
      row("Model", join(f.disk_model,
        f.disk_rotational === 0 ? "SSD" : f.disk_rotational === 1 ? "HDD" : null,
        f.disk_transport ? f.disk_transport.toUpperCase() : null));
      row("Kapasite", bytes(f.disk_total_bytes));
      if (f.root_total_bytes && f.root_free_bytes !== null && f.root_free_bytes !== undefined) {
        const freePct = Math.round(100 * f.root_free_bytes / f.root_total_bytes);
        row("Boş alan (/)", {
          html: this.__badge(`${F.bytes(f.root_free_bytes)} boş / ${F.bytes(f.root_total_bytes)} (%${freePct})`,
            freePct < 10 ? "bad" : freePct < 20 ? "warn" : "ok")
        });
      }

      // SMART (hwfacts._smart): sistem diskinin kendi sağlık kaydı. "Genel sağlık" üreticinin eşik
      // değerlendirmesidir; sayaçlar (yeniden atanmış/bekleyen sektör, düzeltilemeyen hata) sıfırdan
      // büyükse disk eşiği geçmemiş olsa da yıpranma başlamıştır — bu yüzden ayrıca uyarılır.
      section("Disk sağlığı (SMART)");
      if (f.smart_health === undefined) {
        row("Durum", "Bu kayıt SMART eklenmeden önce toplanmış — kart yenilenince gelir");
      } else if (!f.smart_health && f.smart_power_on_hours === null) {
        row("Durum", "SMART okunamadı (smartctl yok ya da disk desteklemiyor)");
      } else {
        const counters = [f.smart_reallocated, f.smart_pending, f.smart_uncorrectable].filter(v => v > 0).length;
        row("Genel sağlık", f.smart_health === "failed"
          ? { html: this.__badge("BAŞARISIZ — disk arızalanmak üzere, yedek alıp değiştirin", "bad") }
          : f.smart_health === "passed"
            ? { html: this.__badge(counters ? "Geçti — ama yıpranma işaretleri var (aşağıda)" : "Geçti", counters ? "warn" : "ok") }
            : null);
        if (f.smart_failing) {
          row("Eşiği geçen öznitelik", { html: this.__badge(f.smart_failing, "bad") });
        }
        row("Kalan ömür (SSD)", f.smart_life_left_pct !== null && f.smart_life_left_pct !== undefined
          ? { html: this.__badge(`%${f.smart_life_left_pct}`, f.smart_life_left_pct < 10 ? "bad" : f.smart_life_left_pct < 30 ? "warn" : "ok") }
          : null);
        const count = (label, v) => row(label, v === null || v === undefined ? null
          : { html: this.__badge(Number(v).toLocaleString("tr-TR"), v > 0 ? "warn" : "ok") });
        count("Yeniden atanmış sektör", f.smart_reallocated);
        count("Bekleyen sektör", f.smart_pending);
        count("Düzeltilemeyen hata", f.smart_uncorrectable);
        row("Çalışma süresi", f.smart_power_on_hours !== null && f.smart_power_on_hours !== undefined
          ? join(`${Number(f.smart_power_on_hours).toLocaleString("tr-TR")} saat`,
            f.smart_power_on_hours >= 48 ? `~${Math.round(f.smart_power_on_hours / 24).toLocaleString("tr-TR")} gün` : null)
          : null);
        row("Açılıp kapanma", f.smart_power_cycles !== null && f.smart_power_cycles !== undefined
          ? `${Number(f.smart_power_cycles).toLocaleString("tr-TR")} kez` : null);
        row("Disk sıcaklığı", f.smart_temp_c
          ? { html: this.__badge(`${f.smart_temp_c} °C`, f.smart_temp_c >= 60 ? "bad" : f.smart_temp_c >= 50 ? "warn" : "ok") }
          : null);
      }

      this.__diskLayoutRows(f.disk_layout, section, row);

      section("Kablolu ağ");
      row("Arayüz", f.eth_iface ? join(f.eth_iface, f.eth_chip) : null);
      row("Durum", f.eth_state
        ? { html: this.__badge(join(f.eth_state === "up" ? "Bağlı" : "Bağlı değil", f.eth_speed_mbps ? `${f.eth_speed_mbps} Mbit/sn` : null),
          f.eth_state === "up" ? "ok" : "idle") }
        : null);
      row("IP adresi", f.eth_ip);

      section("Kablosuz ağ (Wi-Fi)");
      if (!f.wifi_iface) {
        row("Kart", "Wi-Fi kartı bulunamadı");
      } else {
        const status = this.wifiStatus(f);
        row("Wi-Fi", status ? { html: this.__badge(status.text, status.kind) } : null);
        row("Kart", f.wifi_chip);
        row("Arayüz / sürücü", join(f.wifi_iface, f.wifi_driver));
        row("MAC adresi", f.wifi_mac);
        const state = this.WIFI_STATE[f.wifi_state] || f.wifi_state;
        if (f.wifi_state === "connected") {
          row("Durum", {
            html: this.__badge(join("Bağlı", f.wifi_ssid ? `"${f.wifi_ssid}"` : null,
              f.wifi_signal ? `sinyal %${f.wifi_signal}` : null,
              f.wifi_freq ? (Number(f.wifi_freq) >= 5000 ? "5 GHz" : "2,4 GHz") : null), "ok")
          });
          row("IP adresi", f.wifi_ip);
        } else if (state) {
          row("Durum", { html: this.__badge(state, "idle") });
        }
        row("Görünen ağlar", f.wifi_visible !== null && f.wifi_visible !== undefined ? `${f.wifi_visible} ağ` : null);
      }

      section("Ekran ve giriş");
      row("Grafik birimi", f.gpu);
      row("Bağlı ekran", f.screens || null);
      row("Dokunmatik", f.touch);

      section("Anakart / BIOS");
      row("Anakart", join(f.motherboard_model, f.board_version ? "sürüm " + f.board_version : null));
      row("Anakart seri no", f.board_serial);
      row("Ürün sürümü", f.product_version);
      row("Sistem UUID", f.product_uuid ? { html: this.__mono(f.product_uuid) } : null);
      row("BIOS", join(f.bios_vendor, f.bios_version, f.bios_date, f.bios_release ? "revizyon " + f.bios_release : null));

      this.__firmwareRows(f.firmware_boot, f.kernel_cmdline, section, row, f.disk_layout);
      this.__uefiVarRows(f.uefi_vars, section, row);

      const body = sections
        .filter(s => s.rows.length)
        .map(s => `<tr><td colspan="2" style="${this.__SECTION}">${esc(s.title)}</td></tr>` +
          s.rows.map(([k, v]) => `<tr><td style="${this.__KEY}">${esc(k)}</td><td style="${this.__VAL}">${v}</td></tr>`).join(""))
        .join("");
      return `<table style="${this.__TABLE}">${body}</table>`;
    }
  }
});
