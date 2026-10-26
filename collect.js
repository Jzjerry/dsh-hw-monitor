/**
 * Hardware telemetry collectors for the DSH hardware monitor.
 *
 * Everything here uses Node built-ins and Linux sysfs/procfs; no package is
 * required and no privileged access is assumed. Every probe is best-effort:
 * a missing or unreadable source becomes `null` or a short entry in
 * `errors`, never a rejected snapshot.
 *
 * @module dsh-hw-monitor/collect
 */

import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const HWMON_ROOT = '/sys/class/hwmon'
const THERMAL_ROOT = '/sys/class/thermal'
const CPU_ROOT = '/sys/devices/system/cpu'
const RAPL_PACKAGE = '/sys/class/powercap/intel-rapl:0'
const GPU_TTL_MS = 750
const NVIDIA_TIMEOUT_MS = 1500
const CPU_USAGE_MIN_WINDOW_MS = 500
const GPU_QUERY = [
  'index',
  'name',
  'driver_version',
  'temperature.gpu',
  'fan.speed',
  'power.draw',
  'power.limit',
  'utilization.gpu',
  'utilization.memory',
  'memory.used',
  'memory.total',
  'clocks.current.graphics',
  'clocks.current.memory',
  'pstate',
].join(',')

/** hwmon drivers that expose CPU temperatures rather than board sensors. */
const CPU_HWMON_NAMES = new Set(['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'])

/** Short labels for the board sensors users recognize. */
const FRIENDLY_HWMON = {
  nvme: 'NVMe',
  iwlwifi_1: 'Wi-Fi',
  acpitz: 'ACPI',
}

/** Previous `/proc/stat` totals, used to derive utilization from deltas. */
let previousCpu = null
/** Last computed utilization, reused when two calls land inside one window. */
let lastCpuUsage = { usagePct: null }
/** Previous RAPL counter, when the file is readable. */
let previousRapl = null
/** Cached GPU probe and its in-flight promise. */
let gpuCache = null
let gpuInflight = null

/**
 * Read a text file, treating any failure as an absent value.
 * @param {string} file - absolute path.
 * @returns {Promise<string | null>} contents, or null.
 */
async function readText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Read one numeric sysfs/procfs value.
 * @param {string} file - absolute path.
 * @returns {Promise<number | null>} finite number, or null.
 */
async function readNumber(file) {
  const text = await readText(file)
  if (text === null) return null
  const value = Number.parseFloat(text.trim())
  return Number.isFinite(value) ? value : null
}

/**
 * List a directory, treating any failure as empty.
 * @param {string} dir - absolute path.
 * @returns {Promise<string[]>} entry names.
 */
