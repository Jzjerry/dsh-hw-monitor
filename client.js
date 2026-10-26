window.__ModuleLoader__.load({
  id: '@jzjerry/dsh-hw-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'hw-monitor'
    const API = '/api/hw-monitor/snapshot'
    const STORE = {
      collapsed: 'dsh.hw-monitor.collapsed',
      position: 'dsh.hw-monitor.position',
      interval: 'dsh.hw-monitor.interval',
    }
    const INTERVALS = [1000, 2000, 5000]
    const DEFAULT_INTERVAL = 2000
    const HISTORY_LIMIT = 60
    const MARGIN = 8

    const ZH = {
      title: '硬件监控',
      cpu: 'CPU',
      gpu: 'GPU',
      fan: '风扇',
      usage: '占用',
      memory: '内存',
      power: '功耗',
      freq: '频率',
      load: '负载',
      pstate: '状态',
      refresh: '刷新',
      collapse: '收起',
      expand: '展开',
      drag: '拖动面板（方向键可移动）',
      updated: '更新',
      interval: '刷新间隔',
      seconds: '秒',
      gpuMissing: '未检测到 NVIDIA GPU',
      gpuError: 'GPU 读取失败',
      cpuFanMissing: 'CPU/机箱风扇未暴露',
      error: '部分数据不可用',
      loading: '正在读取硬件信息…',
      tempHistory: 'CPU 与 GPU 温度历史',
      host: '主机',
    }

    const EN = {
      title: 'Hardware Monitor',
      cpu: 'CPU',
      gpu: 'GPU',
      fan: 'Fan',
      usage: 'Load',
      memory: 'Memory',
      power: 'Power',
      freq: 'Clock',
      load: 'Load avg',
      pstate: 'P-state',
      refresh: 'Refresh',
      collapse: 'Collapse',
      expand: 'Expand',
      drag: 'Drag panel (arrow keys move it)',
      updated: 'Updated',
      interval: 'Refresh interval',
      seconds: 's',
      gpuMissing: 'No NVIDIA GPU detected',
      gpuError: 'GPU read failed',
      cpuFanMissing: 'CPU/chassis fan not exposed',
      error: 'Partial data unavailable',
      loading: 'Reading hardware…',
      tempHistory: 'CPU and GPU temperature history',
      host: 'Host',
    }

    const CSS = `
.hwmon-root{position:fixed;right:16px;bottom:16px;z-index:30;box-sizing:border-box;width:304px;max-width:calc(100vw - 16px);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-panel);font-family:inherit;font-size:12px;line-height:1.4;overflow:hidden;pointer-events:auto}
.hwmon-root[data-dragging="true"]{cursor:grabbing}
.hwmon-head{display:flex;align-items:center;gap:7px;padding:8px 8px 8px 10px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
.hwmon-head[data-dragging="true"]{cursor:grabbing}
.hwmon-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.hwmon-mark{display:inline-flex;flex:none;color:var(--dsw-alias-brand-primary)}
.hwmon-title{flex:none;font-weight:600;font-size:12px;white-space:nowrap}
.hwmon-summary{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hwmon-spacer{flex:1 1 auto;min-width:0}
.hwmon-live{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.hwmon-live[data-state="ok"]{background:var(--dsw-alias-state-success-primary)}
.hwmon-live[data-state="bad"]{background:var(--dsw-alias-state-error-primary)}
.hwmon-actions{display:flex;flex:none;gap:2px}
.hwmon-icon-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.hwmon-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.hwmon-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.hwmon-body{max-height:calc(100vh - 120px);padding:9px 11px 4px;overflow-y:auto}
.hwmon-section+.hwmon-section{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.hwmon-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.hwmon-heading{display:flex;flex-direction:column;gap:1px;min-width:0}
.hwmon-name{color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.hwmon-model{max-width:190px;color:var(--dsw-alias-label-secondary);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hwmon-temp-wrap{display:flex;flex:none;align-items:baseline}
.hwmon-temp{font-size:20px;font-weight:600;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.hwmon-unit{margin-left:2px;color:var(--dsw-alias-label-secondary);font-size:10px}
.hwmon-bar{height:4px;margin-top:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.hwmon-bar>i{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary);transition:width .25s ease}
.hwmon-meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-top:6px}
.hwmon-meta-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.hwmon-label{color:var(--dsw-alias-label-secondary);font-size:10.5px;white-space:nowrap}
.hwmon-val{font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hwmon-cores{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:3px;margin-top:6px}
.hwmon-core{text-align:center;font-size:9px;line-height:16px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.hwmon-note{margin-top:5px;color:var(--dsw-alias-state-warn-primary);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hwmon-spark{display:block;width:100%;height:32px;margin-top:8px;overflow:visible}
.hwmon-spark-grid{stroke:var(--dsw-alias-border-l1);stroke-width:1}
.hwmon-spark-cpu{fill:none;stroke:var(--dsw-alias-brand-primary);stroke-width:1.5}
.hwmon-spark-gpu{fill:none;stroke:var(--dsw-alias-state-success-primary);stroke-width:1.5}
.hwmon-foot{display:flex;align-items:center;justify-content:space-between;gap:4px 8px;flex-wrap:wrap;padding:6px 11px 7px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10px}
.hwmon-foot-left{display:flex;flex:1 1 150px;flex-direction:column;gap:1px;min-width:0}
.hwmon-fanline,.hwmon-sensors,.hwmon-error{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hwmon-sensors{opacity:.85}
.hwmon-error{color:var(--dsw-alias-state-warn-primary)}
.hwmon-foot-right{display:flex;flex:none;align-items:center;gap:6px}
.hwmon-updated{font-variant-numeric:tabular-nums;white-space:nowrap}
.hwmon-select{appearance:none;padding:1px 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;cursor:pointer}
.hwmon-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.hwmon-loading{padding:14px 2px;color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center}
.hwmon-error-text{padding:10px 2px;color:var(--dsw-alias-state-error-primary);font-size:11px}
@media (prefers-reduced-motion:reduce){.hwmon-bar>i{transition:none}}
`

    const TONE_COLOR = {
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      bad: 'var(--dsw-alias-state-error-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
    }

    function isNumber(value) {
      return typeof value === 'number' && Number.isFinite(value)
    }

    function round(value) {
      return Math.round(value)
    }

    function toneOf(value, warn, bad) {
      if (!isNumber(value)) return 'muted'
      if (value >= bad) return 'bad'
      if (value >= warn) return 'warn'
      return 'ok'
    }

    function fmtTemp(value) {
      return isNumber(value) ? `${round(value)}°C` : '—'
    }

    function fmtTempValue(value) {
      return isNumber(value) ? String(round(value)) : '—'
    }

    function fmtPct(value) {
      return isNumber(value) ? `${round(value)}%` : '—'
    }

    function fmtW(value) {
      if (!isNumber(value)) return '—'
      return `${value >= 100 ? round(value) : value.toFixed(1)} W`
    }

    function fmtPower(gpu) {
      if (gpu === null || !isNumber(gpu.powerW)) return '—'
      if (!isNumber(gpu.powerLimitW)) return fmtW(gpu.powerW)
      const draw = gpu.powerW >= 100 ? round(gpu.powerW) : gpu.powerW.toFixed(1)
      return `${draw} / ${round(gpu.powerLimitW)} W`
    }

    function fmtGHz(value) {
      return isNumber(value) ? `${(value / 1000).toFixed(2)} GHz` : '—'
    }

    function fmtMhz(value) {
      return isNumber(value) ? `${round(value)} MHz` : '—'
    }

    function fmtGiB(mib) {
      return isNumber(mib) ? `${(mib / 1024).toFixed(1)} GiB` : '—'
    }

    function fmtBytes(bytes) {
      return isNumber(bytes) ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB` : '—'
    }

    function fmtFan(fan) {
      if (isNumber(fan.pct)) return fmtPct(fan.pct)
      if (isNumber(fan.rpm)) return `${round(fan.rpm)} RPM`
      return '—'
    }

    function fmtTime(ms) {
      if (!isNumber(ms)) return '—'
      try {
        return new Date(ms).toLocaleTimeString()
      } catch {
        return '—'
      }
    }

    function clampPercent(value) {
      return isNumber(value) ? Math.max(0, Math.min(100, value)) : 0
    }

    function shortText(value, limit) {
      if (typeof value !== 'string' || value === '') return ''
      return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
    }

    function sparkPoints(values) {
      const points = []
      const count = values.length
      values.forEach((value, index) => {
        if (!isNumber(value)) return
        const x = count <= 1 ? 0 : (index / (count - 1)) * 100
        const y = 32 - (Math.max(0, Math.min(100, value)) / 100) * 32
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
      })
      return points.length < 2 ? '' : points.join(' ')
    }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        return raw === null ? fallback : JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Storage can be unavailable; the in-memory state still applies.
      }
    }

    function readBool(key, fallback) {
      const value = readJson(key, fallback)
      return typeof value === 'boolean' ? value : fallback
    }

    function readInterval() {
      const value = readJson(STORE.interval, DEFAULT_INTERVAL)
      return INTERVALS.includes(value) ? value : DEFAULT_INTERVAL
    }

    function readPosition() {
      const value = readJson(STORE.position, null)
      if (value !== null && typeof value === 'object' && isNumber(value.left) && isNumber(value.top)) {
        return { left: value.left, top: value.top }
      }
      return null
    }

    function markIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'none' },
        h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M6 2v2M8 2v2M10 2v2M6 12v2M8 12v2M10 12v2M2 6h2M2 8h2M2 10h2M12 6h2M12 8h2M12 10h2',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
        }),
      )
    }

    function refreshIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.5-3.54M13 2.5V5.5H10',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function chevronIcon(collapsed) {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: collapsed ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function metaRow(key, label, value, title) {
      return h('div', { className: 'hwmon-meta-row', key, title: title || undefined },
        h('span', { className: 'hwmon-label' }, label),
        h('span', { className: 'hwmon-val', title: title || undefined }, value),
      )
    }

    function coreCell(core, index) {
      const tone = toneOf(core.c, 75, 90)
      return h('span', {
        key: index,
        className: 'hwmon-core',
        title: `${core.label}: ${fmtTemp(core.c)}`,
        style: {
          color: TONE_COLOR[tone],
          background: `color-mix(in srgb, ${TONE_COLOR[tone]} 16%, var(--dsw-alias-bg-layer-2))`,
        },
      }, fmtTempValue(core.c))
    }

    function Sparkline(props) {
      const cpuPoints = sparkPoints(props.history.map((point) => point.cpu))
      const gpuPoints = sparkPoints(props.history.map((point) => point.gpu))
      return h('svg', {
        className: 'hwmon-spark',
        viewBox: '0 0 100 32',
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': props.label,
      },
        h('line', { className: 'hwmon-spark-grid', x1: 0, y1: 16, x2: 100, y2: 16, vectorEffect: 'non-scaling-stroke' }),
        cpuPoints === '' ? null : h('polyline', { className: 'hwmon-spark-cpu', points: cpuPoints, vectorEffect: 'non-scaling-stroke' }),
        gpuPoints === '' ? null : h('polyline', { className: 'hwmon-spark-gpu', points: gpuPoints, vectorEffect: 'non-scaling-stroke' }),
      )
    }

    function useTranslate(ctx) {
      const [, bump] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => ctx.locale.subscribe(() => bump()), [ctx])
      return ctx.locale.bind(NS)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        function Panel() {
          const t = useTranslate(ctx)
          const [snapshot, setSnapshot] = React.useState(null)
          const [error, setError] = React.useState(null)
          const [history, setHistory] = React.useState([])
          const [collapsed, setCollapsed] = React.useState(() => readBool(STORE.collapsed, false))
          const [intervalMs, setIntervalMs] = React.useState(readInterval)
          const [refreshNonce, setRefreshNonce] = React.useState(0)
          const [position, setPosition] = React.useState(readPosition)
          const [dragging, setDragging] = React.useState(false)
          const rootRef = React.useRef(null)
          const dragRef = React.useRef(null)

          React.useEffect(() => {
            let stopped = false
            let timer = null
            let controller = null
            let inFlight = false

            const schedule = () => {
              if (stopped) return
              if (timer !== null) window.clearTimeout(timer)
              timer = window.setTimeout(() => {
                timer = null
                void tick()
              }, intervalMs)
            }

            const tick = async () => {
              if (stopped) return
              if (document.visibilityState === 'hidden') {
                schedule()
                return
              }
              if (inFlight) {
                schedule()
                return
              }
              inFlight = true
              controller = new AbortController()
              try {
                const response = await fetch(API, {
                  method: 'GET',
                  cache: 'no-store',
                  headers: { accept: 'application/json' },
                  signal: controller.signal,
                })
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                const data = await response.json()
                if (data === null || typeof data !== 'object' || data.ok !== true) {
                  throw new Error(typeof data?.error === 'string' ? data.error : 'invalid snapshot')
                }
                if (!stopped) {
                  setSnapshot(data)
                  setError(null)
                  setHistory((previous) => {
                    const next = previous.concat({
                      sampledAt: data.sampledAt,
                      cpu: isNumber(data.cpu?.packageTempC) ? data.cpu.packageTempC : null,
                      gpu: isNumber(data.gpus?.[0]?.tempC) ? data.gpus[0].tempC : null,
                    })
                    return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
                  })
                }
              } catch (caught) {
                if (!stopped && caught?.name !== 'AbortError') {
                  setError(caught instanceof Error ? caught.message : String(caught))
                }
              } finally {
                inFlight = false
                controller = null
                schedule()
              }
            }

            const onVisibility = () => {
              if (stopped || document.visibilityState !== 'visible') return
              if (timer !== null) {
                window.clearTimeout(timer)
                timer = null
              }
              void tick()
            }

            void tick()
            document.addEventListener('visibilitychange', onVisibility)
            return () => {
              stopped = true
              if (timer !== null) window.clearTimeout(timer)
              document.removeEventListener('visibilitychange', onVisibility)
              if (controller !== null) controller.abort()
            }
          }, [intervalMs, refreshNonce])

          React.useEffect(() => {
            if (position === null) return
            const element = rootRef.current
            if (element === null) return
            const maxLeft = Math.max(MARGIN, window.innerWidth - element.offsetWidth - MARGIN)
            const maxTop = Math.max(MARGIN, window.innerHeight - element.offsetHeight - MARGIN)
            const left = Math.min(Math.max(position.left, MARGIN), maxLeft)
            const top = Math.min(Math.max(position.top, MARGIN), maxTop)
            if (left !== position.left || top !== position.top) setPosition({ left, top })
          }, [position, collapsed])

          React.useEffect(() => {
            const onResize = () => setPosition((current) => {
              if (current === null) return current
              const element = rootRef.current
              if (element === null) return current
              const maxLeft = Math.max(MARGIN, window.innerWidth - element.offsetWidth - MARGIN)
              const maxTop = Math.max(MARGIN, window.innerHeight - element.offsetHeight - MARGIN)
              const left = Math.min(Math.max(current.left, MARGIN), maxLeft)
              const top = Math.min(Math.max(current.top, MARGIN), maxTop)
              return left === current.left && top === current.top ? current : { left, top }
            })
            window.addEventListener('resize', onResize)
            return () => window.removeEventListener('resize', onResize)
          }, [])

          const changeInterval = (next) => {
            if (!INTERVALS.includes(next)) return
            setIntervalMs(next)
            writeJson(STORE.interval, next)
          }

          const toggleCollapsed = () => {
            setCollapsed((current) => {
              const next = !current
              writeJson(STORE.collapsed, next)
              return next
            })
          }

          const beginDrag = (event) => {
            if (event.button !== 0 && event.pointerType === 'mouse') return
            const target = event.target
            if (target instanceof Element && target.closest('button, select, input, a') !== null) return
            const element = rootRef.current
            if (element === null) return
            const rect = element.getBoundingClientRect()
            dragRef.current = {
              pointerId: event.pointerId,
              offsetX: event.clientX - rect.left,
              offsetY: event.clientY - rect.top,
            }
            setDragging(true)
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // Pointer capture can fail for synthetic pointers; dragging still works.
            }
            event.preventDefault()
          }

          const moveDrag = (event) => {
            const drag = dragRef.current
            if (drag === null || drag.pointerId !== event.pointerId) return
            const element = rootRef.current
            if (element === null) return
            const maxLeft = Math.max(MARGIN, window.innerWidth - element.offsetWidth - MARGIN)
            const maxTop = Math.max(MARGIN, window.innerHeight - element.offsetHeight - MARGIN)
            setPosition({
              left: Math.min(Math.max(event.clientX - drag.offsetX, MARGIN), maxLeft),
              top: Math.min(Math.max(event.clientY - drag.offsetY, MARGIN), maxTop),
            })
          }

          const endDrag = (event) => {
            const drag = dragRef.current
            if (drag === null) return
            dragRef.current = null
            setDragging(false)
            try {
              event.currentTarget.releasePointerCapture(drag.pointerId)
            } catch {
              // Already released or never captured.
            }
            const element = rootRef.current
            if (element !== null) {
              const rect = element.getBoundingClientRect()
              const next = { left: rect.left, top: rect.top }
              setPosition(next)
              writeJson(STORE.position, next)
            }
          }

          const handleKeyDown = (event) => {
            const target = event.target
            if (target instanceof Element && target.closest('button, select, input, a') !== null) return
            const step = event.shiftKey ? 32 : 8
            let dx = 0
            let dy = 0
            if (event.key === 'ArrowLeft') dx = -step
            else if (event.key === 'ArrowRight') dx = step
            else if (event.key === 'ArrowUp') dy = -step
            else if (event.key === 'ArrowDown') dy = step
            else return
            event.preventDefault()
            const element = rootRef.current
            if (element === null) return
            const rect = element.getBoundingClientRect()
            const maxLeft = Math.max(MARGIN, window.innerWidth - element.offsetWidth - MARGIN)
            const maxTop = Math.max(MARGIN, window.innerHeight - element.offsetHeight - MARGIN)
            const next = {
              left: Math.min(Math.max(rect.left + dx, MARGIN), maxLeft),
              top: Math.min(Math.max(rect.top + dy, MARGIN), maxTop),
            }
            setPosition(next)
            writeJson(STORE.position, next)
          }

          const cpu = snapshot?.cpu ?? null
          const gpus = Array.isArray(snapshot?.gpus) ? snapshot.gpus : []
          const gpu = gpus[0] ?? null
          const fans = Array.isArray(snapshot?.fans) ? snapshot.fans : []
          const otherTemps = Array.isArray(snapshot?.temps) ? snapshot.temps : []
          const hasMotherboardFan = snapshot?.hasMotherboardFan === true
          const cpuTone = toneOf(cpu?.packageTempC, 75, 90)
          const gpuTone = toneOf(gpu?.tempC, 75, 85)
          const status = error !== null ? 'bad' : snapshot !== null ? 'ok' : 'idle'
          const cpuCores = Array.isArray(cpu?.coreTemps) ? cpu.coreTemps : []

          const fanText = fans.length === 0
            ? `${t('fan')} —`
            : `${t('fan')} ${fans.slice(0, 2).map((fan) => `${fan.kind === 'gpu' ? t('gpu') : fan.label} ${fmtFan(fan)}`).join(' · ')}`
          const fanNote = hasMotherboardFan ? '' : ` · ${t('cpuFanMissing')}`
          const hostTitle = snapshot?.host
            ? `${snapshot.host.hostname} · ${snapshot.host.platform} ${snapshot.host.release}`
            : t('host')

          let body = null
          if (!collapsed) {
            if (snapshot === null) {
              body = h('div', { className: 'hwmon-body' },
                h('div', { className: error === null ? 'hwmon-loading' : 'hwmon-error-text' },
                  error === null ? t('loading') : `${t('error')}: ${error}`),
              )
            } else {
              const cpuSection = h('section', { className: 'hwmon-section', key: 'cpu' },
                h('div', { className: 'hwmon-row' },
                  h('div', { className: 'hwmon-heading' },
                    h('span', { className: 'hwmon-name' }, t('cpu')),
                    h('span', { className: 'hwmon-model', title: cpu?.name ?? '' }, shortText(cpu?.name ?? '', 30)),
                  ),
                  h('div', { className: 'hwmon-temp-wrap' },
                    h('span', { className: 'hwmon-temp', style: { color: TONE_COLOR[cpuTone] } }, fmtTempValue(cpu?.packageTempC)),
                    h('span', { className: 'hwmon-unit' }, isNumber(cpu?.packageTempC) ? '°C' : ''),
                  ),
                ),
                h('div', { className: 'hwmon-bar' },
                  h('i', { style: { width: `${clampPercent(cpu?.usagePct)}%` } }),
                ),
                h('div', { className: 'hwmon-meta' },
                  metaRow('cpu-usage', t('usage'), fmtPct(cpu?.usagePct)),
                  metaRow('cpu-freq', t('freq'), fmtGHz(cpu?.freqMhz), isNumber(cpu?.maxFreqMhz) ? `${fmtGHz(cpu.maxFreqMhz)} max` : undefined),
                  metaRow('cpu-mem', t('memory'), isNumber(cpu?.mem?.pct) ? fmtPct(cpu.mem.pct) : '—', cpu?.mem ? `${fmtBytes(cpu.mem.usedBytes)} / ${fmtBytes(cpu.mem.totalBytes)}` : undefined),
                  metaRow('cpu-load', t('load'), isNumber(cpu?.load?.[0]) ? cpu.load[0].toFixed(2) : '—'),
                ),
                cpuCores.length === 0 ? null : h('div', { className: 'hwmon-cores' }, cpuCores.slice(0, 16).map((core, index) => coreCell(core, index))),
              )

              let gpuSection
              if (gpu === null) {
                gpuSection = h('section', { className: 'hwmon-section', key: 'gpu' },
                  h('div', { className: 'hwmon-row' },
                    h('div', { className: 'hwmon-heading' },
                      h('span', { className: 'hwmon-name' }, t('gpu')),
                      h('span', { className: 'hwmon-model' }, t('gpuMissing')),
                    ),
                    h('div', { className: 'hwmon-temp-wrap' },
                      h('span', { className: 'hwmon-temp', style: { color: TONE_COLOR.muted } }, '—'),
                      h('span', { className: 'hwmon-unit' }, ''),
                    ),
                  ),
                  snapshot?.gpuError ? h('div', { className: 'hwmon-note', title: snapshot.gpuError }, t('gpuError')) : null,
                )
              } else {
                const clockTitle = isNumber(gpu.clockMemMhz) ? `${t('memory')} ${fmtMhz(gpu.clockMemMhz)}` : undefined
                gpuSection = h('section', { className: 'hwmon-section', key: 'gpu' },
                  h('div', { className: 'hwmon-row' },
                    h('div', { className: 'hwmon-heading' },
                      h('span', { className: 'hwmon-name' }, t('gpu')),
                      h('span', { className: 'hwmon-model', title: gpu.name }, shortText(gpu.name, 28)),
                    ),
                    h('div', { className: 'hwmon-temp-wrap' },
                      h('span', { className: 'hwmon-temp', style: { color: TONE_COLOR[gpuTone] } }, fmtTempValue(gpu.tempC)),
                      h('span', { className: 'hwmon-unit' }, isNumber(gpu.tempC) ? '°C' : ''),
                    ),
                  ),
                  h('div', { className: 'hwmon-bar' },
                    h('i', { style: { width: `${clampPercent(gpu.utilPct)}%` } }),
                  ),
                  h('div', { className: 'hwmon-meta' },
                    metaRow('gpu-usage', t('usage'), fmtPct(gpu.utilPct)),
                    metaRow('gpu-power', t('power'), fmtPower(gpu)),
                    metaRow('gpu-mem', t('memory'), isNumber(gpu.memUsedMiB) && isNumber(gpu.memTotalMiB) ? `${fmtGiB(gpu.memUsedMiB)} / ${fmtGiB(gpu.memTotalMiB)}` : '—'),
                    metaRow('gpu-clock', t('freq'), fmtMhz(gpu.clockGfxMhz), clockTitle),
                    metaRow('gpu-fan', t('fan'), fmtPct(gpu.fanPct)),
                    metaRow('gpu-pstate', t('pstate'), gpu.pstate ?? '—'),
                  ),
                )
              }

              const foot = h('div', { className: 'hwmon-foot', key: 'foot' },
                h('div', { className: 'hwmon-foot-left' },
                  h('span', { className: 'hwmon-fanline', title: `${fanText}${fanNote}` }, `${fanText}${fanNote}`),
                  otherTemps.length === 0 ? null : h('span', { className: 'hwmon-sensors' },
                    otherTemps.slice(0, 3).map((temp) => `${temp.label} ${fmtTemp(temp.c)}`).join(' · ')),
                  error === null ? null : h('span', { className: 'hwmon-error', title: error }, `⚠ ${t('error')}`),
                ),
                h('div', { className: 'hwmon-foot-right' },
                  h('span', { className: 'hwmon-updated', title: hostTitle }, `${t('updated')} ${fmtTime(snapshot.sampledAt)}`),
                  h('select', {
                    className: 'hwmon-select',
                    value: String(intervalMs),
                    onChange: (event) => changeInterval(Number(event.target.value)),
                    'aria-label': t('interval'),
                    title: t('interval'),
                  }, INTERVALS.map((ms) => h('option', { key: ms, value: String(ms) }, `${ms / 1000}${t('seconds')}`))),
                ),
              )

              body = h('div', { className: 'hwmon-body' },
                cpuSection,
                gpuSection,
                h(Sparkline, { key: 'spark', history, label: t('tempHistory') }),
                foot,
              )
            }
          }

          const header = h('div', {
            className: 'hwmon-head',
            'data-dragging': dragging ? 'true' : 'false',
            tabIndex: 0,
            role: 'group',
            'aria-label': t('drag'),
            title: t('drag'),
            onPointerDown: beginDrag,
            onPointerMove: moveDrag,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onLostPointerCapture: endDrag,
            onKeyDown: handleKeyDown,
          },
            h('span', { className: 'hwmon-mark' }, markIcon()),
            h('span', { className: 'hwmon-title' }, t('title')),
            collapsed ? h('span', { className: 'hwmon-summary' }, `${t('cpu')} ${fmtTemp(cpu?.packageTempC)} · ${t('gpu')} ${fmtTemp(gpu?.tempC)} · ${fmtPct(gpu?.fanPct)}`) : null,
            h('span', { className: 'hwmon-spacer' }),
            h('span', { className: 'hwmon-live', 'data-state': status, 'aria-hidden': 'true' }),
            h('div', { className: 'hwmon-actions' },
              h('button', {
                type: 'button',
                className: 'hwmon-icon-btn',
                onClick: () => setRefreshNonce((value) => value + 1),
                title: t('refresh'),
                'aria-label': t('refresh'),
              }, refreshIcon()),
              h('button', {
                type: 'button',
                className: 'hwmon-icon-btn',
                onClick: toggleCollapsed,
                title: collapsed ? t('expand') : t('collapse'),
                'aria-label': collapsed ? t('expand') : t('collapse'),
              }, chevronIcon(collapsed)),
            ),
          )

          return h('div', {
            ref: rootRef,
            className: 'hwmon-root',
            'data-hw-monitor': 'true',
            'data-dragging': dragging ? 'true' : 'false',
            role: 'region',
            'aria-label': t('title'),
            style: position === null
              ? undefined
              : { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' },
          },
            h('style', null, CSS),
            header,
            body,
          )
        }

        ctx.effect(() => {
          const disposeZh = ctx.locale.register(NS, 'zh', ZH)
          const disposeEn = ctx.locale.register(NS, 'en', EN)
          return () => {
            disposeZh()
            disposeEn()
          }
        }, 'hw-monitor: dictionaries')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'hw-monitor',
          order: 40,
        }, Panel)), 'hw-monitor: overlay')
      },
    }
  },
})
