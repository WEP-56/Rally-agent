// Renderer mirror of the supervisor's task board. The supervisor owns task facts; this hook only adapts them.

import { useCallback, useEffect, useState } from "react";
import type { TaskBoard, TaskView } from "../../shared/task";
import type { Task, TaskMsg } from "./data";

const api = window.rally.tasks;

export interface TaskBoardState {
	tasks: Task[];
	board: TaskBoard;
	approve(taskId: string): Promise<void>;
	cancel(taskId: string): Promise<void>;
	setAutoApprove(enabled: boolean): Promise<void>;
}

export function useTasks(): TaskBoardState {
	const [board, setBoard] = useState<TaskBoard>({ tasks: [], active: 0, limit: 2, autoApprove: false });

	useEffect(() => {
		let alive = true;
		void api.getState().then((next) => {
			if (alive) setBoard(next);
		});
		const off = api.onEvent((event) => {
			setBoard((current) => {
				if (event.type === "snapshot") return event.board;
				const exists = current.tasks.some((task) => task.id === event.task.id);
				const tasks = exists
					? current.tasks.map((task) => (task.id === event.task.id ? event.task : task))
					: [...current.tasks, event.task];
				return { ...current, tasks };
			});
		});
		return () => {
			alive = false;
			off();
		};
	}, []);

	const approve = useCallback(async (taskId: string) => {
		setBoard(await api.approve(taskId));
	}, []);
	const cancel = useCallback(async (taskId: string) => {
		setBoard(await api.cancel(taskId));
	}, []);
	const setAutoApprove = useCallback(async (enabled: boolean) => { setBoard(await api.setAutoApprove(enabled)); }, []);

	return { tasks: board.tasks.map(toTask), board, approve, cancel, setAutoApprove };
}

function toTask(view: TaskView): Task {
	const status = view.status;
	return {
		id: view.id,
		title: view.title,
		summary: view.lastReport?.summary ?? view.statusText,
		status,
		createdAt: view.createdAt,
		duration: view.statusText,
		progress: 0,
		tags: [view.mode, ...view.scope.slice(0, 2)],
		messages: messagesOf(view),
		approval: view.approval.state,
		mode: view.mode,
		scope: view.scope,
		cwd: view.cwd,
		quotes: view.quotes,
		note: view.note,
		dependsOn: view.dependsOn,
	};
}

function messagesOf(view: TaskView): TaskMsg[] {
	const messages: TaskMsg[] = view.quotes.map((quote) => ({ role: "rally", text: quote.text }));
	if (view.note) messages.push({ role: "rally", text: `主 agent 备注：${view.note}` });
	if (view.lastReport) messages.push({ role: "agent", text: `${view.lastReport.state}：${view.lastReport.summary}` });
	if (view.changedFiles?.length) messages.push({ role: "agent", text: `改动文件：${view.changedFiles.join(", ")}` });
	return messages;
}