async function listDir(dir) {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** @param {number} value */
function round1(value) {
  return Math.round(value * 10) / 10
}

/** @param {number[]} values */
function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/** @param {string} hwmonName @param {string} label */
function friendlySensor(hwmonName, label) {
  if (FRIENDLY_HWMON[hwmonName] !== undefined) return FRIENDLY_HWMON[hwmonName]
  if (label === '' || label === hwmonName) return hwmonName
  return `${hwmonName} · ${label}`
}

/**
 * Scan every hwmon device once, returning its temperatures and fans.
 * @returns {Promise<Array<{entry: string, name: string, temps: object[], fans: object[]}>>}
 */
async function scanHwmon() {
  const entries = await listDir(HWMON_ROOT)
  return await Promise.all(entries.map(async (entry) => {
    const dir = path.join(HWMON_ROOT, entry)
    const name = ((await readText(path.join(dir, 'name'))) ?? entry).trim() || entry
    const files = await listDir(dir)
    const temps = []
    for (const file of files) {
      const match = /^temp(\d+)_input$/.exec(file)
      if (match === null) continue
      const index = Number(match[1])
      const raw = await readNumber(path.join(dir, file))
      if (raw === null) continue
      const label = ((await readText(path.join(dir, `temp${index}_label`))) ?? '').trim()
      const critRaw = await readNumber(path.join(dir, `temp${index}_crit`))
      const maxRaw = await readNumber(path.join(dir, `temp${index}_max`))
      temps.push({
        index,
        label: label || name,
        c: raw / 1000,
        critC: critRaw === null ? null : critRaw / 1000,
        maxC: maxRaw === null ? null : maxRaw / 1000,
      })
    }
    temps.sort((left, right) => left.index - right.index)

    const fans = []
    for (const file of files) {
      const match = /^fan(\d+)_input$/.exec(file)
      if (match === null) continue
      const index = Number(match[1])
      const rpm = await readNumber(path.join(dir, file))
      if (rpm === null) continue
      const label = ((await readText(path.join(dir, `fan${index}_label`))) ?? '').trim()
      const pwm = await readNumber(path.join(dir, `pwm${index}`))
      fans.push({
        id: `hwmon-${entry}-fan${index}`,
        label: label || `${name} fan ${index}`,
        kind: 'hwmon',
        rpm: Math.round(rpm),
        pct: pwm === null ? null : Math.max(0, Math.min(100, Math.round((pwm / 255) * 100))),
        source: `hwmon:${name}`,
      })
    }
    return { entry, name, temps, fans }
  }))
}

/**
 * Read thermal zones, used as a CPU-temperature fallback and for board sensors.
 * @returns {Promise<{zones: Array<{type: string, c: number}>}>}
 */
async function scanThermal() {
  const zones = []
  for (const entry of await listDir(THERMAL_ROOT)) {
    const dir = path.join(THERMAL_ROOT, entry)
    const type = ((await readText(path.join(dir, 'type'))) ?? '').trim()
    const raw = await readNumber(path.join(dir, 'temp'))
    if (type === '' || raw === null) continue
    zones.push({ type, c: raw / 1000 })
  }
  return { zones }
}

/**
 * Derive aggregate CPU utilization from successive `/proc/stat` samples.
 * @returns {Promise<{usagePct: number | null}>}
 */
async function readCpuUsage() {
  const text = await readText('/proc/stat')
  if (text === null) return { usagePct: null }
  const line = text.split('\n').find((item) => item.startsWith('cpu '))
  if (line === undefined) return { usagePct: null }
  const fields = line.trim().split(/\s+/).slice(1).map(Number)
  if (fields.length < 4 || fields.some((value) => !Number.isFinite(value))) return { usagePct: null }
  const idle = fields[3] + (fields[4] ?? 0)
  const total = fields.reduce((sum, value) => sum + value, 0)
  const now = Date.now()
  const previous = previousCpu
  if (previous === null) {
    previousCpu = { idle, total, at: now }
    return lastCpuUsage
  }
  if (total <= previous.total || now - previous.at < CPU_USAGE_MIN_WINDOW_MS) return lastCpuUsage
  const deltaTotal = total - previous.total
  const deltaIdle = idle - previous.idle
  previousCpu = { idle, total, at: now }
  const usagePct = deltaTotal > 0 ? Math.max(0, Math.min(100, (1 - deltaIdle / deltaTotal) * 100)) : null
  lastCpuUsage = { usagePct: usagePct === null ? null : round1(usagePct) }
  return lastCpuUsage
}

/**
 * Average current CPU frequency across online cores.
 * @returns {Promise<{freqMhz: number | null, maxFreqMhz: number | null}>}
 */
async function readCpuFreq() {
  const entries = (await listDir(CPU_ROOT))
    .filter((name) => /^cpu\d+$/.test(name))
    .sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)))
  const values = await Promise.all(entries.map((entry) => (
    readNumber(path.join(CPU_ROOT, entry, 'cpufreq', 'scaling_cur_freq'))
  )))
  const current = values.filter((value) => value !== null && value > 0)
  const maxValue = entries.length === 0
    ? null
    : await readNumber(path.join(CPU_ROOT, entries[0], 'cpufreq', 'scaling_max_freq'))
  if (current.length > 0) {
    return {
      freqMhz: Math.round(average(current) / 1000),
      maxFreqMhz: maxValue === null ? null : Math.round(maxValue / 1000),
    }
  }
  const fallback = os.cpus().map((cpu) => cpu.speed).filter((speed) => Number.isFinite(speed) && speed > 0)
  return {
    freqMhz: fallback.length === 0 ? null : Math.round(average(fallback)),
    maxFreqMhz: null,
  }
}

