# eta-112 ile BIOS parolasını temizler. Araç runner tarafından /opt/eta-112'ye kopyalanmıştır
# (bkz. worker/ankamon/executor/tools.py).
set -u
T=/opt/eta-112/eta-112.py
[ -f "$T" ] || { echo "eta-112 tahtada bulunamadı ($T)." >&2; exit 1; }
echo "Araç: eta-112 $(cut -d' ' -f2 /opt/eta-112/VERSION 2>/dev/null | cut -c1-7)"

field() { python3 -c 'import json,sys
try: d=json.loads([l for l in sys.stdin.read().splitlines() if l.startswith("{")][-1])
except Exception: d={}
v=d.get(sys.argv[1]); print("" if v is None else v)' "$1"; }

echo "Model denetleniyor (gerekirse flashrom/dmidecode kurulur)…"
info=$(python3 "$T" bios info --json 2>&1)
if [ "$(printf '%s' "$info" | field supported)" != "True" ]; then
    err=$(printf '%s' "$info" | field error)
    echo "DESTEKLENMİYOR ya da okunamadı: kart $(printf '%s' "$info" | field board), BIOS $(printf '%s' "$info" | field bios)${err:+ — $err} — hiçbir şey yazılmadı." >&2
    [ -n "$err" ] || printf '%s\n' "$info" | tail -n 3 >&2
    exit 2
fi
echo "Model: $(printf '%s' "$info" | field model) (kart $(printf '%s' "$info" | field board), BIOS $(printf '%s' "$info" | field bios))"

case "${SLOT:-all}" in
    all) what="Yönetici ve kullanıcı parolası" ;;
    yonetici) what="Yönetici parolası" ;;
    kullanici) what="Kullanıcı parolası" ;;
    *) echo "Geçersiz seçim: $SLOT" >&2; exit 1 ;;
esac

echo "Flash'a yazılıyor… (kesmeyin, tahtayı kapatmayın)"
out=$(python3 "$T" bios clear "${SLOT:-all}" --json 2>&1); rc=$?
if [ "$(printf '%s' "$out" | field ok)" = "True" ]; then
    echo "✓ $what sıfırlandı"
    [ "$(printf '%s' "$out" | field verified)" = "True" ] && echo "✓ Geri-okuma ile doğrulandı"
    [ "$(printf '%s' "$out" | field changed)" = "False" ] && echo "(Parola zaten boştu — değişiklik yapılmadı)"
    echo "Etkili olması için tahtayı yeniden başlatın."
    exit 0
fi
err=$(printf '%s' "$out" | field error 2>/dev/null)
echo "HATA: ${err:-$(printf '%s' "$out" | tail -n 3)}" >&2
exit $(( rc == 0 ? 1 : rc ))
