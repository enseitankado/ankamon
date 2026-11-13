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

"""Elektrik kesintisi anomalileri: SMART sayacı seçimi, yoklama ayrıştırma, ETAP otomatik kapanma açıklaması, toplu kesinti
kümeleri. python3 -m unittest discover -s worker/tests"""

import datetime
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "worker"))

from ankamon.anomaly import power_loss, power_outage_area as area  # noqa: E402
from ankamon.executor import power_probe  # noqa: E402

TZ = datetime.timezone(datetime.timedelta(hours=3))
T0 = datetime.datetime(2026, 11, 13, 9, 45, tzinfo=TZ)


def _attr(i, name, raw):
    return {"id": i, "name": name, "raw": {"value": raw}}


class SmartTest(unittest.TestCase):
    def test_samsung_por_recovery(self):
        # Sahadaki tahta diski (SAMSUNG MZ7TE256 / PM851), 2026-11-13 ölçümü.
        raw = json.dumps({"model_name": "SAMSUNG MZ7TE256HMHP-000FH", "ata_smart_attributes": {"table": [
            _attr(9, "Power_On_Hours", 4000), _attr(12, "Power_Cycle_Count", 2305),
            _attr(235, "POR_Recovery_Count", 1174)]}})
        s = power_probe.parse_smart(raw)
        self.assertEqual((s["power_cycles"], s["unsafe_shutdowns"], s["unsafe_attr"]),
                         (2305, 1174, "235 POR_Recovery_Count"))

    def test_preference_and_missing(self):
        raw = json.dumps({"ata_smart_attributes": {"table": [
            _attr(192, "Power-Off_Retract_Count", 7), _attr(174, "Unexpect_Power_Loss_Ct", 3)]}})
        self.assertEqual(power_probe.parse_smart(raw)["unsafe_attr"], "174 Unexpect_Power_Loss_Ct")
        twinmos = json.dumps({"model_name": "TwinMOS SSD", "ata_smart_attributes": {"table": [
            _attr(12, "Power_Cycle_Count", 204)]}})
        s = power_probe.parse_smart(twinmos)
        self.assertEqual((s["power_cycles"], s["unsafe_shutdowns"]), (204, None))
        self.assertIsNone(power_probe.parse_smart("bozuk")["unsafe_shutdowns"])

    def test_nvme(self):
        raw = json.dumps({"power_cycle_count": 50, "nvme_smart_health_information_log": {"unsafe_shutdowns": 9}})
        s = power_probe.parse_smart(raw)
        self.assertEqual((s["power_cycles"], s["unsafe_shutdowns"]), (50, 9))

    def test_delta(self):
        base = {"unsafe_shutdowns": 1174, "unsafe_attr": "235 POR_Recovery_Count", "power_cycles": 2305}
        self.assertEqual(power_loss._smart_delta(dict(base, unsafe_shutdowns=1175, power_cycles=2306), base)[:2], (1, 1))
        self.assertEqual(power_loss._smart_delta(dict(base, power_cycles=2306), base)[:2], (0, 1))
        self.assertIsNone(power_loss._smart_delta(dict(base, unsafe_shutdowns=3), base))        # disk değişmiş
        self.assertIsNone(power_loss._smart_delta(dict(base, unsafe_shutdowns=None), base))


class ProbeParseTest(unittest.TestCase):
    def test_parse(self):
        out = "\n".join([
            "BOOT_ID=3d494e32-754a-4007-9f0f-4abca8926cd9", "NOW=1794560000", "UPTIME=100.5", "DISK=sda",
            "SMART_JSON=" + json.dumps({"ata_smart_attributes": {"table": [_attr(235, "POR_Recovery_Count", 5)]}}),
            "PREV_START=1794550000.1", "PREV_END=1794552355.69", "PREV_LAST=Connection closed by 10.0.0.1 port 1",
            "PREV_CLEAN=0", "PREV_KIND=poweroff",
            "ETA_SHUTDOWN=[AUTO_SHUTDOWN];enabled = False;[TIMED_MODE];mode = shutdown;hour = 0;minute = 20;"])
        rec = power_probe.parse(out)
        self.assertEqual(rec["booted_at"], 1794559899.5)
        self.assertIs(rec["prev_clean"], False)
        self.assertEqual(rec["unsafe_shutdowns"], 5)
        self.assertEqual(rec["eta_shutdown"]["TIMED_MODE.minute"], "20")
        self.assertIsNone(power_probe.parse("NOW=1\nUPTIME=1"))


