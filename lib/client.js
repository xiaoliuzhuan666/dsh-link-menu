window.__ModuleLoader__.load({
	id: "dsh-link-menu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * Right-click menu for chat links — PURE PLUGIN, no app patch.
		 *
		 * What this plugin needs, and where each piece already exists
		 * ----------------------------------------------------------
		 * 1. The local path of a file mention.
		 *    baseline `dsh-web-frontend` renders it on the button it already
		 *    produces:
		 *      <button className={css.fileMention + " " + css.fileLink}
		 *              title={path} onClick={openFile}>{text}</button>
		 *    `title` is the raw path DSH shows — often workspace-relative.
		 *    (`dsh-client-ui-deliverables` sets the same attribute to the
		 *    produced file's absolute path.)
		 *
		 * 2. The workspace root, to make that path absolute.
		 *    The Host rejects a relative path from `openWorkspacePath`
		 *    (`fs.processPathFromHostPath` returns undefined), so the caller must
		 *    join it first. The root is on the client-side Session store:
		 *      ctx.sessions.list.getSnapshot().byId[sessionId].cwd
		 *
		 * 3. The session id of the chat the user right-clicked in.
		 *    `dsh-client-ui-conversation` stamps it on the conversation root:
		 *      <div data-conversation-session={sessionId} ...>
		 *    which is the same hook DSH's own Escape handler uses.
		 *
		 * 4. A way to show a menu.
		 *    The Electron main process cannot help: it never reads
		 *    `params.linkURL`, and a file mention is a <button> so Chromium
		 *    reports "" there anyway. So this plugin draws its own popup and
		 *    `preventDefault()`s the native one. Nothing in the app bundle has to
		 *    change for that.
		 *
		 * 5. Reveal.
		 *    `remote.session.openWorkspacePath({ path, action: "reveal" })`,
		 *    which resolves and runs `open -R` (macOS) / `explorer /select`.
		 *    Only the Host can do it — the workspace root lives there — but the
		 *    caller may live anywhere, so no patch is needed here either.
		 *
		 * Everything above was verified against a shipping 0.2.1-rc.5 install:
		 * `title`, `data-conversation-session`, `ctx.sessions.list.byId[].cwd`
		 * and `openWorkspacePath` all exist in unmodified builds.
		 */

		const MENU_ID = "dsh-link-menu-popup";
		const ATTR_LINE = "data-dsh-file-line";
		/** Session identity of the chat surface, stamped by ui-conversation. */
		const ATTR_SESSION = "data-conversation-session";
		/** Class fragments ui-chat/ui-tool put on a rendered file reference. */
		const FILE_CLASS = 'button[class*="fileLink"], button[class*="fileMention"]';

		/** Label table. Chinese browsers get Chinese, everything else English. */
		function labels() {
			const zh = (navigator.language || "").toLowerCase().startsWith("zh");
			return zh
				? {
						reveal: "在 Finder 中显示",
						copyPath: "复制文件路径",
						copyRel: "复制相对路径",
						openBrowser: "在浏览器中打开",
						copyLink: "复制链接地址",
						notFound: "找不到该文件所在的会话"
					}
				: {
						reveal: "Reveal in Finder",
						copyPath: "Copy File Path",
						copyRel: "Copy Relative Path",
						openBrowser: "Open in Browser",
						copyLink: "Copy Link Address",
						notFound: "Cannot resolve the session for this file"
					};
		}

		/** A quick toast, so a failed action is not silent. */
		function toast(text) {
			const box = document.createElement("div");
			box.setAttribute(
				"style",
				[
					"position:fixed",
					"left:50%",
					"bottom:48px",
					"transform:translateX(-50%)",
					"z-index:2147483001",
					"padding:8px 14px",
					"border-radius:8px",
					"background:rgba(38,38,40,0.98)",
					"color:#f2f2f4",
					"font-size:13px",
					"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
					"box-shadow:0 8px 28px rgba(0,0,0,0.42)",
					"border:1px solid rgba(255,255,255,0.10)",
					"pointer-events:none",
					"user-select:none"
				].join(";")
			);
			box.textContent = text;
			document.body.appendChild(box);
			setTimeout(() => {
				if (box.parentNode !== null) box.parentNode.removeChild(box);
			}, 1800);
		}

		/** Remove a previously opened menu, if any. */
		function closeMenu() {
			const old = document.getElementById(MENU_ID);
			if (old !== null && old.parentNode !== null) old.parentNode.removeChild(old);
		}

		/** Copy through the async clipboard API, falling back to a hidden textarea. */
		async function copyText(text) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				try {
					const area = document.createElement("textarea");
					area.value = text;
					area.style.position = "fixed";
					area.style.opacity = "0";
					document.body.appendChild(area);
					area.select();
					const ok = document.execCommand("copy");
					document.body.removeChild(area);
					return ok;
				} catch {
					return false;
				}
			}
		}

		function isAbsolutePath(p) {
			return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p) || p.startsWith("\\\\");
		}

		/** Join a workspace-relative path onto a root, keeping the OS separator style. */
		function joinPath(cwd, p) {
			if (cwd === undefined || cwd === "") return p;
			if (isAbsolutePath(p)) return p;
			const windowsRoot = /^[A-Za-z]:[/\\]/.test(cwd) || cwd.includes("\\");
			const sep = windowsRoot ? "\\" : "/";
			const root = cwd.replace(/[/\\]+$/, "");
			const rest = p.replace(/^\.?[/\\]+/, "");
			return `${root}${sep}${windowsRoot ? rest.replace(/\//g, "\\") : rest.replace(/\\/g, "/")}`;
		}

		/** The session id of the conversation surface containing `element`. */
		function sessionIdOf(element) {
			if (!(element instanceof Element)) return null;
			const holder = element.closest(`[${ATTR_SESSION}]`);
			if (holder === null) return null;
			const id = holder.getAttribute(ATTR_SESSION);
			return id === null || id === "" ? null : id;
		}

		/** Read the workspace root for one session off the client-side Session store. */
		function cwdOf(ctx, sessionId) {
			if (sessionId === null || sessionId === undefined) return undefined;
			try {
				const service = ctx.get("sessions");
				const list = service?.list;
				if (list === undefined || typeof list.getSnapshot !== "function") return undefined;
				const row = list.getSnapshot()?.byId?.[sessionId];
				const cwd = row?.cwd;
				return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
			} catch {
				return undefined;
			}
		}

		/**
		 * Strip the decorations DSH appends to a rendered file reference:
		 * a trailing `:12` / `:12:3` line marker, and the `查看 … 的改动` wrapper
		 * the edited-file card uses in `aria-label`.
		 */
		function cleanPath(raw) {
			if (typeof raw !== "string") return "";
			let p = raw.trim().replace(/\s+/g, " ");
			const wrapped = p.match(/^查看 (.+) 的改动$/);
			if (wrapped !== null) p = wrapped[1].trim();
			return p;
		}

		/**
		 * Candidate paths for one element, most trustworthy first.
		 * `title` wins: it is the exact path the component was given. The
		 * visible text is the fallback for mentions rendered without a title
		 * (which the inline-code path does when it resolves through a provider).
		 *
		 * The type gate is the class whitelist in FILE_CLASS, not this text
		 * heuristic: only an element DSH renders as a file reference ever
		 * reaches here. The `/`-or-extension test below exists to drop
		 * decorations, not to decide whether the element is a file.
		 */
		function candidatePaths(el) {
			const out = [];
			const title = el.getAttribute("title");
			if (title !== null && title !== "") out.push(cleanPath(title));
			const aria = el.getAttribute("aria-label");
			if (aria !== null && aria !== "") {
				const cleaned = cleanPath(aria);
				// aria-label on chat chrome is prose ("发送", "关闭"); a path has a
				// separator or an extension. Keep the check cheap and honest.
				if (/[/\\]/.test(cleaned) || /\.[A-Za-z0-9]{1,8}$/.test(cleaned)) out.push(cleaned);
			}
			const text = (el.textContent || "").trim();
			if (text !== "" && (/[/\\]/.test(text) || /\.[A-Za-z0-9]{1,8}$/.test(text))) {
				out.push(cleanPath(text.split("\n")[0]));
			}
			return out.filter((v, i) => v !== "" && out.indexOf(v) === i);
		}

		/**
		 * Resolve the link target under the pointer.
		 * @returns {{kind:"file",path:string,abs:string,cwd:?string,line:?number}
		 *          |{kind:"url",href:string}|null}
		 */
		function linkAt(ctx, target) {
			if (!(target instanceof Element)) return null;

			// http(s): a real <a href> in the markdown "link" case, sometimes wrapped.
			const anchor = target.closest("a[href]");
			if (anchor !== null) {
				const href = anchor.getAttribute("href");
				if (href !== null && /^https?:/i.test(href)) return { kind: "url", href };
			}

			// File reference: the button DSH renders for a mention or a chip.
			const fileEl = target.closest(FILE_CLASS);
			if (fileEl === null) return null;
			const paths = candidatePaths(fileEl);
			if (paths.length === 0) return null;

			const sessionId = sessionIdOf(fileEl);
			const cwd = cwdOf(ctx, sessionId);

			// Prefer a candidate that is already absolute; otherwise resolve every
			// relative candidate against the session root and take the first.
			let abs = "";
			for (const p of paths) {
				if (isAbsolutePath(p)) {
					abs = p;
					break;
				}
			}
			if (abs === "" && cwd !== undefined) abs = joinPath(cwd, paths[0]);
			if (abs === "") abs = paths[0];

			const lineAttr = fileEl.getAttribute(ATTR_LINE);
			const line = lineAttr === null || lineAttr === "" ? null : Number(lineAttr);
			return {
				kind: "file",
				path: paths[0],
				abs,
				cwd,
				line: Number.isFinite(line) ? line : null
			};
		}

		/**
		 * Build and show the menu at the pointer.
		 * @param items - label/run pairs, rendered top to bottom.
		 * @param ev - the originating contextmenu event, for positioning.
		 */
		function showMenu(items, ev) {
			closeMenu();
			const box = document.createElement("div");
			box.id = MENU_ID;
			// Inline styles keep the menu independent of the dashboard stylesheet,
			// which is hashed and changes between builds.
			box.setAttribute(
				"style",
				[
					"position:fixed",
					"z-index:2147483000",
					"min-width:180px",
					"padding:4px",
					"border-radius:8px",
					"background:rgba(38,38,40,0.98)",
					"color:#f2f2f4",
					"font-size:13px",
					"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
					"box-shadow:0 8px 28px rgba(0,0,0,0.42)",
					"border:1px solid rgba(255,255,255,0.10)",
					"user-select:none"
				].join(";")
			);
			for (const item of items) {
				const row = document.createElement("div");
				row.textContent = item.label;
				row.setAttribute(
					"style",
					"padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap"
				);
				row.addEventListener("mouseenter", () => {
					row.style.background = "rgba(255,255,255,0.12)";
				});
				row.addEventListener("mouseleave", () => {
					row.style.background = "transparent";
				});
				row.addEventListener("click", (clickEvent) => {
					clickEvent.preventDefault();
					clickEvent.stopPropagation();
					closeMenu();
					void item.run();
				});
				box.appendChild(row);
			}
			document.body.appendChild(box);

			// Keep the menu inside the viewport: prefer the pointer, flip when the
			// box would overflow the right or bottom edge.
			const rect = box.getBoundingClientRect();
			let x = ev.clientX;
			let y = ev.clientY;
			if (x + rect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - rect.width - 8);
			if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8);
			box.style.left = `${x}px`;
			box.style.top = `${y}px`;
		}

		/**
		 * Reveal an absolute path through the Host Remote.
		 * @param entry - the resolved file link.
		 * @returns true when the host accepted the request.
		 */
		async function revealFile(ctx, entry) {
			let remote;
			try {
				remote = ctx.get("remote");
			} catch {
				return false;
			}
			const session = remote?.session;
			if (session === undefined || session === null || typeof session.openWorkspacePath !== "function") {
				return false;
			}
			try {
				const result = await session.openWorkspacePath({ path: entry.abs, action: "reveal" });
				return result?.ok === true || result === true;
			} catch {
				return false;
			}
		}

		/** Open an http(s) URL in the system browser. */
		function openExternal(url) {
			try {
				window.open(url, "_blank", "noopener,noreferrer");
			} catch {
				/* a blocked popup is not worth surfacing */
			}
		}

		/**
		 * The contextmenu handler. Registered on the capture phase so it runs
		 * before any component-level handler that might stop propagation.
		 */
		async function onContextMenu(ctx, ev) {
			const entry = linkAt(ctx, ev.target);
			if (entry === null) {
				// Not a link: leave the native menu alone (text selection, copy, …).
				return;
			}
			const t = labels();

			if (entry.kind === "url") {
				ev.preventDefault();
				ev.stopPropagation();
				showMenu(
					[
						{ label: t.openBrowser, run: () => openExternal(entry.href) },
						{ label: t.copyLink, run: () => copyText(entry.href) }
					],
					ev
				);
				return;
			}

			// A relative path that could not be joined is not worth a menu: the
			// Host would reject it and the user would see nothing happen. Leave the
			// native menu in place (it still offers Copy) and say why.
			if (!isAbsolutePath(entry.abs)) {
				toast(t.notFound);
				return;
			}

			ev.preventDefault();
			ev.stopPropagation();
			showMenu(
				[
					{
						label: t.reveal,
						run: async () => {
							const ok = await revealFile(ctx, entry);
							if (!ok) toast(t.notFound);
						}
					},
					{ label: t.copyPath, run: () => copyText(entry.abs) },
					{ label: t.copyRel, run: () => copyText(entry.path) }
				],
				ev
			);
		}

		/** Dismiss the menu on any outside interaction or resize. */
		function installDismissHandlers() {
			const dismiss = (ev) => {
				const box = document.getElementById(MENU_ID);
				if (box !== null && ev.target instanceof Node && box.contains(ev.target)) return;
				closeMenu();
			};
			document.addEventListener("mousedown", dismiss, true);
			document.addEventListener("keydown", (ev) => {
				if (ev.key === "Escape") closeMenu();
			}, true);
			window.addEventListener("blur", closeMenu);
			window.addEventListener("resize", closeMenu);
			window.addEventListener("scroll", closeMenu, true);
		}

		/** Cordis entry point. */
		function apply(ctx) {
			// Proof of life for support: one attribute answers "did the client half
			// load?" from the console without a debugger.
			try {
				document.documentElement.setAttribute("data-dsh-link-menu", "active");
			} catch {}
			installDismissHandlers();
			const handler = (ev) => onContextMenu(ctx, ev);
			document.addEventListener("contextmenu", handler, true);
			ctx.effect(() => () => document.removeEventListener("contextmenu", handler, true));
			ctx.effect(() => () => closeMenu());
		}

		exports.name = "dsh-link-menu";
		exports.inject = ["sessions", "remote", "remote.session"];
		exports.apply = apply;
		return module.exports;
	}
});
