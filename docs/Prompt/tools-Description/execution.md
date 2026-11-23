# 命令、作业与服务

[返回工具分类](rally-tools.md)

## bash

- 源码路径：`src/main/supervisor/job-tools.ts`（`createJobTools`；可用角色：Worker）
- 提示词原文：`Run a command in the task cwd. Commands exceeding the foreground window become background jobs; completion automatically wakes or steers you. timeout is seconds (default unlimited). Do not sleep or poll; continue other work or end this turn while a job runs. Full output is logged; tool output is bounded.`
- 参数：`shellSchema`：`command` 为非空字符串；`timeout` 可选，秒数，>0 且 ≤2147483。

## powershell

- 源码路径：`src/main/supervisor/job-tools.ts`（`createJobTools`；仅 Windows Worker）
- 提示词原文：`Run a command in the task cwd. Commands exceeding the foreground window become background jobs; completion automatically wakes or steers you. timeout is seconds (default unlimited). Do not sleep or poll; continue other work or end this turn while a job runs. Full output is logged; tool output is bounded.`
- 参数：同 `bash`，使用 `shellSchema`：`command` 为非空字符串；`timeout` 可选，秒数，>0 且 ≤2147483。

## job_output

- 源码路径：`src/main/supervisor/job-tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Immediately read this task's job state and last output lines (default 200, max 2000; bounded bytes). Does not wait; completion is delivered automatically. Other tasks' jobs are inaccessible.
```
- 参数：

```ts
outputSchema = Type.Object({ jobId: Type.String(), tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })) })
```

## job_kill

- 源码路径：`src/main/supervisor/job-tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Stop this task's job process tree, escalating after five seconds if needed. Waits for termination confirmation. Other tasks' jobs are inaccessible.
```
- 参数：

```ts
killSchema = Type.Object({ jobId: Type.String() })
```

## service_start

- 源码路径：`src/main/supervisor/service-tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Start a long-lived service using PowerShell on Windows or Bash elsewhere. cwd defaults to the task cwd. Wait up to 30 seconds for a listening local port or readyPattern; ready=false may still be running. Services survive task completion, do not occupy worker slots and never wake workers. Use jobs for finite commands. Environment values are not saved in service records.
```
- 参数：

```ts
startSchema = Type.Object({ name: Type.String({ minLength: 1 }), command: Type.String({ minLength: 1 }), cwd: Type.Optional(Type.String()), port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })), readyPattern: Type.Optional(Type.String({ maxLength: 256 })), env: Type.Optional(Type.Record(Type.String(), Type.String())) })
```

## service_status

- 源码路径：`src/main/supervisor/service-tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Immediately read this task's service state and bounded output tail (default 200 lines, max 2000). Does not wait or wake a worker.
```
- 参数：

```ts
statusSchema = Type.Object({ serviceId: Type.String(), tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })) })
```

## service_stop

- 源码路径：`src/main/supervisor/service-tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Stop a service owned by this task, including one from a previous run. Wait for process tree termination; other tasks' services are inaccessible.
```
- 参数：

```ts
stopSchema = Type.Object({ serviceId: Type.String() })
```
