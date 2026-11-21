/** Cloud paths belong to the server, so a client-side file picker is misleading. */
export function serverPath(file: boolean): Promise<string | null> {
	return new Promise((resolve) => {
		const dialog = document.createElement("dialog");
		dialog.className = "server-path-dialog glass-strong rounded-[24px] p-6 text-fg";
		const form = document.createElement("form");
		form.method = "dialog";
		const title = document.createElement("h2");
		title.className = "mb-2 text-lg font-semibold";
		title.textContent = file ? "选择云端记忆文件" : "选择云端目录";
		const note = document.createElement("p");
		note.className = "mb-4 text-sm text-muted";
		note.textContent = "填写 VPS 上的绝对路径。文件和任务将在服务器上使用这个位置。";
		const input = document.createElement("input");
		input.className = "mb-4 h-11 w-full rounded-xl bg-sunken px-3 text-fg";
		input.placeholder = file ? "/var/lib/rally/.rally/memory/MEMORY.md" : "/var/lib/rally/rally";
		input.setAttribute("aria-label", "服务器绝对路径");
		const actions = document.createElement("div");
		actions.className = "flex justify-end gap-2";
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "rounded-full bg-sunken px-4 py-2";
		cancel.textContent = "取消";
		const submit = document.createElement("button");
		submit.className = "rounded-full bg-accent px-4 py-2 text-accent-fg";
		submit.textContent = "使用此路径";
		let value: string | null = null;
		cancel.onclick = () => dialog.close();
		form.onsubmit = (event) => {
			const path = input.value.trim();
			if (!path.startsWith("/") || path.includes("\0")) {
				event.preventDefault();
				input.setCustomValidity("请输入以 / 开头的服务器绝对路径");
				input.reportValidity();
				return;
			}
			value = path;
		};
		input.oninput = () => input.setCustomValidity("");
		const back = (event: Event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			dialog.close();
		};
		dialog.onclose = () => {
			window.removeEventListener("rally-back", back, true);
			dialog.remove();
			resolve(value);
		};
		window.addEventListener("rally-back", back, true);
		actions.append(cancel, submit);
		form.append(title, note, input, actions);
		dialog.append(form);
		document.body.append(dialog);
		dialog.showModal();
		input.focus();
	});
}
