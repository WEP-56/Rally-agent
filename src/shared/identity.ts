export interface IdentityText {
	name: string;
	personality: string;
	workstyle: string;
}

export interface IdentityState extends IdentityText {
	/** Local, normalized PNG data URL; null uses Rally's bundled icon. */
	avatar: string | null;
}

export const IDENTITY_LIMITS = { name: 40, personality: 2000, workstyle: 4000 } as const;
export const DEFAULT_IDENTITY: IdentityState = {
	name: "Rally",
	personality: "冷静、可靠、直截了当，偶尔带一点幽默感",
	workstyle: "先规划后执行；把大目标拆成小任务交给工位并行处理；涉及删除或外部写入前先征求确认",
	avatar: null,
};