/**
 * Read physical memory usage from `/proc/meminfo`.
 * @returns {Promise<{usedBytes: number, totalBytes: number, pct: number} | null>}
 */
async function readMem() {
  const text = await readText('/proc/meminfo')
  if (text === null) return null
  const info = new Map()
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_()]+):\s+(\d+)/.exec(line)
    if (match !== null) info.set(match[1], Number(match[2]))
  }
  const totalKb = info.get('MemTotal')
  if (totalKb === undefined || totalKb <= 0) return null
  const availableKb = info.get('MemAvailable')
    ?? ((info.get('MemFree') ?? 0) + (info.get('Buffers') ?? 0) + (info.get('Cached') ?? 0))
  const totalBytes = totalKb * 1024
  const usedBytes = Math.max(0, totalBytes - availableKb * 1024)
  return { usedBytes, totalBytes, pct: round1((usedBytes / totalBytes) * 100) }
}

/**
 * Best-effort package power from the Intel RAPL counter. Unreadable counters
 * (the usual unprivileged case) yield null.
 * @returns {Promise<number | null>} watts.
 */
async function readCpuPower() {
  const name = ((await readText(path.join(RAPL_PACKAGE, 'name'))) ?? '').trim()
  if (!name.startsWith('package')) return null
  const energy = await readNumber(path.join(RAPL_PACKAGE, 'energy_uj'))
  if (energy === null) return null
  const now = Date.now()
  const previous = previousRapl
  previousRapl = { energy, at: now }
  if (previous === null || now <= previous.at || energy < previous.energy) return null
  const watts = (energy - previous.energy) / (now - previous.at) / 1000
  return watts > 0 && watts < 2000 ? round1(watts) : null
}

/**
 * Parse one `nvidia-smi --query-gpu` CSV row.
 * @param {string} line - CSV row.
 * @param {number} fallbackIndex - index used when the row omits one.
 * @returns {object}
 */
function parseGpuLine(line, fallbackIndex) {
  const parts = line.split(',').map((part) => part.trim())
  const number = (index) => {
    const value = Number(parts[index])
    return Number.isFinite(value) ? value : null
  }
  return {
    index: number(0) ?? fallbackIndex,
    name: parts[1] || 'GPU',
    driver: parts[2] || null,
    tempC: number(3),
    fanPct: number(4),
    powerW: number(5),
    powerLimitW: number(6),
    utilPct: number(7),
    memUtilPct: number(8),
    memUsedMiB: number(9),
    memTotalMiB: number(10),
    clockGfxMhz: number(11),
    clockMemMhz: number(12),
    pstate: parts[13] || null,
  }
}

/**
 * Probe all NVIDIA GPUs through nvidia-smi.
 * @returns {Promise<{gpus: object[], gpuError: string | null}>}
 */
async function queryGpu() {
  const binary = process.env.DSH_HW_MONITOR_NVIDIA_SMI || 'nvidia-smi'
  try {
    const { stdout } = await execFileAsync(binary, [
      `--query-gpu=${GPU_QUERY}`,
      '--format=csv,noheader,nounits',
    ], {
      timeout: NVIDIA_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    const gpus = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line, index) => parseGpuLine(line, index))
    return { gpus, gpuError: null }
  } catch (error) {
    const message = error?.code === 'ENOENT'
      ? `nvidia-smi not found (${binary})`
      : error?.killed === true
        ? 'nvidia-smi timed out'
        : String(error?.stderr || error?.message || error)
    return { gpus: [], gpuError: message.trim().slice(0, 400) }
  }
}

/**
 * Read GPUs with a short TTL and one in-flight probe shared by all callers.
 * @returns {Promise<{gpus: object[], gpuError: string | null}>}
 */
async function readGpu() {
  const now = Date.now()
  if (gpuCache !== null && now - gpuCache.at < GPU_TTL_MS) return gpuCache.value
  if (gpuInflight !== null) return gpuInflight
  gpuInflight = queryGpu()
    .then((value) => {
      gpuCache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      gpuInflight = null
    })
  return gpuInflight
}

