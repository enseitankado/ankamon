# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# eta-112 ile BIOS parolalarını okur (yalnız okuma: flash'a yazmaz). Araç runner tarafından /opt/eta-112'ye
# kopyalanmıştır (bkz. worker/ankamon/executor/tools.py). Okunan parolalar iş çıktısına yazılır (işin amacı budur).
set -u
T=/opt/eta-112/eta-112.py
[ -f "$T" ] || { echo "eta-112 tahtada bulunamadı ($T)." >&2; exit 1; }
echo "Araç: eta-112 $(cut -d' ' -f2 /opt/eta-112/VERSION 2>/dev/null | cut -c1-7)"

echo "BIOS okunuyor (gerekirse flashrom/dmidecode kurulur; flash'a yazılmaz)…"
out=$(python3 "$T" bios read --json 2>&1); rc=$?
# JSON çıktının son satırı (araç önce bağımlılık kurulumu vb. satırlar basabilir) okunur ve yazdırılır.
printf '%s' "$out" | python3 -c '
import json, sys
lines = [l for l in sys.stdin.read().splitlines() if l.startswith("{")]
try:
    d = json.loads(lines[-1])
except Exception:
    print("HATA: araç çıktısı okunamadı.", file=sys.stderr)
    sys.exit(3)
if not d.get("ok"):
    if d.get("supported") is False:
        print("DESTEKLENMİYOR: bu model/BIOS sürümü eta-112 ile okunamıyor" + (" — " + d["error"] if d.get("error") else "") + ".", file=sys.stderr)
        sys.exit(2)
    print("HATA: " + str(d.get("error") or "okunamadı"), file=sys.stderr)
    sys.exit(1)
print("Model: %s (kart %s, BIOS %s)" % (d.get("model") or "?", d.get("board") or "?", d.get("bios") or "?"))
print("Yönetici parolası : " + (d.get("supervisor") or "(parola yok)"))
print("Kullanıcı parolası: " + (d.get("user") or "(parola yok)"))
prot = {"always": "her açılışta", "setup": "yalnız BIOS ayarlarına girerken"}.get(d.get("protection"))
if prot:
    print("Parola soruluyor  : " + prot)
prev = d.get("previous") or []
if prev:
    print("Flash bellekte kalan önceki parolalar:")
    for i, p in enumerate(prev, 1):
        print("  %d. Yönetici: %s  Kullanıcı: %s" % (i, p.get("supervisor") or "-", p.get("user") or "-"))
'
r=$?
[ $r -eq 0 ] || exit $r
[ $rc -eq 0 ] || exit $rc
