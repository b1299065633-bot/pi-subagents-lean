# pi-subagents-lean（上游 0.23.1）

<!-- token-benchmark:summary:start -->
> **Token 基准：Lean 276，上游 `@tintinweb/pi-subagents@0.23.1` 8,522，减少 96.8%。**
<!-- token-benchmark:summary:end -->
> 基于 [kunkun9527/pi-subagents-lean](https://github.com/kunkun9527/pi-subagents-lean) 的复刻，重新锁定到上游 `@tintinweb/pi-subagents` **0.23.1** 并重测。原作者完整配置参考：[my-lean-pi-setup](https://github.com/kunkun9527/my-lean-pi-setup)。

[English](README.md)

基于 [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) 的精简封装。在完整保留上游 Subagent 功能与运行时的同时，将所有操作收束为一个紧凑的工具接口，显著降低上下文占用。

## 初始化上下文占用对比

<!-- token-benchmark:benchmark:start -->
单独启用本扩展时，模型可见的常驻初始化上下文如下：

| 版本 | 工具与 Prompt 构成 | 合计 |
| --- | --- | ---: |
| Lean `pi-subagents-lean@0.23.1` | `subagent` (276) | **276** |
| 上游 `@tintinweb/pi-subagents@0.23.1` | `Agent` (2,550) + `SubagentWorkflow` (5,606) + `get_subagent_result` (183) + `steer_subagent` (183) | **8,522** |

节省 **8,246 tokens（96.8%）**。
测量环境为 Pi 1.5.0 的独立临时进程、空白工作目录与空白配置。排除内置工具、Skills、上下文文件、会话历史、用户消息、无关扩展、运行时 UI 与 Slash Commands；计入扩展的 `before_agent_start` 注入。Token 是按 `ceil(字符数 / 4)` 计算的固定字符代理估算，并非模型 tokenizer 实际计费值。
<!-- token-benchmark:benchmark:end -->

## 核心特性

* 完整保留上游能力：包括 Agent 发现、后台派生运行、结果获取、动态引导（Steering）以及完整的生命周期管理。
* 统一工具入口：将原版的 `Agent`、`get_subagent_result` 与 `steer_subagent` 整合为单个 `subagent` 工具。
* 按需加载高级参数：复杂参数和完整 Schema 仅在调用 `help` 或传入 JSON 时展开，不再默认常驻于 Prompt 中。
* 可用 Agent 名单：`subagent_type` 显示扩展启动时捕获的已启用类型。修改 Agent 定义或设置后需重新加载扩展；上游描述格式无法识别时，通过 `help` 搭配 `input: "run"` 查询。

本扩展并未简化或重写核心逻辑，而是仅对提供给模型的 Prompt 工具描述进行了深度精简。

## 安装

```bash
pi install git:github.com/b1299065633-bot/pi-subagents-lean
```

请勿与其它 `pi-subagents` 包装扩展同时加载，以防重复注册工具。

## 使用方法

模型仅会看到一个工具：

```text
subagent
```

支持的操作包括 `run`、`result`、`steer`、`workflow` 和 `help`。

```json
{
  "op": "run",
  "prompt": "Find the implementation of the cache key.",
  "description": "Locate cache key",
  "subagent_type": "Explore",
  "run_in_background": true
}
```

* 使用 `result` 搭配 `agent_id` 查看已完成任务的输出结果。
* 使用 `steer` 搭配 `agent_id` 与 `message` 调整正在运行中的 Agent。
* 使用 `help` 按需查看上游高级参数配置。
* 调用漏传 `op` 时，仅在无歧义时自动推断：带 `prompt` 或 `subagent_type` 视为 `run`；带 `agent_id` 视为 `result`，同时带 `message` 则视为 `steer`。两类字段混用时不推断，照常校验报错。
* `input` 误传为对象而非 JSON 字符串时，会自动序列化。

## 重要提醒：检查 Agent 定义配置

上游运行时会自动扫描全局、工作区及项目目录中的内置与自定义 Agent。本仓库不包含任何私有 Agent、会话或记忆配置，但完整继承了这一发现机制。

安装完成后建议：

1. 检查扫描到的所有 Agent 定义，确保其 `model` 字段指向你当前环境中可用的模型。
2. 移除不需要的 Agent 类型。
3. 根据个人工作流调整 Prompt、工具绑定及扩展白名单。
4. 注意命名冲突：同名的自定义 Agent 可能会根据优先级覆盖内置类型。

原版自带 `general-purpose`、`Explore` 和 `Plan` 三种预设，你的环境可能会额外加载其他自定义类型。

## 为什么是 0.23.1 而不是 0.22.1

上游 0.23.x 带了几个实际会咬人的修复，所以本复刻不再锁 0.22.1：

* **内置 `Explore` 改为继承会话模型**，不再硬写 `anthropic/claude-haiku-4-5`。没有 Anthropic provider 的会话里，旧的那条 pin 会去找“任何有 key 的 provider”的 haiku，要么串到别家模型，要么直接失败。
* **`get_subagent_result` 和 `resume` 在 agent 记录被驱逐或 reload 后仍可用**。以前 agent 完成后约 10 分钟，完成通知还指着它，工具却回 `Agent not found`。
* `tools:` 支持 Claude Code 的工具名（`Read`、`Glob`、`Bash`），裸写 `mcp__<server>__<tool>` 现在能精确筛选 MCP 工具，而不是被当作未知项丢掉。
* Workflow 完成通知按 agent 计数而不是进度事件，跑完的批次不再显示为运行中。

0.23.1 另外让会话查看器按 pi transcript 的方式渲染工具调用，并支持 reload 后按 handle 找到已完成的 agent。

本次升版 **facade 本身不需要改动**：它按名字取上游的 `Agent`、`get_subagent_result`、`steer_subagent`、`SubagentWorkflow` 四个工具，这四个名字在 0.23.x 没变。

## 版本说明

上游运行时锁定为 `@tintinweb/pi-subagents@0.23.1`，需要 Pi 1.1.0 或更新版本。

## 本地开发

```bash
npm ci
npm run check
```

### 升上游

`@tintinweb/pi-subagents` 发新版时，一个脚本完成「改依赖 + 重测 + 改本文数字」：

```bash
npm run sync-upstream                 # 只核对：版本、逐工具 token、差值
npm run sync-upstream -- --to 0.24.0  # 装新版、重测、改 package.json 与两份 README
```

它不执行任何 git 命令（提交、tag、release 仍然手动）。如果报「lean 应只注册一个 subagent 工具」，说明上游改了工具名，先改 `index.ts` 里取名字的那几行。

## 开源协议与致谢

MIT 协议。本项目封装自采用 MIT 协议的 [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents)。