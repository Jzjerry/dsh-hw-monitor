# dsh-hw-monitor

**English** · [简体中文](README.zh.md)

A draggable hardware-monitor panel for the DSH Web GUI. It shows live CPU and
GPU temperature, utilization, clocks, power, memory and fan speed, and sits at
the bottom-right of the frame by default.

## Two switchable views

The panel has two views that share the same live data and switch in place:

- **Panel view** (default) — the full rounded card: CPU package and per-core
  temperatures, utilization bars, frequency, memory, load, GPU temperature,
  power, VRAM, clocks, P-state, fan speed, other sensors and a temperature
  sparkline.
- **Summary view** — a one-line title bar: `CPU 77°C · GPU 81°C · 44%`. Useful
  when the panel would cover chat content or when you only need the headline
  numbers.

Use the chevron in the title bar to switch. The choice is stored in
`localStorage['dsh.hw-monitor.collapsed']`, so it survives a page reload.
Dragging, polling and refresh interval are shared by both views.

## Parts

- **Host half** (`index.js`, `collect.js`): one read-only JSON route,
  `GET /api/hw-monitor/snapshot`. It reads Linux `procfs`/`sysfs` and calls
  `nvidia-smi`; no root access and no third-party package is required.
- **Browser half** (`client.js`): a `shell.overlay` entry rendered as the
  draggable panel. Position, view and refresh interval persist in
  `localStorage`.

## Install

Standard DSH profile install:

```text
dsh plugin --profile web add @jzjerry/dsh-hw-monitor
```

Replace `web` with the profile you use. The command adds the package to that
profile's dependencies and bundle list; the panel mounts after the profile
recomposes (restart `dsh web` if the profile runs without HMR).

For a local checkout, point the same command at the package directory:

```text
dsh plugin --profile web add /absolute/path/to/dsh-hw-monitor
```

The bundle patch inserts one row, `hw-monitor`, named
`@jzjerry/dsh-hw-monitor`. The panel works without a page reload when the
client graph update is applied; otherwise refresh the page once.

If an older local install (`@local/dsh-hw-monitor` or
`@local/dsh-perf-monitor`) is still present, remove it first so two copies do
not register overlapping panels:

```text
dsh plugin --profile web remove @local/dsh-hw-monitor
dsh plugin --profile web remove @local/dsh-perf-monitor
```

## Interaction

- Drag the title bar; arrow keys move the panel when the title bar has focus
  (Shift = larger step). Position is stored in
  `localStorage['dsh.hw-monitor.position']`.
- The refresh button fetches immediately; the select changes the polling
  interval (1 s / 2 s / 5 s), stored in
  `localStorage['dsh.hw-monitor.interval']`.
- Polling pauses while the browser tab is hidden.

## Hardware and cross-platform notes

The plugin provides a unified telemetry contract across platforms, using deep
native probes where available and graceful Node.js standard OS fallbacks:

- **Universal fallbacks (Linux / Windows / macOS)**:
  - **CPU load**: Calculated via successive high-resolution ticks (`/proc/stat`
    on Linux), automatically falling back to Node.js `os.cpus()` time slices on
    Windows and macOS.
  - **Memory**: Linux parses `/proc/meminfo` for accurate available memory;
    Windows and macOS automatically fall back to `os.totalmem()` and `os.freemem()`.
  - **Clocks and load avg**: Derived from `cpufreq` and `os.cpus()`. On Windows
    where Node.js loadavg is unavailable, the load field gracefully shows "—".
- **Linux specialization**:
  - CPU temperatures via `coretemp`/`k10temp` hwmon (`Package` and per-core
    labels), with `x86_pkg_temp` fallback.
  - Board sensors (NVMe, Wi-Fi, ACPI) and fan RPMs from `hwmon`.
  - Intel RAPL CPU package power when accessible.
- **Windows support**:
  - **NVIDIA GPU**: Automatically scans `C:\Windows\System32\nvidia-smi.exe` and
    common NVSMI install directories out of the box.
  - **Standalone commands**: Opportunistically checks WMI
    (`MSAcpi_ThermalZoneTemperature`) and `LibreHardwareMonitor` sensors.
- **macOS support**:
  - **Standalone commands**: Opportunistically probes CLI tools if installed
    (`osx-cpu-temp`, `istats`, `macmon`).
- **Zero-overhead safeguard**:
  - All external commands have a built-in 60-second failure cooldown. Missing
    tools are never repeatedly spawned during polling intervals.

## Route contract

`GET /api/hw-monitor/snapshot` → `200 application/json`, `cache-control:
no-store`. Loopback requests are accepted; a remote request must come from an
authenticated/paired browser session. Other methods get `405`, unpaired
non-loopback requests get `403`.

The payload is best-effort: every source that cannot be read becomes `null`
or an entry in `errors`, while the rest of the snapshot is still returned.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Host plugin: route, trust fence, snapshot cache |
| `collect.js` | sysfs/procfs/nvidia-smi collectors |
| `client.js` | Draggable overlay panel |
| `cordis.patch.yml` | Inserts the `hw-monitor` bundle row |
| `locale/*.json` | Plugin Manager title/description |
| `icon.svg` | Plugin icon |
