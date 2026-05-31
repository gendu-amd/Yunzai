# 部署到微信群 —— 架构调查报告 + 部署流程

> 目标：把本仓库（Yunzai 应用端）接入**微信群**收发消息。
> 本文先讲清楚现有 repo 的设计（你要先懂"应用端/协议端分离"），再给可落地的部署流程、各方案对比与风险。
> 创建：`2026-05-30`。

---

## 0. 一句话结论

本仓库是 **TRSS-Yunzai 应用端**（`v3.1.3`），它**只是一个 WebSocket 服务端**，自己**不会登录任何聊天账号**。要上微信，必须再跑一个**微信协议端**（独立程序，负责登录真实微信、把消息按 OneBot 协议转发过来）。微信协议端主流是 **ComWeChatBotClient**，**只能在 Windows 上跑**（PC 微信 Hook）。所以"Linux 服务器 + 微信"通常是：**Linux 跑应用端，另一台 Windows 跑协议端 + 微信**，两者用 WebSocket 连起来。

---

## 1. 现有 repo 架构（设计原理）

### 1.1 分层：应用端 ⟷ 协议端（关键认知）

```
┌─────────────────────────┐         WebSocket          ┌──────────────────────────┐
│  协议端 (Protocol Side)   │  ──反向WS连接──>            │  应用端 (本仓库 Yunzai)     │
│  负责"登录某个聊天账号"     │   ws://IP:2536/<path>      │  WS 服务端 + 插件/业务逻辑   │
│  · 微信: ComWeChatClient  │  <──收发消息/调用API──>      │  · 解析消息→插件→回复        │
│  · QQ:  Lagrange/LLOneBot │                            │  · 出图(puppeteer)/Redis    │
└─────────────────────────┘                            └──────────────────────────┘
        真实微信/QQ 在这边                                     本仓库在这边
```

- **本仓库 = 应用端**：起一个 HTTP + WebSocket 服务（`lib/bot.js`，Express + `ws`，默认端口 **2536**）。它**等协议端来连**（`server.on("upgrade", wsConnect)`，`noServer` 模式）。
- **协议端 = 另一个独立程序**：它真正持有微信/QQ 登录态，按 **OneBot** 协议，用**反向 WebSocket**主动连到应用端的某个路径。
- 本仓库自己**没有**任何微信登录能力；`#扫码登录` 那种是登录**米游社**（拿游戏 ck），跟"机器人登录微信"完全是两码事，别混淆。

### 1.2 适配器（协议端类型）清单

`plugins/adapter/` 下每个文件 = 一种协议端适配器，各自注册一个 WS 路径（`Bot.wsf[path]`）：

| 适配器文件 | 平台 | 连接路径（协议端填这个） |
|---|---|---|
| `ComWeChat.js` | **微信**（OneBot v12 / ComWeChatRobot） | `ws://IP:2536/ComWeChat` |
| `OneBotv11.js` | QQ（go-cqhttp / Lagrange / LLOneBot 等） | `ws://IP:2536/OneBotv11` |
| `OPQBot.js` | QQ（OPQBot） | `ws://IP:2536/OPQBot` |
| `Milky.js` | QQ（Milky 协议） | `ws://IP:2536/Milky` |
| `GSUIDCore.js` | 早柚核心多平台 | `ws://IP:2536/GSUIDCore` |
| `Satori.js` | Satori 协议（多平台） | `ws://IP:2536/Satori` |
| `stdin.js` | 本地标准输入（**调试用**，无需协议端） | 无（直接读 stdin） |

> 微信走的就是 **`ComWeChat.js`** → 路径 **`/ComWeChat`**（`ComWeChat.js:573` 注册 `Bot.wsf["ComWeChat"]`）。它实现 OneBot v12（`get_self_info`/`get_version`/收发消息/通知/请求），即 `ComWeChatRobot` 系客户端的协议。

### 1.3 关键配置

`config/config/server.yaml`：
```yaml
url: http://localhost:2536   # 对外地址（出图链接、文件直链用）
port: 2536                   # 监听端口（协议端连这个）
auth:                        # 鉴权（默认空=不校验；公网暴露务必设）
https:                       # 可选 HTTPS（2537）
```
- 端口 **2536** 是协议端连接 & 出图/文件直链的对外端口。
- `auth` 默认空 → 任何能连到 2536 的都能接入。**公网部署必须设 auth 或用防火墙/内网**。

### 1.4 消息流（以微信群一条消息为例）

```
微信群有人发消息
 → PC微信(协议端Hook到) → ComWeChatClient 按OneBot v12 打包
 → 反向WS 发到 ws://IP:2536/ComWeChat
 → 本仓 ComWeChat.js message() 解析 → Bot.em(事件)
 → lib/plugins/loader.js 路由到匹配插件(如 #体力 / #面板)
 → 业务逻辑(取数/puppeteer出图)
 → e.reply() → ComWeChat.js 调协议端 send_message API
 → 协议端让PC微信把消息/图片发回群里
```

