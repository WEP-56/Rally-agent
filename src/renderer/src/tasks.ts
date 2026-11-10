// Renderer mirror of the supervisor's task board. The supervisor owns task facts; this hook only adapts them.

import { useCallback, useEffect, useState } from "react";
import type { TaskBoard, TaskView } from "../../shared/task";
import { questionViews } from "../../shared/task";
import type { Task } from "./data";
import { messagesOf } from "./task-messages";

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
				const open = tasks.filter((task) => !task.ended);
				const ended = tasks.filter((task) => task.ended && task.archivedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id.slice(2)) - Number(a.id.slice(2))).slice(0, 20);
				const archived = tasks.filter(task => task.archivedAt !== undefined);
				const questions = [...(current.questions ?? []).filter((item) => item.taskId !== event.task.id), ...questionViews(event.task)];
				return { ...current, tasks: [...open, ...ended, ...archived], questions };
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