class EtaExplainsTest(unittest.TestCase):
    IDLE20 = {"TIMED_MODE.mode": "shutdown", "TIMED_MODE.hour": "0", "TIMED_MODE.minute": "20"}

    def test_idle(self):
        self.assertIsNotNone(power_loss.eta_explains(self.IDLE20, T0 - datetime.timedelta(minutes=25), T0, TZ))
        # 4 dk süren çalışma 20 dk boşta kapanmayla bitemez: ani kapanma
        self.assertIsNone(power_loss.eta_explains(self.IDLE20, T0 - datetime.timedelta(minutes=4), T0, TZ))

    def test_timed(self):
        conf = {"AUTO_SHUTDOWN.enabled": "true", "AUTO_SHUTDOWN.hour": "9", "AUTO_SHUTDOWN.minute": "40"}
        self.assertIsNotNone(power_loss.eta_explains(conf, None, T0, TZ))
        self.assertIsNone(power_loss.eta_explains(conf, None, T0 - datetime.timedelta(hours=1), TZ))


def _event(i, location, minute, source="journal", boot=None, live=False, confirm="smart", online=False):
    device = {"id": i, "name": f"D{i}", "location": location, "online": online}
    return {"device": device, "cut": T0 + datetime.timedelta(minutes=minute), "boot": boot, "live": live,
            "source": source, "confirm": confirm}


class AreaTest(unittest.TestCase):
    def test_clusters(self):
        events = [_event(1, "55.11.165.3.2.D7", 0), _event(2, "55.11.165.3.3.16", 2), _event(3, "55.11.165.3.3.17", 9)]
        self.assertEqual([len(c) for c in area.clusters(events)], [2, 1])
        # Son log kaynaklı kesinti anı seyrek: daha geniş pay
        events[2]["source"] = "log"
        self.assertEqual([len(c) for c in area.clusters(events)], [3])

    def test_levels(self):
        boot = T0 + datetime.timedelta(minutes=30)
        floor = [_event(1, "55.11.165.3.2.1", 0, boot=boot), _event(2, "55.11.165.3.2.4", 1, boot=boot)]
        devices = {e["device"]["id"]: e["device"] for e in floor}
        devices[9] = {"id": 9, "name": "D9", "location": "55.11.165.3.2.8", "online": True}
        r = area._record(floor, devices, T0, {})
        self.assertEqual((r["host"], r["detail"]["level"], r["detail"]["staying"]), ("konum:55.11.165.3.2", "kat", 1))
        self.assertEqual(r["ended_at"], boot)
        self.assertIn("Bina 3 · Kat 2", r["device_name"])
        building = [_event(1, "55.11.165.3.1.1", 0, boot=boot), _event(2, "55.11.165.3.2.4", 1, boot=boot)]
        self.assertEqual(area._record(building, {}, T0, {})["detail"]["level"], "bina")
        self.assertIsNone(area._record(floor[:1], devices, T0, {}))   # tek cihaz toplu değil

    def test_live_ratio_and_reuse(self):
        live = [_event(1, "55.11.165.3.2.1", 0, live=True, source="live", confirm=None),
                _event(2, "55.11.165.3.2.2", 0.5, live=True, source="live", confirm=None)]
        devices = {e["device"]["id"]: e["device"] for e in live}
        r = area._record(live, devices, T0, {})
        self.assertIsNone(r["ended_at"])                               # sürüyor
        for i in range(10, 13):                                       # aynı katta 3 cihaz açık: çoğunluk açık
            devices[i] = {"id": i, "name": f"D{i}", "location": f"55.11.165.3.2.{i}", "online": True}
        self.assertIsNone(area._record(live, devices, T0, {}))
        # Canlıyken yazılan kayıt, cihazlar açılınca aynı başlangıçla sürer
        known = {"konum:55.11.165.3.2": [T0 - datetime.timedelta(minutes=1)]}
        boot = T0 + datetime.timedelta(minutes=20)
        done = [dict(e, live=False, boot=boot, source="journal") for e in live]
        self.assertEqual(area._record(done, {}, T0, known)["started_at"], T0 - datetime.timedelta(minutes=1))


if __name__ == "__main__":
    unittest.main()
