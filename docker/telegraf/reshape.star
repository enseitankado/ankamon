# node_exporter ölçümlerini (inputs.prometheus, metric_version = 1) tek ölçüme indirir:
#   metrics, etiketler: board_id, name ve aşağıdaki KEEP_TAGS; alan: value
# Listede olmayan her şey atılır — tahta başına seri sayısı düşük kalsın diye.

KEEP = {
    "node_load1": True,
    "node_load5": True,
    "node_load15": True,
    "node_cpu_seconds_total": True,
    "node_memory_MemTotal_bytes": True,
    "node_memory_MemAvailable_bytes": True,
    "node_memory_SwapTotal_bytes": True,
    "node_memory_SwapFree_bytes": True,
    "node_filesystem_size_bytes": True,
    "node_filesystem_avail_bytes": True,
    "node_disk_read_bytes_total": True,
    "node_disk_written_bytes_total": True,
    "node_disk_io_time_seconds_total": True,
    "node_network_receive_bytes_total": True,
    "node_network_transmit_bytes_total": True,
    "node_network_up": True,
    "node_hwmon_temp_celsius": True,
    "node_hwmon_fan_rpm": True,
    # Super I/O (it87/nct6775/f71882fg) gerilimlerinden yalnız CMOS pili (in8 = Vbat) — bkz. apply().
    "node_hwmon_in_volts": True,
    # Disk sıcaklığı: tahtadaki prometheus-node-exporter-collectors zamanlayıcılarının textfile
    # çıktısı (smartmon 15 dk'da bir; SATA'da 194 ya da 190 numaralı öznitelik, NVMe'de nvme_).
    "smartmon_temperature_celsius_raw_value": True,
    "smartmon_airflow_temperature_cel_raw_value": True,
    "nvme_temperature_celsius": True,
    "node_thermal_zone_temp": True,
    "node_boot_time_seconds": True,
    "node_time_seconds": True,
    "node_procs_running": True,
    "node_timex_offset_seconds": True,
}

KEEP_TAGS = ["board_id", "cpu", "mode", "device", "mountpoint", "fstype", "chip", "sensor", "type", "zone"]

CPU_MODES = ["idle", "user", "system", "iowait"]
SKIP_FSTYPES = ["tmpfs", "devtmpfs", "overlay", "squashfs", "ramfs", "autofs", "fuse.portal", "efivarfs"]
SUPERIO_CHIPS = ["it87", "nct67", "f71"]
SKIP_DEV_PREFIXES = ["lo", "veth", "docker", "br-", "virbr", "loop", "ram", "dm-"]

def apply(metric):
    name = metric.name
    if name not in KEEP:
        return None

    value = None
    for field in ("gauge", "counter", "untyped"):
        if field in metric.fields:
            value = metric.fields[field]
            break
    if value == None:
        return None

    tags = metric.tags
    if name == "node_cpu_seconds_total" and tags.get("mode") not in CPU_MODES:
        return None
    if name.startswith("node_filesystem_") and tags.get("fstype") in SKIP_FSTYPES:
        return None
    if name.startswith("node_network_") or name.startswith("node_disk_"):
        device = tags.get("device", "")
        for prefix in SKIP_DEV_PREFIXES:
            if device.startswith(prefix):
                return None

    if name == "node_hwmon_in_volts":
        chip = tags.get("chip", "")
        if tags.get("sensor") != "in8" or not any([c in chip for c in SUPERIO_CHIPS]):
            return None
    # Bağlı olmayan sensör girişleri (ör. it87 temp2 = -70) grafikleri ve en düşük değeri bozmasın.
    if name == "node_hwmon_temp_celsius" and value < -20:
        return None
    # smartmon disk adını "disk" etiketiyle verir; metrics_tag'de karşılığı "device" sütunu.
    if name.startswith("smartmon_") and "disk" in tags:
        tags["device"] = tags.pop("disk")

    for key in tags.keys():
        if key not in KEEP_TAGS:
            tags.pop(key)
    tags["name"] = name

    metric.name = "metrics"
    metric.fields.clear()
    metric.fields["value"] = float(value)
    return metric
