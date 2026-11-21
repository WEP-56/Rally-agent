// Renderer mirror of the supervisor's task board. The supervisor owns task facts; this hook only adapts them.

import { useCallback, useEffect, useState } from "react";
import type { TaskBoard, TaskView } from "../../shared/task";
import { applyTask } from "../../shared/cloud-state";
import { IpcChannel } from "../../shared/ipc";
import { cloudRead } from "./cloud-cache";
import type { Task } from "./data";
import { messagesOf } from "./task-messages";



export interface TaskBoardState {
	tasks: Task[];
	board: TaskBoard;
	approve(taskId: string): Promise<void>;
	cancel(taskId: string): Promise<void>;
	setAutoApprove(enabled: boolean): Promise<void>;
}

export function useTasks(): TaskBoardState {
	const api = window.rally.tasks;
	const [board, setBoard] = useState<TaskBoard>(() => cloudRead<TaskBoard>(IpcChannel.tasksState) ?? { tasks: [], active: 0, limit: 2, autoApprove: false });

	useEffect(() => {
		let alive = true;
		let received = false;
		void api.getState().then((next) => {
			if (alive && !received) setBoard(next);
		}).catch(() => {});
		const off = api.onEvent((event) => {
			received = true;
			setBoard((current) => applyTask(current, event));
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
		schedule: view.schedule,
		archivedAt: view.archivedAt,
		ended: Boolean(view.ended),
		toolCalls: view.toolCalls,
		gates: view.gates,
		lastExternalAction: view.lastExternalAction,
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
