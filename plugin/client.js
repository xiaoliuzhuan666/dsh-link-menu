window.__ModuleLoader__.load({
	id: "dsh-link-menu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * Right-click menu for chat links.
		 *
		 * Why this is a client plugin and not a main-process menu
		 * ------------------------------------------------------
		 * The Electron main process cannot see these links. DSH renders a file
		 * reference as `<button>` (not `<a href>`), so Chromium reports an empty
		 * `linkURL` on the `context-menu` event and the native menu can only offer
		 * Copy. The same is true for the http links inside tool rows, which DSH
		 * renders as `<a>` only in some variants.
		 *
		 * What makes this plugin possible
		 * -------------------------------
		 * `@deepseek-ai/dsh-client-ui-tool` stamps two attributes on the elements
		 * it already renders:
		 *   data-dsh-file-path  — the path as DSH shows it (often workspace-relative)
		 *   data-dsh-link-href  — the http(s) URL
		 * Those are the only stable hooks: the class names carry a build hash
		 * (`_fileLink_1ypvv_59`) that changes between builds.
		 *
		 * Reveal goes through the Host Remote, never through the main process:
		 * `remote.session.openWorkspacePath({ path, action: 'reveal' })` resolves a
		 * workspace-relative path against that session's root and runs `open -R`
		 * (macOS) / `explorer /select` (Windows). The main process cannot do that
		 * because the workspace root lives only in the Host process.
		 */

		const MENU_ID = "dsh-link-menu-popup";
		const ATTR_FILE = "data-dsh-file-path";
		const ATTR_HREF = "data-dsh-link-href";
		const ATTR_LINE = "data-dsh-file-line";
		const ATTR_ABS = "data-dsh-file-abs";

		/** Label table. `zh` for Chinese browsers, English otherwise. */
		function labels() {
			const zh = (navigator.language || "").toLowerCase().startsWith("zh");
			return zh
				? {
						reveal: "在 Finder 中显示",
						copyPath: "复制文件路径",
						openBrowser: "在浏览器中打开",
						copyLink: "复制链接地址"
					}
				: {
						reveal: "Reveal in Finder",
						copyPath: "Copy File Path",
						openBrowser: "Open in Browser",
						copyLink: "Copy Link Address"
					};
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

		/**
		 * Resolve a link target from the element under the pointer.
		 * @param target - the event target.
		 * @returns the kind and value, or null when the pointer is not on a link.
		 */
		function linkAt(target) {
			if (!(target instanceof Element)) return null;
			const fileEl = target.closest(`[${ATTR_FILE}]`);
			if (fileEl !== null) {
				// Prefer the absolute path: the Host validates it with
				// `verifyDesktopPath`, which rejects a workspace-relative path because it
				// cannot map it back to a Host path. The rendered text stays relative.
				// Sources, best first:
				//   1. data-dsh-file-abs — stamped by the markdown renderer with the
				//      workspace-resolved absolute path;
				//   2. title — the deliverables mention sets it to the produced file's
				//      full path;
				//   3. data-dsh-file-path — the visible text, which may be relative.
				// The Host rejects a relative path (`verifyDesktopPath` cannot map it),
				// so the visible text is only a last resort.
				const abs = fileEl.getAttribute(ATTR_ABS);
				const title = fileEl.getAttribute("title");
				const path =
					abs !== null && abs !== ""
						? abs
						: title !== null && (title.startsWith("/") || /^[A-Za-z]:[/\\]/.test(title))
							? title
							: fileEl.getAttribute(ATTR_FILE);
				if (path === null || path === "") return null;
				const lineAttr = fileEl.getAttribute(ATTR_LINE);
				const line = lineAttr === null || lineAttr === "" ? null : Number(lineAttr);
				return { kind: "file", path, line: Number.isFinite(line) ? line : null };
			}
			// http links render as a real <a href> (the markdown "link" case), so the
			// attribute itself is the source of truth; the stamped data attribute is
			// only a fallback for variants that wrap the anchor in a button.
			const stamped = target.closest(`[${ATTR_HREF}]`);
			if (stamped !== null) {
				const href = stamped.getAttribute(ATTR_HREF);
				if (href !== null && href !== "") return { kind: "url", href };
			}
			const anchor = target.closest("a[href]");
			if (anchor !== null) {
				const href = anchor.getAttribute("href");
				if (href !== null && /^https?:/i.test(href)) return { kind: "url", href };
			}
			return null;
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
		 * Reveal a workspace path through the Host Remote.
		 * @param ctx - the plugin context, for the remote namespace.
		 * @param entry - the resolved file link.
		 * @returns true when the host accepted the request.
		 */
		async function revealFile(ctx, entry) {
			let session;
			try {
				session = ctx.get("remote")?.session;
			} catch {
				return false;
			}
			if (session === undefined || session === null || typeof session.openWorkspacePath !== "function") {
				return false;
			}
			try {
				// The Host resolves a workspace-relative path against the session root
				// ("Path after best-effort Session workspace resolution"). A path that
				// is already absolute passes through unchanged.
				const result = await session.openWorkspacePath({ path: entry.path, action: "reveal" });
				return result?.ok === true;
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
		 * The contextmenu handler. Registered on the capture phase so it runs before
		 * any component-level handler that might stop propagation.
		 */
		function onContextMenu(ctx, ev) {
			const entry = linkAt(ev.target);
			if (entry === null) {
				// Not a link: leave the native menu alone (text selection, copy, …).
				return;
			}
			const t = labels();
			const items =
				entry.kind === "file"
					? [
							{
								label: t.reveal,
								run: async () => {
									const ok = await revealFile(ctx, entry);
									if (!ok) await copyText(entry.path);
								}
							},
							{ label: t.copyPath, run: () => copyText(entry.path) }
						]
					: [
							{ label: t.openBrowser, run: async () => openExternal(entry.href) },
							{ label: t.copyLink, run: () => copyText(entry.href) }
						];

			// Take over the native menu only once we know we can show our own.
			ev.preventDefault();
			ev.stopPropagation();
			showMenu(items, ev);
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
		exports.inject = ["remote", "remote.session"];
		exports.apply = apply;
		return module.exports;
	}
});
