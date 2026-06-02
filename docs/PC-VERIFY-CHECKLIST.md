# PC 验证清单（本地无 Chromium，需你在 PC 终验）

> 本轮(契约层统一装配 + 派发地基 + 去侵入)在隔离环境已验**加载/路由/能力装配/数据一致**;
> **出图视觉 + 真实网络/写流程**本机做不了,集中在此供你 PC 验证。

## 0. 先推送各仓(sandbox 无凭据)
```bash
cd Yunzai                       && git push
cd plugins/genshin              && git push
cd plugins/miao-plugin          && git push
cd plugins/xiaoyao-cvs-plugin   && git push
```
(各仓工作区均干净,详见 `git log`。)

## 1. 启动自检（应全部正常）
- 启动日志应出现:`自动装配能力 [account/gameRegistry/gacha] ← genshin`、`[gameData/rank] ← miao-plugin`、`装配游戏前缀 [sr]/[zzz] ← genshin`。
- 无 `载入插件错误/SyntaxError/Cannot find`。

## 2. 出图视觉（重点，本机出不了图）
逐条发命令,确认**出图正常、版式无错位**:
- `#面板` / `*角色面板`(miao 面板,经 profile:beforeRender hook 路径)
- `#体力` / `*体力`(genshin/xiaoyao 体力图)
- `#原神抽卡记录` / 抽卡分析
- `#今日素材`、`#深渊`、角色卡片/图鉴
- xiaoyao 换肤体力、签到图

## 3. 迁移路径端到端（数据已验等价,验出图/真账号）
xiaoyao 已改走 core 能力(旧 file:// 退为 fallback),验真实账号下功能正常:
- 体力(dailyNote)、抽卡/充值(gacha)、绑定 CK(bindCookie)、角色名↔ID(gameData)、批量签到(forEachUser)。
- 检查日志**不应**出现 `[deprecated] xiaoyao 走旧 file://`(出现=新路径没生效、走了 fallback,需排查)。

## 4. 懒激活（可选）
- 现有插件均不适合懒激活(都含 provide/Bot 补丁/task),无需验。
- 若新增纯命令插件,按 `docs/lazy-activation-guide.md` 加 manifest.activation。

## 5. 待决策/待做（PC 上确认后推进）
- **S-1 派发语义**(首匹配 return → 权限拒绝/异常 continue):**行为变更**,本机未做,需你确认是否要;做则重做 baseline。
- **A-1 ark 去覆盖**:需 ark 排名服务器可达 + 出图;给 `profile:beforeRender` payload 加 `tplName` → ark 改订阅 → 删 `#ark替换文件`。
- **退场 fallback 真删**:已迁路径的旧 file:// fallback,确认一段时间零 `[deprecated]` 告警后物理删除(ADR-004)。
- **`_miao_path` 解耦**:框架 render→miao 资源路径耦合(大件,需设计)。

## 6. 回归护栏（任何派发改动后必跑）
```bash
bash .devenv/baseline.sh --check    # 23 条命令路由零回归
bash .devenv/verify.sh "#状态" "#体力"
```