/**
 * Collect one complete snapshot. Never rejects: each probe degrades to null
 * or an `errors` entry.
 * @returns {Promise<object>} snapshot payload.
 */
export async function collectSnapshot() {
  const errors = []
  const guard = async (source, operation, fallback) => {
    try {
      return await operation()
    } catch (error) {
      errors.push({ source, message: errorMessage(error) })
      return fallback
    }
  }

  const [hwmon, thermal, cpuUsage, cpuFreq, mem, cpuPower, gpu] = await Promise.all([
    guard('hwmon', scanHwmon, []),
    guard('thermal', scanThermal, { zones: [] }),
    guard('cpu-usage', readCpuUsage, { usagePct: null }),
    guard('cpu-freq', readCpuFreq, { freqMhz: null, maxFreqMhz: null }),
    guard('memory', readMem, null),
    guard('cpu-power', readCpuPower, null),
    guard('gpu', readGpu, { gpus: [], gpuError: 'GPU probe failed' }),
  ])

  const cpuTemps = hwmon
    .filter((monitor) => CPU_HWMON_NAMES.has(monitor.name))
    .flatMap((monitor) => monitor.temps)
    .sort((left, right) => left.index - right.index)

  const coreTemps = cpuTemps
    .filter((temp) => /^core\s*\d+/i.test(temp.label))
    .map((temp) => ({ label: temp.label, c: round1(temp.c) }))

  let packageTemp = cpuTemps.find((temp) => /package|tctl|tdie|tccd/i.test(temp.label)) ?? null
  if (packageTemp === null && cpuTemps.length > 0) packageTemp = cpuTemps[0]
  if (packageTemp === null) {
    const zone = thermal.zones.find((item) => /x86_pkg_temp|cpu-thermal|soc_thermal/i.test(item.type))
    if (zone !== undefined) packageTemp = { label: zone.type, c: zone.c, critC: null }
  }
  const critTempC = packageTemp?.critC
    ?? cpuTemps.find((temp) => temp.critC !== null)?.critC
    ?? null

  const extraTemps = []
  const seenSources = new Set()
  for (const monitor of hwmon) {
    if (CPU_HWMON_NAMES.has(monitor.name)) continue
    seenSources.add(monitor.name)
    for (const temp of monitor.temps) {
      extraTemps.push({
        label: friendlySensor(monitor.name, temp.label),
        c: round1(temp.c),
        source: `hwmon:${monitor.name}`,
      })
    }
  }
  for (const zone of thermal.zones) {
    if (/x86_pkg_temp/i.test(zone.type)) continue
    if (seenSources.has(zone.type)) continue
    extraTemps.push({
      label: FRIENDLY_HWMON[zone.type] ?? zone.type,
      c: round1(zone.c),
      source: `thermal:${zone.type}`,
    })
  }

  const gpuFans = (gpu.gpus ?? []).map((item) => ({
    id: `gpu-${item.index}`,
    label: `GPU ${item.index}`,
    kind: 'gpu',
    rpm: null,
    pct: item.fanPct,
    source: 'nvidia-smi',
  }))
  const hwmonFans = hwmon.flatMap((monitor) => monitor.fans)

  return {
    ok: true,
    sampledAt: Date.now(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSec: Math.round(os.uptime()),
    },
    cpu: {
      name: os.cpus()[0]?.model?.trim() ?? 'CPU',
      packageTempC: packageTemp === null || packageTemp === undefined ? null : round1(packageTemp.c),
      critTempC: critTempC === null ? null : round1(critTempC),
      coreTemps,
      usagePct: cpuUsage.usagePct,
      freqMhz: cpuFreq.freqMhz,
      maxFreqMhz: cpuFreq.maxFreqMhz,
      powerW: cpuPower,
      load: os.loadavg().map((value) => round1(value)),
      mem: mem,
    },
    gpus: gpu.gpus ?? [],
    gpuError: gpu.gpuError ?? null,
    fans: [...gpuFans, ...hwmonFans],
    hasMotherboardFan: hwmonFans.length > 0,
    temps: extraTemps,
    errors,
  }
}
