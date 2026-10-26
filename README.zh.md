# dsh-hw-monitor

[English](README.md) · **简体中文**

一个可拖动的 DSH Web 硬件监控面板。默认位于界面右下角（输入栏右侧），实时显示 CPU/GPU 温度、占用、频率、功耗、显存和风扇转速。

## 两种可切换视图

面板提供两种共享同一份实时数据、原地切换的视图：

- **面板视图**（默认）——完整圆角卡片：CPU Package 与各核心温度、占用条、频率、内存、负载；GPU 温度、功耗、显存、频率、P-State、风扇；其他传感器温度和温度趋势线。
- **摘要视图**——单行标题栏：`CPU 77°C · GPU 81°C · 44%`。遮住对话内容或只需要看关键数字时使用。

点击标题栏右侧的箭头切换。选择保存在
`localStorage['dsh.hw-monitor.collapsed']`，刷新页面后保持。拖动、轮询和刷新间隔由两种视图共享。

## 组成

- **Host 端**（`index.js`、`collect.js`）：一个只读 JSON 路由
  `GET /api/hw-monitor/snapshot`，读取 Linux `procfs`/`sysfs` 并调用
  `nvidia-smi`；不需要 root 权限，也没有第三方依赖。
- **浏览器端**（`client.js`）：注册到 `shell.overlay` 的浮层面板；位置、视图和刷新间隔保存在 `localStorage`。

## 安装

标准 DSH profile 安装方式：

```text
dsh plugin --profile web add @jzjerry/dsh-hw-monitor
```

把 `web` 换成你实际使用的 profile。该命令会把包加入 profile 依赖和 bundle
列表；profile 重新组合后面板即挂载（未启用 HMR 的 profile 重启 `dsh web` 后生效）。

从本地 checkout 安装时，把包目录传给同一个命令：

```text
dsh plugin --profile web add /本目录的绝对路径
```

bundle patch 会插入一行 `hw-monitor`，包名为
`@jzjerry/dsh-hw-monitor`。Client 模块图更新后无需刷新；如果没有自动生效，刷新一次页面即可。

如果还装着旧的本地版本（`@local/dsh-hw-monitor` 或
`@local/dsh-perf-monitor`），请先移除，避免两个面板同时注册：

```text
dsh plugin --profile web remove @local/dsh-hw-monitor
dsh plugin --profile web remove @local/dsh-perf-monitor
```

## 交互

- 拖动标题栏移动面板；标题栏聚焦后可用方向键微调（Shift 加大步长）。位置保存在
  `localStorage['dsh.hw-monitor.position']`。
- 刷新按钮立即拉取一次；下拉框切换轮询间隔（1 秒 / 2 秒 / 5 秒），保存在
  `localStorage['dsh.hw-monitor.interval']`。
- 浏览器标签页隐藏时暂停轮询，恢复可见时立即刷新。

## 硬件说明

- CPU 温度来自 `coretemp`/`k10temp` hwmon（`Package` 与各 `Core` 标签），缺失时回退到 `x86_pkg_temp`。
- GPU 数据来自 `nvidia-smi`；可用 `DSH_HW_MONITOR_NVIDIA_SMI` 指向非标准路径。消费级 GPU 通过 NVML 只暴露风扇百分比，不暴露 RPM。
- 任何 hwmon 的 `fan*_input` 都会列入风扇区。开发用的 Intel NUC 11 Extreme 由 EC 控制风扇，未暴露转速，因此面板会明确显示“CPU/机箱风扇未暴露”，不会伪造数值。
- CPU 功耗使用 Intel RAPL 计数器；普通用户通常无读权限，因此该项自动隐藏。
- 多 GPU 机器：面板展示第一块 GPU，接口返回全部。

## 路由约定

`GET /api/hw-monitor/snapshot` → `200 application/json`，`cache-control:
no-store`。loopback 请求直接允许；远程请求需要已认证/已配对的浏览器会话。其他方法返回 `405`，未配对的非 loopback 请求返回 `403`。

载荷采用尽力而为策略：单个数据源读取失败时变为 `null` 或记入
`errors`，其余快照数据照常返回。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 插件：路由、信任边界、快照缓存 |
| `collect.js` | sysfs/procfs/nvidia-smi 采集器 |
| `client.js` | 可拖动浮层面板 |
| `cordis.patch.yml` | 插入 `hw-monitor` bundle 行 |
| `locale/*.json` | Plugin Manager 标题与描述 |
| `icon.svg` | 插件图标 |
