set -u

# Araç runner tarafından (action.json "tools") /opt/ahenk-debug'a yalnız değiştiyse kopyalandı; bkz.
# worker/tihamon/executor/tools.py. JSON rapor dosyaya yazılır (iş çıktısı satır/uzunluk sınırlı): runner iş
# bitince onu okuyup veritabanına alır (bkz. worker/tihamon/executor/ahenk.py) — Bakım ▸ Ahenk sekmesi.
# --no-send ZORUNLU: aracın varsayılanı raporu paste.rs + ntfy.sh'e (üçüncü taraf) göndermektir.
DIR=/opt/ahenk-debug
TOOL="$DIR/ahenk_debug.py"
REPORT="$DIR/son-rapor.json"
[ -f "$TOOL" ] || { echo "ahenk-debug bulunamadı: $TOOL" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 yok" >&2; exit 2; }

set -- --json --no-send --renk=hicbir-zaman
[ "${KAPSAM:-tam}" = "hizli" ] && set -- "$@" --no-net
echo "Sürüm: $(cut -d' ' -f2 "$DIR/VERSION" 2>/dev/null | cut -c1-7) · seçenekler: $*"

rm -f "$REPORT.tmp"
python3 "$TOOL" "$@" > "$REPORT.tmp" 2> "$DIR/son-rapor.err"
rc=$?
# 0 sorun yok · 1 uyarı · 2 kritik (teşhis tamamlandı) · 3 root değil · 64 hatalı kullanım · diğer: çöktü
case "$rc" in
    0|1|2) mv -f "$REPORT.tmp" "$REPORT" ;;
    *) echo "ahenk-debug çalışmadı (çıkış kodu $rc):" >&2; tail -n 20 "$DIR/son-rapor.err" >&2; rm -f "$REPORT.tmp"; exit "$rc" ;;
esac
echo "$rc" > "$DIR/son-rapor.rc"

# Okunur özet (canlı çıktı penceresi): sonuç + uyarı/kritik bulgular.
python3 - "$REPORT" "$rc" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
rc = int(sys.argv[2])
print("Sonuç:", {0: "SORUN YOK", 1: "UYARI VAR", 2: "KRİTİK SORUN VAR"}[rc])
print("Ahenk:", d.get("ahenk_version") or "kurulu değil", "· servis:", d.get("service_active"),
      "· kayıtlı:", d.get("registered"), "· canlı bağlantı:", (d.get("live_connection") or {}).get("count", 0))
for f in d.get("findings", []):
    if f.get("severity") in ("FAIL", "WARN"):
        print(("✗ KRİTİK: " if f["severity"] == "FAIL" else "! UYARI: ") + str(f.get("title")))
PY
# Teşhis tamamlandıysa iş başarılı sayılır (bulgular tabloda); başarısızlık yalnız araç çalışmadıysa.
exit 0
