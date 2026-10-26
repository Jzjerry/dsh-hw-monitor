/**
 * Hardware telemetry collectors for the DSH hardware monitor.
 *
 * Provides cross-platform telemetry with Linux sysfs/procfs specialization,
 * safe fallback to Node.js standard OS APIs (Windows/macOS), and opportunistic
 * standalone command detection. Every probe is best-effort: a missing or
 * unreadable source becomes `null` or a short entry in `errors`, never a
 * rejected snapshot.
 *
 * @module dsh-hw-monitor/collect
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const IS_LINUX = process.platform === 'linux'
const IS_WIN = process.platform === 'win32'
const IS_DARWIN = process.platform === 'darwin'

const HWMON_ROOT = '/sys/class/hwmon'
const THERMAL_ROOT = '/sys/class/thermal'
const CPU_ROOT = '/sys/devices/system/cpu'
const RAPL_PACKAGE = '/sys/class/powercap/intel-rapl:0'
const GPU_TTL_MS = 750
const NVIDIA_TIMEOUT_MS = 1500
const CPU_USAGE_MIN_WINDOW_MS = 500
const COMMAND_COOLDOWN_MS = 60000

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

/** Previous `os.cpus()` totals for cross-platform fallback. */
let previousOsCpu = null
let lastOsCpuUsage = { usagePct: null }

/** Previous RAPL counter, when the file is readable. */
let previousRapl = null

/** Cached GPU probe and its in-flight promise. */
let gpuCache = null
let gpuInflight = null

/** Cooldown map for standalone command detection (prevents frequent spawning when tool is missing). */
const commandCooldowns = new Map()

function canAttemptCommand(cmd) {
  const lastFailed = commandCooldowns.get(cmd)
  if (lastFailed !== undefined && Date.now() - lastFailed < COMMAND_COOLDOWN_MS) {
    return false
  }
  return true
}

function markCommandFailed(cmd) {
  commandCooldowns.set(cmd, Date.now())
}

function markCommandSucceeded(cmd) {
  commandCooldowns.delete(cmd)
}

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
 * Scan every hwmon device once, returning its temperatures and fans (Linux only).
 * @returns {Promise<Array<{entry: string, name: string, temps: object[], fans: object[]}>>}
 */
async function scanHwmon() {
  if (!IS_LINUX) return []
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
 * Read thermal zones, used as a CPU-temperature fallback and for board sensors (Linux only).
 * @returns {Promise<{zones: Array<{type: string, c: number}>}>}
 */
async function scanThermal() {
  if (!IS_LINUX) return { zones: [] }
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
 * Cross-platform CPU utilization based on successive os.cpus() times.
 * @returns {{usagePct: number | null}}
 */
function readOsCpuUsage() {
  const cpus = os.cpus()
  if (!cpus || cpus.length === 0) return { usagePct: null }
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    if (!cpu.times) continue
    for (const type in cpu.times) {
      total += cpu.times[type]
    }
    idle += cpu.times.idle
  }
  const now = Date.now()
  const previous = previousOsCpu
  if (previous === null) {
    previousOsCpu = { idle, total, at: now }
    return lastOsCpuUsage
  }
  if (total <= previous.total || now - previous.at < CPU_USAGE_MIN_WINDOW_MS) return lastOsCpuUsage
  const deltaTotal = total - previous.total
  const deltaIdle = idle - previous.idle
  previousOsCpu = { idle, total, at: now }
  const usagePct = deltaTotal > 0 ? Math.max(0, Math.min(100, (1 - deltaIdle / deltaTotal) * 100)) : null
  lastOsCpuUsage = { usagePct: usagePct === null ? null : round1(usagePct) }
  return lastOsCpuUsage
}

/**
 * Derive aggregate CPU utilization. Uses /proc/stat on Linux with automatic
 * fallback to os.cpus() time slices on Windows/macOS.
 * @returns {Promise<{usagePct: number | null}>}
 */
async function readCpuUsage() {
  if (IS_LINUX) {
    const text = await readText('/proc/stat')
    if (text !== null) {
      const line = text.split('\n').find((item) => item.startsWith('cpu '))
      if (line !== undefined) {
        const fields = line.trim().split(/\s+/).slice(1).map(Number)
        if (fields.length >= 4 && !fields.some((value) => !Number.isFinite(value))) {
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
      }
    }
  }
  return readOsCpuUsage()
}

/**
 * Average current CPU frequency across online cores.
 * @returns {Promise<{freqMhz: number | null, maxFreqMhz: number | null}>}
 */
async function readCpuFreq() {
  if (IS_LINUX) {
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
  }
  const fallback = os.cpus().map((cpu) => cpu.speed).filter((speed) => Number.isFinite(speed) && speed > 0)
  return {
    freqMhz: fallback.length === 0 ? null : Math.round(average(fallback)),
    maxFreqMhz: null,
  }
}

/**
 * Cross-platform memory fallback based on os.totalmem() and os.freemem().
 * @returns {{usedBytes: number, totalBytes: number, pct: number} | null}
 */
function readOsMem() {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  if (totalBytes <= 0) return null
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  return {
    usedBytes,
    totalBytes,
    pct: round1((usedBytes / totalBytes) * 100),
  }
}

/**
 * Read physical memory usage from `/proc/meminfo` on Linux, falling back to
 * `os.totalmem()` / `os.freemem()` on Windows and macOS.
 * @returns {Promise<{usedBytes: number, totalBytes: number, pct: number} | null>}
 */
async function readMem() {
  if (IS_LINUX) {
    const text = await readText('/proc/meminfo')
    if (text !== null) {
      const info = new Map()
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_()]+):\s+(\d+)/.exec(line)
        if (match !== null) info.set(match[1], Number(match[2]))
      }
      const totalKb = info.get('MemTotal')
      if (totalKb !== undefined && totalKb > 0) {
        const availableKb = info.get('MemAvailable')
          ?? ((info.get('MemFree') ?? 0) + (info.get('Buffers') ?? 0) + (info.get('Cached') ?? 0))
        const totalBytes = totalKb * 1024
        const usedBytes = Math.max(0, totalBytes - availableKb * 1024)
        return { usedBytes, totalBytes, pct: round1((usedBytes / totalBytes) * 100) }
      }
    }
  }
  return readOsMem()
}

