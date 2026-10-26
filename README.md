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

## Hardware notes

- CPU temperature comes from `coretemp`/`k10temp` hwmon (`Package` and per-core
  labels), with `x86_pkg_temp` as a fallback.
- GPU data comes from `nvidia-smi`; `DSH_HW_MONITOR_NVIDIA_SMI` can point at a
  non-standard binary. GPU fan speed is a percentage, not RPM — consumer GPUs
  do not expose a tachometer through NVML.
- Chassis/CPU fans are listed when any `hwmon` `fan*_input` exists. On the
  Intel NUC 11 Extreme used for development, the EC owns the fan and exposes
  no RPM, so the panel says so explicitly instead of inventing a value.
- CPU package power uses the Intel RAPL counter when it is readable; it is
  usually root-only, so the field stays hidden for normal users.
- Multi-GPU systems: the panel shows the first GPU; the endpoint returns all.

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
