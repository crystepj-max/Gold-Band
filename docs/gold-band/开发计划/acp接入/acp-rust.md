> ## Documentation Index
> Fetch the complete documentation index at: https://agentclientprotocol.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Rust

## Gold Band 决策

Gold Band 将使用 Rust 侧 ACP client 接入 ACP-compatible agent adapter。Rust 负责 adapter 发现、stdio 进程管理、ACP session 生命周期、ACP 事件转发和 worker-ref 记录；Claude Agent SDK 等 provider-specific SDK 留在对应 adapter sidecar 中。

Gold Band 全面切换到 ACP，不再维护 Claude Code legacy CLI fallback、direct stream-json 可视化协议或供 UI 解析的 legacy terminal transcript。Rust 侧输出的会话数据应围绕 ACP session events、ACP raw frames、session metadata 和 adapter diagnostics 建模。

ACP 事件不再被蒸馏成 Gold Band 自研 `progress.events.jsonl`。后续会话详情直接围绕 ACP session events 建模和可视化，同时 Gold Band 继续使用 `run.json` / `round.json` / `node.json` / artifact contract 作为 runtime canonical state。

Rust 层职责边界：

- 发现并启动 ACP-compatible adapter。
- 管理 stdio child process 生命周期。
- 执行 ACP `initialize`、`session/new`、`session/load`、`session/prompt`、cancel、permission response。
- 接收 `session/update` 并转发给会话详情 ViewModel。
- 记录 ACP session id、adapter、capabilities、stop reason 和诊断 metadata。
- 不解析 Claude Code CLI 文本输出。
- 不从 terminal transcript 推导 UI 状态。
- 不让 ACP session 替代 Gold Band 的 run / round / node / artifact canonical state。

---

## 官方 Rust SDK 摘录

> Rust library for the Agent Client Protocol

The [agent-client-protocol](https://crates.io/crates/agent-client-protocol) Rust
crate provides implementations of both sides of the Agent Client Protocol that
you can use to build your own agent server or client.

To get started, add the crate as a dependency to your project's `Cargo.toml`:

```bash theme={null}
cargo add agent-client-protocol
```

Depending on what kind of tool you're building, you'll need to implement either
the
[Agent](https://docs.rs/agent-client-protocol/latest/agent_client_protocol/trait.Agent.html)
trait or the
[Client](https://docs.rs/agent-client-protocol/latest/agent_client_protocol/trait.Client.html)
trait to define the interaction with the ACP counterpart.

The
[agent](https://github.com/agentclientprotocol/rust-sdk/blob/main/src/agent-client-protocol/examples/agent.rs)
and
[client](https://github.com/agentclientprotocol/rust-sdk/blob/main/src/agent-client-protocol/examples/client.rs)
example binaries provide runnable examples of how to do this, which you can use
as a starting point.

You can read the full documentation for the `agent-client-protocol` crate on
[docs.rs](https://docs.rs/agent-client-protocol/latest/agent_client_protocol/).

## Users

The `agent-client-protocol` crate powers the integration with external agents in
the [Zed](https://zed.dev) editor.
