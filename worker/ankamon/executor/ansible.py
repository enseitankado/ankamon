# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Ansible'a ince sarmalayıcı (ad-hoc + --tree).

Yetkili uzaktan bakım içindir: tahtalara erişim bilgileri (kullanıcı/parola) yöneticinin arayüzde
tanımladığı ayarlardan gelir ([[tiha-features]]: TiHA yalnız root ve etapadmin'e SSH izni verir).
Her tahtada verilen kabuk betiğini (``ansible.builtin.script``) çalıştırır.

Sonuç ``--tree`` ile tahta başına JSON dosyasına yazılır; bu ansible-core'un kendi özelliğidir ve ek
koleksiyon (ansible.posix json callback) gerektirmez. Dosyalardan çıkış kodu + çıktı okunur.

**Canlı sonuç**: ansible'ın "tree" callback eklentisi (ansible/plugins/callback/tree.py)
``v2_runner_on_ok``/``_on_failed``/``_on_unreachable`` olaylarında, o tahtanın görevi biter bitmez
(TÜM tahtalar değil, yalnız O tahta) dosyayı diske yazar — yani ağaç dizini ansible süreci HÂLÂ
ÇALIŞIRKEN tahta tahta dolar. ``run()`` bunu kullanır: süreci ``subprocess.run`` ile bloke etmek
yerine ``Popen`` ile başlatıp ağaç dizinini kısa aralıklarla yoklar, yeni beliren her dosyayı hemen
okuyup (varsa) ``on_result(board_id, result)`` ile çağırana anında bildirir — çağıran (jobs.py) bunu
``job_targets``'a o anda yazar, en yavaş tahtayı beklemeden.
"""

from __future__ import annotations

import json
import logging
import os
import shlex
import stat
import subprocess
import tempfile
import time

log = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 10


def _inventory(hosts: list[dict], user: str, password: str) -> str:
    """Hedef tahtalardan geçici bir INI envanteri üretir. Satır: board_<id> ansible_host=<ip>."""
    lines = ["[boards]"]
    for host in hosts:
        lines.append(f"board_{host['id']} ansible_host={host['ip']}")
    lines += [
        "",
        "[boards:vars]",
        f"ansible_user={user}",
        f"ansible_password={password}",
        "ansible_connection=ssh",
        "ansible_python_interpreter=auto_silent",
        # İmajdan çıkan tahtaların anahtarları ilk açılışta değişir; bilinen_hosts denetimi kapalı.
        "ansible_ssh_common_args=-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "
        f"-o ConnectTimeout={_CONNECT_TIMEOUT}",
    ]
    return "\n".join(lines) + "\n"


def _wrapper(body: str, env: dict | None) -> str:
    """Çalıştırılacak betiği; başına ortam değişkeni atamaları eklenmiş, shebang'li hâliyle üretir."""
    lines = ["#!/bin/bash"]
    for key, value in (env or {}).items():
        lines.append(f"export {key}={shlex.quote(str(value))}")
    lines.append(body)
    return "\n".join(lines) + "\n"


_POLL_SECONDS = 1.0


def run(hosts: list[dict], user: str, password: str, *, body: str,
        env: dict | None = None, timeout: int = 120, on_result=None) -> dict[int, dict]:
    """``body`` kabuk betiğini her tahtada çalıştırır.

    Süreç devam ederken ağaç dizinini yoklar; bir tahtanın sonucu belirir belirmez (varsa)
    ``on_result(board_id, result)`` ile anında bildirir — ``on_result`` None ise yalnız dönüş
    değeri üzerinden (eskisi gibi, iş bitince toplu) kullanılabilir (bkz. board_identity.py).

    Döner: board_id → {"status": ok|failed|unreachable, "rc": int|None, "output": str}.
    """
    results: dict[int, dict] = {
        host["id"]: {"status": "failed", "rc": None, "output": "Ansible sonucu alınamadı."}
        for host in hosts
    }
    with tempfile.TemporaryDirectory(prefix="tiha-job-") as workdir:
        inv = os.path.join(workdir, "inventory.ini")
        script = os.path.join(workdir, "run.sh")
        tree = os.path.join(workdir, "tree")
        with open(inv, "w", encoding="utf-8") as f:
            f.write(_inventory(hosts, user, password))
        with open(script, "w", encoding="utf-8") as f:
            f.write(_wrapper(body, env))
        os.chmod(script, os.stat(script).st_mode | stat.S_IEXEC)

        cmd = ["ansible", "boards", "-i", inv, "--tree", tree,
               "-m", "ansible.builtin.script", "-a", script,
               "-f", "20"]  # en çok 20 tahtaya paralel
        deadline = time.monotonic() + timeout * max(1, len(hosts)) + 60
        pending = {host["id"] for host in hosts}

        def collect(final: bool) -> None:
            # final=False iken ağaç dosyası var ama henüz tam yazılmamışsa (tree callback'in
            # open+write'ı arasına denk gelindiyse) sessizce atlanır, bir sonraki yoklamada tekrar
            # denenir — yarım dosyayı "okunamadı" diye yanlış yere kalıcı başarısız yazmamak için.
            for board_id in list(pending):
                path = os.path.join(tree, f"board_{board_id}")
                if not os.path.exists(path):
                    continue
                try:
                    with open(path, encoding="utf-8") as f:
                        raw = json.load(f)
                except (OSError, json.JSONDecodeError):
                    if not final:
                        continue
                    result = {"status": "failed", "rc": None, "output": "Sonuç dosyası okunamadı."}
                else:
                    result = _parse_result(raw)
                results[board_id] = result
                pending.discard(board_id)
                if on_result:
                    on_result(board_id, result)

        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            while pending and proc.poll() is None:
                if time.monotonic() > deadline:
                    proc.kill()
                    break
                time.sleep(_POLL_SECONDS)
                collect(final=False)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
        collect(final=True)  # süreç bitti/öldürüldü: son kez kesin karar ver (geç yazılmış dosyalar dahil)

        for board_id in pending:
            timed_out = {"status": "failed", "rc": None, "output": "İşlem zaman aşımına uğradı."}
            results[board_id] = timed_out
            if on_result:
                on_result(board_id, timed_out)
    return results


def _parse_result(res: dict) -> dict:
    """``--tree`` JSON dosyasının (zaten yüklenmiş) içeriğini board sonucuna çevirir."""
    if res.get("unreachable"):
        return {"status": "unreachable", "rc": None,
                "output": (res.get("msg") or "Tahtaya bağlanılamadı.")[:4000]}
    rc = res.get("rc")
    stdout = (res.get("stdout") or "").strip()
    # SSH'ın her bağlantıda bastığı zararsız "Shared connection ... closed" satırı çıktıdan ayıklanır.
    stderr = "\n".join(
        line for line in (res.get("stderr") or "").splitlines()
        if line.strip() and "Shared connection" not in line
    ).strip()
    output = (stdout + ("\n" + stderr if stderr else "")).strip() or res.get("msg", "")
    failed = res.get("failed") or (rc not in (0, None))
    return {"status": "failed" if failed else "ok", "rc": rc, "output": output[:8000]}