/**
 * Best-effort package power from the Intel RAPL counter. Unreadable counters
 * (the usual unprivileged case) yield null.
 * @returns {Promise<number | null>} watts.
 */
async function readCpuPower() {
  if (!IS_LINUX) return null
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
 * Resolve the nvidia-smi executable across platforms (PATH or common Windows paths).
 * @returns {string} executable path or name.
 */
function resolveNvidiaSmiBinary() {
  if (process.env.DSH_HW_MONITOR_NVIDIA_SMI) return process.env.DSH_HW_MONITOR_NVIDIA_SMI
  if (IS_WIN) {
    const candidates = [
      'nvidia-smi',
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    ]
    for (const candidate of candidates) {
      if (candidate === 'nvidia-smi' || existsSync(candidate)) return candidate
    }
  }
  return 'nvidia-smi'
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
  const binary = resolveNvidiaSmiBinary()
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
 * Standalone hardware probe on macOS using CLI tools if installed.
 * @returns {Promise<{packageTemp: object | null, extraTemps: object[]}>}
 */
async function scanDarwinHardware() {
  if (!IS_DARWIN) return { packageTemp: null, extraTemps: [] }

  // 1. Try `osx-cpu-temp`
  if (canAttemptCommand('osx-cpu-temp')) {
    try {
      const { stdout } = await execFileAsync('osx-cpu-temp', [], { timeout: 1000 })
      const match = /(\d+(?:\.\d+)?)\s*°?C/i.exec(stdout)
      if (match) {
        markCommandSucceeded('osx-cpu-temp')
        return {
          packageTemp: { label: 'CPU', c: round1(Number(match[1])), critC: null },
          extraTemps: [],
        }
      }
    } catch {
      markCommandFailed('osx-cpu-temp')
    }
  }

  // 2. Try `istats` (gem install iStats)
  if (canAttemptCommand('istats')) {
    try {
      const { stdout } = await execFileAsync('istats', ['cpu', 'temp', '--value-only'], { timeout: 1000 })
      const val = Number.parseFloat(stdout.trim())
      if (Number.isFinite(val) && val > 0 && val < 130) {
        markCommandSucceeded('istats')
        return {
          packageTemp: { label: 'CPU', c: round1(val), critC: null },
          extraTemps: [],
        }
      }
    } catch {
      markCommandFailed('istats')
    }
  }

  // 3. Try `macmon`
  if (canAttemptCommand('macmon')) {
    try {
      const { stdout } = await execFileAsync('macmon', ['pipe', '-c', '1'], { timeout: 1000 })
      const lines = stdout.split('\n')
      for (const line of lines) {
        if (/temp/i.test(line)) {
          const match = /(\d+(?:\.\d+)?)/.exec(line)
          if (match) {
            markCommandSucceeded('macmon')
            return {
              packageTemp: { label: 'CPU SoC', c: round1(Number(match[1])), critC: null },
              extraTemps: [],
            }
          }
        }
      }
    } catch {
      markCommandFailed('macmon')
    }
  }

  return { packageTemp: null, extraTemps: [] }
}

/**
 * Standalone hardware probe on Windows using PowerShell WMI queries if available.
 * @returns {Promise<{packageTemp: object | null, extraTemps: object[], fans: object[]}>}
 */
async function scanWindowsHardware() {
  if (!IS_WIN) return { packageTemp: null, extraTemps: [], fans: [] }

  // 1. Try LibreHardwareMonitor WMI (often exposed by hardware monitor software)
  if (canAttemptCommand('wmi-lhm')) {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Select-Object Name,SensorType,Value | ConvertTo-Json -Compress",
      ], { timeout: 1500, windowsHide: true })
      const parsed = JSON.parse(stdout)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      let pkg = null
      const extra = []
      const fans = []
      for (const item of list) {
        if (!item || typeof item.Value !== 'number') continue
        if (item.SensorType === 'Temperature') {
          if (/cpu package|cpu total|core average/i.test(item.Name) && pkg === null) {
            pkg = { label: item.Name, c: round1(item.Value), critC: null }
          } else {
            extra.push({ label: item.Name, c: round1(item.Value), source: 'LibreHardwareMonitor' })
          }
        } else if (item.SensorType === 'Fan') {
          fans.push({
            id: `lhm-fan-${fans.length}`,
            label: item.Name,
            kind: 'hwmon',
            rpm: Math.round(item.Value),
            pct: null,
            source: 'LibreHardwareMonitor',
          })
        }
      }
      if (pkg || extra.length > 0 || fans.length > 0) {
        markCommandSucceeded('wmi-lhm')
        return { packageTemp: pkg, extraTemps: extra, fans }
      }
    } catch {
      markCommandFailed('wmi-lhm')
    }
  }

  // 2. Try MSAcpi_ThermalZoneTemperature WMI
  if (canAttemptCommand('wmi-thermal')) {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -ExpandProperty CurrentTemperature',
      ], { timeout: 1500, windowsHide: true })
      const raw = Number.parseInt(stdout.trim(), 10)
      if (Number.isFinite(raw) && raw > 2732 && raw < 4000) {
        const c = round1((raw - 2732) / 10)
        markCommandSucceeded('wmi-thermal')
        return {
          packageTemp: { label: 'ACPI Thermal Zone', c, critC: null },
          extraTemps: [],
          fans: [],
        }
      }
    } catch {
      markCommandFailed('wmi-thermal')
    }
  }

  return { packageTemp: null, extraTemps: [], fans: [] }
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

  const [hwmon, thermal, cpuUsage, cpuFreq, mem, cpuPower, gpu, darwinHw, winHw] = await Promise.all([
    guard('hwmon', scanHwmon, []),
    guard('thermal', scanThermal, { zones: [] }),
    guard('cpu-usage', readCpuUsage, { usagePct: null }),
    guard('cpu-freq', readCpuFreq, { freqMhz: null, maxFreqMhz: null }),
    guard('memory', readMem, null),
    guard('cpu-power', readCpuPower, null),
    guard('gpu', readGpu, { gpus: [], gpuError: 'GPU probe failed' }),
    guard('darwin', scanDarwinHardware, { packageTemp: null, extraTemps: [] }),
    guard('windows', scanWindowsHardware, { packageTemp: null, extraTemps: [], fans: [] }),
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
  // Opportunistic Darwin / Windows package temperature fallback
  if (packageTemp === null && darwinHw?.packageTemp) {
    packageTemp = darwinHw.packageTemp
  }
  if (packageTemp === null && winHw?.packageTemp) {
    packageTemp = winHw.packageTemp
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
  if (darwinHw?.extraTemps) {
    extraTemps.push(...darwinHw.extraTemps)
  }
  if (winHw?.extraTemps) {
    extraTemps.push(...winHw.extraTemps)
  }

  const gpuFans = (gpu.gpus ?? []).map((item) => ({
    id: `gpu-${item.index}`,
    label: `GPU ${item.index}`,
    kind: 'gpu',
    rpm: null,
    pct: item.fanPct,
    source: 'nvidia-smi',
  }))
  const hwmonFans = [...hwmon.flatMap((monitor) => monitor.fans), ...(winHw?.fans ?? [])]

  // os.loadavg() on Windows is always [0, 0, 0] in Node.js; return null so UI displays "—" instead of misleading zeroes
  const load = IS_WIN ? null : os.loadavg().map((value) => round1(value))

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
      load,
      mem,
    },
    gpus: gpu.gpus ?? [],
    gpuError: gpu.gpuError ?? null,
    fans: [...gpuFans, ...hwmonFans],
    hasMotherboardFan: hwmonFans.length > 0,
    temps: extraTemps,
    errors,
  }
}