---

## 2. 协议端选型对比（实证调研）

> 完整逐步部署见 **§7 傻瓜式教程**（含真实下载链接 + 登录绕过 + 验证清单）。

**关键约束**：本仓微信只认 **ComWeChat(OneBot v12)** 或 **OneBotv11** 两种协议。协议端必须能说这两种话才能连 2536——这直接决定了"能不能直连"。

**大前提**：不存在"又免费又稳又不封号"的个人微信机器人方案。微信持续封杀第三方，任何方案都有封号风险。

| 方案 | 维护现状（实证） | 能否直连本仓 | 系统 | 稳定/风险 |
|---|---|---|---|---|
| ① **ComWeChat**（[ComWeChatBotClient](https://github.com/JustUndertaker/ComWeChatBotClient)） | **2023/6/5 v0.0.8 后停更**；锁微信 **3.7.0.30**；底层 [ComWeChatRobot](https://github.com/ljc545w/ComWeChatRobot) PC Hook | ✅ **唯一开箱即用**（本仓 `ComWeChat.js` 就是按它的 OneBot v12 方言写的） | 仅 Windows | 老但能用 / 中高 |
| ② **TRSS 官方 [Yunzai-WeChat-Plugin](https://github.com/TimeRainStarSky/Yunzai-WeChat-Plugin)** | 作者挂**弃用提醒**："因微信版本更新现极易封号"；账号离线 5 分钟失效、重登后所有用户 ID 变 | ✅（本仓插件） | Linux 可 | **不推荐** |
| ③ **[WeChatFerry](https://github.com/lich0821/WeChatFerry)（wcf）** | **活跃**（6k★），支持较新微信 3.9.x，PC Hook | ⚠️ 非 OneBot，需额外 **wcf↔OneBot 桥**，且不保证与本仓 ComWeChat 方言完全兼容 | 仅 Windows | 较新 / 中高（Hook 易检测） |
| ④ **iPad/Pad 协议**（gewechat / wechatpadpro / 商业 wechatapi WX859 等） | 活跃，业界公认**最稳、保号最好**（模拟官方 iPad 原生协议 + 设备指纹 + 心跳） | ⚠️ 需 **OneBot 桥**接 | Linux 可 | 最稳 / 但**多为付费协议 token**、灰产 |
| ⑤ **改用 QQ**（[Lagrange](https://lagrangedev.github.io)/LLOneBot，OneBotv11） | 活跃 | ✅ 直连 `/OneBotv11` | Linux 友好 | **最省心最稳** |

**实诚建议**：
1. 只要"连本仓最省事" → **① ComWeChat**（Windows + 微信 3.7.0.30 锁版本），唯一即插即用；
2. 最看重保号稳定 → **④ iPad 协议**，但要多搭 OneBot 桥、可能付费；
3. 能接受 QQ → **⑤ 强烈优先**，Lagrange 直连、Linux 原生、最稳；
4. **别用 ②**（官方已标弃用、极易封号）。
5. 不变本质：永远是"独立协议端 + 一个登录的小号"，本仓只是 2536 的 WS 服务端。

## 3. 常见疑问：机器人微信号要不要是群主？

**不要。** 机器人那个微信号只要是**群成员**即可，和"群主"是两个独立角色：

- **群主** = 你的主号（建群/管群）；**机器人** = 另一个**小号**，登录在 Windows 老版微信 + 协议端里，被群主拉进群当普通成员。
- 你设想的"一台机跑 2536，一台 Windows 装旧版微信登录机器人"**完全正确**，就是标准做法。2536 与 Windows 可**同机或分机**（分机时协议端 `.env` 的 `websocket_url` 填应用端 IP，并放行端口）。
- **一个机器人小号可同时服务多个群**（是哪些群的成员就能在哪些群工作），无需每群一个。
- 机器人**不需要群管理权限**就能收发消息（踢人/改公告才需管理员）。群主只需把它拉进群。
- ⚠️ 机器人**务必用小号**，第三方机器人封号高危。

## 4. 方案 B（纯 Linux，无 Windows）现状

- 用时雨 [Yunzai-WeChat-Plugin](https://gitee.com/TimeRainStarSky/Yunzai-WeChat-Plugin) 之类的 iPad/Web 协议端，可在 Linux/安卓接入微信，**不依赖 PC 微信**。
- 代价：协议端稳定性差、协议经常因微信风控失效、**封号风险更高**。
- 适合"实在没有 Windows"的情况；要长期稳定，方案 A 仍更可靠。

---

## 5. 风险与注意事项（务必读）

1. **封号**：微信严禁第三方机器人，**一定用小号**，别用主力号；控制发言频率、避免风控关键词。
2. **版本锁定**：方案 A 必须锁死 PC 微信版本 + 禁用自动更新，否则协议端随时失效。
3. **公网安全**：2536 暴露公网必须设 `server.auth` + 防火墙白名单；否则任何人都能连进来操控你的 bot。
4. **出图依赖**：`#面板`/`#体力` 等要 Chromium。Linux 服务器需装好 Chrome 及其依赖库（本机此前缺库，需补齐或用容器）。
5. **合规**：仅供学习交流，勿用于商业/批量营销。

---

## 6. 本项目已定路线与待办

**已定**：方案 ①（ComWeChat）+ 拓扑「WSL2 跑 Yunzai 应用端 + Windows 主机跑微信(小号)+协议端」。逐步照做见 **§7**。

**建议先做（不依赖微信）**：在 WSL2 把 Yunzai + 出图(Chromium)按 §7.2 跑起来，用 `stdin` 本地验证 `#体力/#面板` 能出图；通了再上 §7.3–7.5 的微信协议端。

> 待办：① WSL2 装好应用端 + Chromium 出图；② Windows 装 3.7.0.30 微信 + ComWeChatBotClient + wechatv 绕过登录；③ 配 `server.auth` + 端口放行；④ 进群按 §7.5 功能验收。

---

## 7. 傻瓜式部署教程（ComWeChat + Windows/WSL2，2026 实测要点）

> 选定方案：**ComWeChat**（本仓唯一即插即用）。已选拓扑：**WSL2 跑 Yunzai 应用端 + Windows 主机跑微信(小号)+协议端**。
> 按顺序照做即可。带 ⚠️ 的是 2026 年新增的"坑"，务必先看。

### 7.0 ⚠️ 三个必读前提（决定能否成功）

1. **微信 3.7.0.30 现在直接登录会"客户端版本过低"**（微信服务端强制升级）。必须配合 **wechatv 版本绕过工具**（启动后改内存版本号伪装成 4.0.x）才能扫码登录。**这一步不做，登不进去。**
2. **不保证长期有效**：微信 4.x 持续收紧、可能哪天彻底封死老协议。本教程是"当前已知可行"的组合，不是永久方案。登不上时看 §7.6 Plan B。
3. **会覆盖现有微信**（降级 + 数据格式不兼容）。若这台电脑你日常也用微信，**强烈建议用一台 Windows 虚拟机**专门跑机器人微信；若日常微信在手机上、这台 PC 不用微信，可直接装。

### 7.1 准备清单（含已验证的真实下载链接）

| 物料 | 下载/来源 | 说明 |
|---|---|---|
| 微信 **3.7.0.30** | `https://github.com/tom-snow/wechat-windows-versions/releases/tag/v3.7.0.30` → 资产 `WeChatSetup-3.7.0.30.exe`（159MB，sha256 `a3f1354b...`） | 必须**正好这个版本**，别用别的 |
| **ComWeChatBotClient** | 文档 `https://justundertaker.github.io/ComWeChatBotClient` ；发行版 `https://github.com/JustUndertaker/ComWeChatBotClient/releases`（v0.0.8） | 微信协议端（PC Hook，OneBot v12） |
| **wechatv**（版本绕过） | `https://github.com/KarinJS/wechatv/releases`（最新 0.2.2） | **专为 ComWeChatBotClient 做的低版本通杀**，绕过"版本过低" |
| 机器人**小号** | 一个**已实名、养过一段时间**的个人微信号 | 别用全新号(易限/封)、别用主力号 |
| 本仓代码 | 本仓库 | 跑在 WSL2 |

### 7.2 WSL2 侧：装好 Yunzai 应用端

```bash
# 在 WSL2 (Ubuntu 等，你有 sudo)
# 1) 装依赖：Node>=23.11、Redis、Git、以及 Chromium 出图依赖
sudo apt update
sudo apt install -y git redis-server \
  libgbm1 libgtk-3-0 libatk1.0-0 libatk-bridge2.0-0 libasound2 \
  libxshmfence1 libcups2 libpango-1.0-0 libxcomposite1 libxdamage1 \
  libxrandr2 libxfixes3 libatspi2.0-0 fonts-noto-cjk
# Node 用 nvm 或官方源装 v23+；redis: sudo service redis-server start

# 2) 拉代码 + 装依赖（按本仓 README / dev.sh）
git clone <你的本仓地址> Yunzai && cd Yunzai
# 安装 pnpm 依赖、插件（miao-plugin / xiaoyao-cvs-plugin 等）

# 3) 配置 config/config/server.yaml
#    - port: 2536
#    - url: http://<让微信侧能访问到的地址>:2536   # 同机 WSL2 一般 http://localhost:2536 即可
#    - auth: 建议设一个 token（见 §5 安全）

# 4) 启动
node .
# 日志出现：WebSocket 连接地址：ws://localhost:2536/[ComWeChat,...] 即就绪
```
> ✅ 好消息：你自己的 WSL2 有 sudo，出图(Chromium)装上面那些库就能用，不像共享服务器那样受限。

### 7.3 Windows 侧：装微信 + 协议端

1. **（可选但推荐）开一台 Windows 虚拟机**专跑机器人，避免覆盖日常微信。
2. 安装微信 **3.7.0.30**：运行 `WeChatSetup-3.7.0.30.exe`。**装完先别打开**。
3. **禁用微信自动更新**（否则会被升级，协议端立刻失效）：
   - 防火墙出站规则禁止微信联更新服务器，或删除/只读化微信目录下的更新程序。
4. 解压 **ComWeChatBotClient**，按其文档运行 `install.bat` 安装 COM 组件。
5. 改 ComWeChatBotClient 的 `.env`（反向 WS 指向 Yunzai）：
   ```
   websocket_type = "Backward"
   websocket_url = ["ws://localhost:2536/ComWeChat"]
   ```
   - **同机(WSL2)**：一般 `localhost:2536` 即可（WSL2 localhostForwarding）。连不上就改成 WSL2 的 IP（WSL2 里 `hostname -I` 得到的 `172.x.x.x`）。
   - **VM/另一台机**：填 Yunzai 所在机的 IP，并放行 2536 端口。

### 7.4 ⚠️ 关键：用 wechatv 绕过版本校验后再登录

1. 启动 ComWeChatBotClient（它会拉起微信 3.7.0.30）。
2. 在**扫码登录之前**，以**管理员身份**运行 **wechatv**（`KarinJS/wechatv`），它会自动找到微信进程、把内存版本号改成 4.0.x（默认即可）。
3. 回到微信窗口**扫码登录机器人小号**。此时应能正常登录（不再提示"版本过低"）。
4. ComWeChatBotClient 窗口日志里会出现机器人小号的 `wxid`（形如 `wxid_xxxx`），记下来。

### 7.5 连接 / 绑主人 / 进群验证

1. Yunzai 日志出现 `ComWeChat(WeChat) <impl>-<ver> 已连接` = 接入成功。
2. **设主人**：给机器人小号私聊发 `#设置主人`，按 Yunzai 控制台日志里的验证码确认；或把你的标识写进 `config/config/other.yaml`。
3. **拉机器人小号进你的微信群**（当普通成员即可，不需群主/管理员权限）。
4. **功能验证清单**（群里逐项发，确认"出图 + 数据正确"；原神 `#`、星铁 `*`）：
   - 路由：`#体力`→原神体力图；`*体力`→星铁开拓力图（不串游戏）；
   - 札记：`#原石`/`#原石统计`、`*星琼`/`*星琼统计`（原神显示原石/摩拉、星铁显示星琼/通票）；
   - 抽卡：`#抽卡分析`、`*抽卡分析`、`#导出记录`（UIGF 文件能被其他工具导入）；⚠️ 星铁抽卡需先贴一次游戏链接（见 `multi-game-refactor.md` §4）；
   - 面板/排行：`#面板`、`*面板`、`*白厄排行`（排行需群内有人先传过对应面板，见 `multi-game-refactor.md` §5.2）；
   - 签到、`#刷新充值记录`（原神）。
   > 若某条出错：记录"命令 + 现象 + 日志报错段"反馈，按日志定位。

### 7.6 登不上的 Plan B（当 3.7.0.30 + wechatv 也失效时）

WeChat 4.x 若彻底封死老协议，ComWeChat 这条会废。届时改用更新的协议端（但都**不是 OneBot，需要再搭一个 →OneBot 的桥**才能接回本仓 `/ComWeChat` 或 `/OneBotv11`）：

- **WeChatFerry（wcf）**：活跃维护，适配较新微信 **3.9.12.x**（见其 release 的 `w.x.y.z` 版本表）。Windows，或用 Wine-Docker 方案（`Saroth/docker_wechat`、`danni-cool/wechatbot-provider-windows`）在 Linux 跑。需 wcf↔OneBot 桥。
- **iPad/Pad 协议**（gewechat / wechatpadpro / 商业 wechatapi）：最稳、可上 Linux，但多为付费 token + 需 OneBot 桥。

> 诚实提示：**"确保能登录"无法 100% 保证**——它取决于微信服务端当下的版本管控，是动态变化的。本教程给的是 2026 年当前**已知可行**的组合（3.7.0.30 + ComWeChatBotClient + wechatv）；若失效，按 Plan B 切换。

### 7.7 安全与保号（再次强调）

- 机器人**务必用小号**；2536 若跨机/公网，必须设 `server.auth` + 防火墙白名单。
- 控制发言频率、避免风控词；接受随时可能封号，别绑重要资产。

