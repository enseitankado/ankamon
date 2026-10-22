/**
 * Toplu dağıtma/toplamanın tarayıcı tarafı (bkz. ui.files.BulkWindow, worker/tihamon/files/bulk.py):
 * bu bilgisayardan dosya/klasör seçme ve sürükle-bırak, sunucuya akışlı yükleme (ilerlemeli), toplananları
 * arşiv olarak indirme ya da seçilen bir klasöre tek tek kaydetme (File System Access API — Chromium
 * tabanlı tarayıcılar, HTTPS).
 *
 * Seçilen her öğe {rel, file}: rel = hedefteki göreli yol ("rapor.pdf", "Ödevler/1/a.png").
 */
qx.Class.define("tihamon.ui.files.BulkIo", {
  type: "static",

  statics: {
    /** Bu tarayıcı "klasöre kaydet" kipini destekliyor mu? */
    canSaveToFolder() {
      return typeof window.showDirectoryPicker === "function" && window.isSecureContext;
    },

    /**
     * Dosya seçme penceresi açar.
     * @param folder {Boolean} true: bir klasör (alt klasörleriyle) seçilir
     * @return {Promise<Array>} [{rel, file}] (vazgeçilirse boş)
     */
    pick(folder) {
      return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        if (folder) {
          input.webkitdirectory = true;
        }
        input.style.display = "none";
        input.addEventListener("change", () => {
          const list = Array.from(input.files || []).map(file => ({ rel: file.webkitRelativePath || file.name, file }));
          input.remove();
          resolve(list);
        });
        input.addEventListener("cancel", () => {
          input.remove();
          resolve([]);
        });
        document.body.appendChild(input);
        input.click();
      });
    },

    /**
     * Sürükle-bırakla gelen öğeleri (klasörler dahil, özyinelemeli) okur.
     * @param dataTransfer {DataTransfer} drop olayının verisi
     * @return {Promise<Array>} [{rel, file}]
     */
    async fromDrop(dataTransfer) {
      const entries = Array.from(dataTransfer.items || [])
        .map(item => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
        .filter(Boolean);
      if (!entries.length) {
        return Array.from(dataTransfer.files || []).map(file => ({ rel: file.name, file }));
      }
      const out = [];
      const walk = async (entry, prefix) => {
        if (entry.isFile) {
          const file = await new Promise((ok, fail) => entry.file(ok, fail));
          out.push({ rel: prefix + entry.name, file });
          return;
        }
        const reader = entry.createReader();
        // readEntries her çağrıda en çok ~100 girdi döner: boş dönene dek tekrarlanır.
        for (;;) {
          const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
          if (!batch.length) {
            break;
          }
          for (const child of batch) {
            await walk(child, prefix + entry.name + "/");
          }
        }
      };
      for (const entry of entries) {
        await walk(entry, "");
      }
      return out;
    },

    /**
     * Seçilen dosyaları sunucudaki yükleme alanına gönderir (dosya başına bir PUT, akış).
     * @param items {Array} [{rel, file}]
     * @param onProgress {Function} (gönderilen bayt, toplam bayt)
     * @param isCancelled {Function} true dönerse yükleme durur
     * @return {Promise<String>} yükleme jetonu (dağıtma isteğinde kullanılır)
     */
    async upload(items, onProgress, isCancelled) {
      const total = items.reduce((sum, it) => sum + it.file.size, 0);
      // Toplam önceden bildirilir: sunucuda yer yoksa yükleme hiç başlamaz (yarıda dolmaz).
      const { token } = await tihamon.ui.files.Api.post("/bulk/upload", { total });
      let done = 0;
      for (const item of items) {
        if (isCancelled()) {
          throw new Error("Yükleme iptal edildi.");
        }
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", `/files-api/bulk/upload/${token}?` + new URLSearchParams({ path: item.rel }).toString());
          xhr.setRequestHeader("X-Requested-With", "tihamon");
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.upload.onprogress = e => onProgress(done + e.loaded, total);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
              return;
            }
            let msg = tihamon.ui.files.Api.describe(xhr.status);
            try {
              msg = JSON.parse(xhr.responseText).error || msg;
            } catch (e) {
              // gövde JSON değil (ör. nginx'in kendi hata sayfası): açıklama durum kodundan
            }
            reject(new Error(`Yüklenemedi: ${item.rel} — ${msg}`));
          };
          xhr.onerror = () => reject(new Error(`Yüklenemedi: ${item.rel} — ${tihamon.ui.files.Api.describe(0)}`));
          xhr.send(item.file);
        });
        done += item.file.size;
        onProgress(done, total);
      }
      return token;
    },

    /** Toplananları arşiv olarak indirir (tarayıcının indirme yöneticisiyle; sunucuda akış). */
    download(jobId, fmt) {
      const a = document.createElement("a");
      a.href = `/files-api/bulk/${jobId}/archive?fmt=${fmt}`;
      a.download = "";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    },

    /** Klasör seçtirir (kullanıcı hareketi içinde çağrılmalı). @return {Promise<FileSystemDirectoryHandle|null>} */
    async pickFolder() {
      try {
        return await window.showDirectoryPicker({ id: "tihamon-collect", mode: "readwrite" });
      } catch (e) {
        return null; // vazgeçildi
      }
    },

    /**
     * Toplananları seçilen klasöre "<tahta>/<kullanıcı>/…" yapısıyla tek tek yazar (4 dosya paralel).
     * @param onProgress {Function} (yazılan bayt, toplam bayt, dosya sayısı, toplam dosya)
     * @return {Promise<Array>} yazılamayan dosyalar [{path, error}]
     */
    async saveToFolder(jobId, dirHandle, onProgress) {
      const { files } = await tihamon.ui.files.Api.request("GET", `/bulk/${jobId}/manifest`);
      const total = files.reduce((sum, f) => sum + f.size, 0);
      let bytes = 0;
      let count = 0;
      const failed = [];
      const dirs = new Map();
      const dirFor = async parts => {
        let handle = dirHandle;
        let key = "";
        for (const part of parts) {
          key += "/" + part;
          if (!dirs.has(key)) {
            dirs.set(key, handle.getDirectoryHandle(part, { create: true }));
          }
          handle = await dirs.get(key);
        }
        return handle;
      };
      const queue = files.slice();
      const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          try {
            const parts = f.path.split("/");
            const name = parts.pop();
            const dir = await dirFor(parts);
            const response = await fetch(`/files-api/bulk/${jobId}/file?` + new URLSearchParams({ path: f.path }).toString(),
              { credentials: "same-origin" });
            if (!response.ok) {
              throw new Error(`sunucu ${response.status}`);
            }
            const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              await writable.write(value);
              bytes += value.length;
              onProgress(bytes, total, count, files.length);
            }
            await writable.close();
          } catch (e) {
            failed.push({ path: f.path, error: e.message || String(e) });
          }
          count++;
          onProgress(bytes, total, count, files.length);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      return failed;
    }
  }
});
