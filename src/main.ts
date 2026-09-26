import {
	App,
	ItemView,
	MarkdownRenderer,
	Menu,
	Modal,
	Notice,
	Component,
	Editor,
	FileSystemAdapter,
	Plugin,
	PluginSettingTab,
	Scope,
	Setting,
	setIcon,
	TFile,
	TFolder,
	Vault,
	normalizePath,
	WorkspaceLeaf,
} from "obsidian";
import type { MarkdownFileInfo, SettingDefinitionItem } from "obsidian";

/**
 * Markdown files inside `folderPath` (recursively), found by walking that folder only,
 * so the plugin never has to list every file in the vault.
 */
function getMarkdownFilesIn(app: App, folderPath: string): TFile[] {
	const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
	if (!(folder instanceof TFolder)) return [];
	const out: TFile[] = [];
	Vault.recurseChildren(folder, (f) => {
		if (f instanceof TFile && f.extension === "md") out.push(f);
	});
	return out;
}

// ─── Settings ────────────────────────────────────────────────────────────────

interface UniverseBuilderSettings {
	worldFolder: string;
	/** Custom character order, keyed by lower-cased group name -> ordered note paths. */
	characterOrder: Record<string, string[]>;
	/** Lower-cased group names whose character sub-section is collapsed. */
	collapsedGroups: string[];
	/** Group type groups ("corporation", "government", "military", "criminal", "" = unassigned) collapsed on the Groups tab. */
	collapsedGroupTypes: string[];
	/** Note paths of parent entries on hierarchical tabs (Locations) whose subtree is collapsed. */
	collapsedParents: string[];
	/** Note paths of groups whose nested "Subsidiaries" label is collapsed on the Groups tab. */
	collapsedSubsidiaries: string[];
	/** Custom manual order for the flat (non-Characters) tabs, keyed by tab id -> ordered note paths. */
	sectionOrder: Partial<Record<WBTab, string[]>>;
	/** Bookmarked note paths (any section), in the order they were added or dragged into. */
	bookmarks: string[];
	/** Section groups ("characters", "locations", ...) collapsed on the Bookmarks view. */
	collapsedBookmarkGroups: string[];
	/**
	 * Which editor the sidebar's Edit button opens: "live" = Obsidian's Live Preview editor
	 * (undocumented internal API, see README), "raw" = a plain textarea with the note's raw markdown.
	 */
	inlineEditor: "live" | "raw";
	/** Outcome of the one-time move of the section folders out of the legacy "World" folder. */
	folderMigration: FolderMigrationState;
}
/**
 * Where the World -> UniverseBuilder folder move stands. `status` unset means "not settled yet":
 * the prompt shows again on the next plugin update (or on the next launch, after a failed move).
 */
interface FolderMigrationState {
	/**
	 * "moved" = the section folders were moved into the default folder; "declined" = the user
	 * chose to keep World/ and not be asked again; "not-needed" = nothing to move (fresh vault,
	 * empty World/, or a custom folder).
	 */
	status?: "moved" | "declined" | "not-needed";
	/** Plugin version that last showed the prompt, so "ask again" waits for the next update. */
	askedInVersion?: string;
	/**
	 * Answer to "delete the now-empty World folder?" after a move. Unset = not answered yet
	 * (offered again on the next launch while World/ exists and holds no files).
	 */
	legacyCleanup?: "deleted" | "kept";
}
/** Where the plugin keeps its notes by default. */
const DEFAULT_FOLDER = "UniverseBuilder";
/**
 * The default before the move to DEFAULT_FOLDER, shared with the World Builder plugin this one
 * was forked from. Only its Characters/Locations/Groups/Lore/Timeline folders, plus the Images
 * folder portraits are imported into (see migratedFolderNames), are ever moved.
 */
const LEGACY_FOLDER = "World";
/** Plugin id of the original World Builder, only used to warn that moving hides the notes from it. */
const WORLD_BUILDER_ID = "world-builder";
/** Keys written by versions from before the "Employers" tab was renamed to "Groups". */
interface LegacySettings {
	collapsedEmployers?: string[];
	collapsedEmployerTypes?: string[];
}
/** What loadData() may hand back: any subset of the current settings, plus legacy keys. */
type StoredSettings = Partial<UniverseBuilderSettings> & LegacySettings;
const DEFAULT_SETTINGS: UniverseBuilderSettings = {
	worldFolder: DEFAULT_FOLDER,
	characterOrder: {},
	collapsedGroups: [],
	collapsedGroupTypes: [],
	collapsedParents: [],
	collapsedSubsidiaries: [],
	sectionOrder: {},
	bookmarks: [],
	collapsedBookmarkGroups: [],
	inlineEditor: "live",
	folderMigration: {},
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Group "type" property values, in the order their groups appear on the Groups tab. */
const GROUP_TYPES: { key: string; label: string }[] = [
	{ key: "corporation", label: "Corporation" },
	{ key: "government", label: "Government" },
	{ key: "military", label: "Military" },
	{ key: "criminal", label: "Criminal" },
];

function slugify(s: string) {
	return s.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim();
}

/** Group frontmatter key naming the group this one is a subsidiary of. */
const SUBSIDIARY_OF = "subsidiary-of";

/** Locations whose `type` is "ship": mobile, so they get their own Ships section instead of nesting. */
function isShip(fm: Record<string, string>): boolean {
	return (fm.type ?? "").trim().toLowerCase() === "ship";
}

/** File extensions treated as images (portraits, dropped files). */
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** An Obsidian image size spec, as in `![[image.png|300]]` or `![[image.png|300x200]]`. */
const SIZE_SPEC = /^\d+(x\d+)?$/;

/** The image embed that supplies a card's portrait (see findFirstImage). */
interface PortraitMatch {
	/** Displayable URL for the image. */
	src: string;
	/** Where the whole embed (`![[...]]` / `![...](...)`) sits in the note's text. */
	start: number;
	end: number;
	/** The image file in the vault, or null for a web (http) image. */
	file: TFile | null;
	/** File name, for messages. */
	name: string;
	/** Size spec carried over when the image is replaced ("" if none). */
	size: string;
}

/** An image dragged onto a card: a file already in the vault, or one from outside it (e.g. File Explorer). */
type DroppedImage = { kind: "vault"; file: TFile } | { kind: "external"; file: File };

/**
 * Whether the section header shows the Back / Forward buttons. Hidden for now (a floating card
 * covers the section header anyway; the expanded card's toolbar has its own Back / Forward, see
 * navigateCard). The navigation history behind them (recordNav, navigateBack, navigateForward,
 * applyNavEntry) is still kept up to date, so setting this to true brings the header ones back.
 */
const SHOW_NAV_BUTTONS = false;

/** Space between a floating (expanded) card and the edges of the area it covers (px). */
const FLOAT_GAP = 20;
/** Bottom gap: 18px more, so a status bar over the bottom of the sidebar doesn't cover the card's edge. */
const FLOAT_GAP_BOTTOM = FLOAT_GAP + 18;
/** Length of the float-up / shrink-back animation when a card is expanded or collapsed (ms; keep in step with styles.css). */
const FLOAT_MS = 220;

/** Subfolder of the Universe Builder folder that portrait images from outside the vault are imported into. */
const IMAGES_SUBFOLDER = "Images";

/**
 * Every folder the World/ -> UniverseBuilder/ migration moves: the section folders, plus Images,
 * because while the Universe folder setting still points at World/, portraits dropped onto
 * entries are imported into World/Images. Moving it keeps them with the notes, and lets an
 * otherwise emptied World/ be offered for deletion.
 */
function migratedFolderNames(): string[] {
	return [...SECTION_TABS.map((tab) => SECTION_LABELS[tab]), IMAGES_SUBFOLDER];
}

function imagesFolderPath(worldFolder: string): string {
	return normalizePath(`${worldFolder}/${IMAGES_SUBFOLDER}`);
}

/**
 * Where a note's imported portrait goes: `<Universe folder>/Images/<Section>` (Characters,
 * Locations, Groups, Lore or Timeline), taken from the section folder the note lives in, so
 * same-named images from different sections don't collide. Notes outside a section folder use
 * Images itself.
 */
function portraitFolderFor(worldFolder: string, notePath: string): string {
	const root = normalizePath(worldFolder);
	const images = imagesFolderPath(worldFolder);
	const path = normalizePath(notePath);
	if (!path.toLowerCase().startsWith(root.toLowerCase() + "/")) return images;
	const first = path.slice(root.length + 1).split("/")[0].toLowerCase();
	const section = SECTION_TABS.map((tab) => SECTION_LABELS[tab]).find((label) => label.toLowerCase() === first);
	return section ? `${images}/${section}` : images;
}

/** Creates `path` and any missing parent folders. */
async function ensureFolderPath(app: App, path: string) {
	let current = "";
	for (const part of normalizePath(path).split("/")) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
	}
}

/**
 * The image file being dragged from inside Obsidian (its file list, etc.), or null. Uses
 * Obsidian's drag manager, which isn't part of the public API, so it's read defensively.
 */
function draggedVaultImage(app: App): TFile | null {
	const draggable = (app as unknown as { dragManager?: { draggable?: { type?: string; file?: unknown; files?: unknown[] } | null } })
		.dragManager?.draggable;
	if (!draggable) return null;
	const candidates = draggable.type === "file" ? [draggable.file] : draggable.type === "files" ? draggable.files ?? [] : [];
	for (const f of candidates) if (f instanceof TFile && IMG_EXT.test(f.name)) return f;
	return null;
}

/**
 * If a file dropped from outside Obsidian actually lives inside this vault, returns it, so it's
 * linked where it is instead of being copied in a second time. Desktop only; null otherwise.
 */
function vaultFileForDropped(app: App, dropped: File): TFile | null {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return null;
	let osPath = "";
	try {
		// Newer Electron dropped File.path in favour of webUtils.getPathForFile().
		const electron = (window as unknown as { require?: (m: string) => { webUtils?: { getPathForFile?: (f: File) => string } } })
			.require?.("electron");
		osPath = electron?.webUtils?.getPathForFile?.(dropped) || (dropped as File & { path?: string }).path || "";
	} catch {
		osPath = (dropped as File & { path?: string }).path ?? "";
	}
	if (!osPath) return null;
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	const base = norm(adapter.getBasePath());
	const full = norm(osPath);
	if (!full.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
	const found = app.vault.getAbstractFileByPath(normalizePath(full.slice(base.length + 1)));
	return found instanceof TFile ? found : null;
}

/**
 * True while an image might be being dragged: a file from outside Obsidian (while dragging only
 * each item's MIME type is visible, not its name, and some image types have none, so an untyped
 * file is let through and checked by name on drop) or an image from Obsidian's own file list.
 * Card reorder drags (application/x-wb-card) never count.
 */
function isImageDrag(app: App, e: DragEvent): boolean {
	const dt = e.dataTransfer;
	if (!dt || dt.types.includes("application/x-wb-card")) return false;
	if (dt.types.includes("Files")) {
		const items = Array.from(dt.items ?? []);
		return items.length === 0 || items.some((i) => i.kind === "file" && (i.type === "" || i.type.startsWith("image/")));
	}
	return draggedVaultImage(app) !== null;
}

/**
 * Reads the image out of a drop (call it inside the drop handler: the DataTransfer is emptied
 * once the handler returns). Shows a notice and returns null if nothing dropped is an image.
 */
function droppedImageFrom(app: App, dt: DataTransfer): DroppedImage | null {
	if (dt.types.includes("Files")) return imageFromFiles(app, Array.from(dt.files));
	const vaultFile = draggedVaultImage(app);
	return vaultFile ? { kind: "vault", file: vaultFile } : null;
}

/** The first image among files picked or dropped from outside Obsidian (see droppedImageFrom). */
function imageFromFiles(app: App, files: File[]): DroppedImage | null {
	if (files.length === 0) return null;
	const picked = files.find((f) => IMG_EXT.test(f.name));
	if (!picked) {
		new Notice(files.length === 1 ? `"${files[0].name}" isn't an image.` : "None of those files is an image.");
		return null;
	}
	const inVault = vaultFileForDropped(app, picked);
	return inVault ? { kind: "vault", file: inVault } : { kind: "external", file: picked };
}

/** True if two binary buffers hold the same bytes. */
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const x = new Uint8Array(a);
	const y = new Uint8Array(b);
	for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
	return true;
}

/**
 * Copies an image from outside the vault into the note's portrait folder (see portraitFolderFor),
 * so the note only ever links to a file inside the vault (and the portrait travels with the vault
 * through any sync method). Keeps the original file name; if a different file in that folder
 * already has that name, a number is added ("venus 1.webp"). If the very same image was imported
 * there before, that copy is reused instead of making a duplicate. Name clashes are checked
 * case-insensitively (Windows/macOS).
 */
async function importImage(app: App, worldFolder: string, file: File, notePath: string): Promise<TFile> {
	const folder = portraitFolderFor(worldFolder, notePath);
	await ensureFolderPath(app, folder);
	const data = await file.arrayBuffer();
	const dot = file.name.lastIndexOf(".");
	const stem = slugify(dot > 0 ? file.name.slice(0, dot) : file.name) || "image";
	const ext = (dot > 0 ? file.name.slice(dot + 1) : "png").toLowerCase();
	const folderObj = app.vault.getAbstractFileByPath(folder);
	const siblings = new Map<string, TFile>();
	if (folderObj instanceof TFolder) {
		for (const child of folderObj.children) if (child instanceof TFile) siblings.set(child.name.toLowerCase(), child);
	}
	for (let n = 0; ; n++) {
		const name = n === 0 ? `${stem}.${ext}` : `${stem} ${n}.${ext}`;
		const clash = siblings.get(name.toLowerCase());
		if (!clash) return await app.vault.createBinary(`${folder}/${name}`, data);
		if (clash.stat.size === data.byteLength && sameBytes(await app.vault.readBinary(clash), data)) return clash;
	}
}

/** The embed for a portrait image in `notePath`, following the user's link settings (wiki vs markdown, relative paths, ...). */
function portraitEmbed(app: App, image: TFile, notePath: string, size = ""): string {
	const link = app.fileManager.generateMarkdownLink(image, notePath, undefined, size || undefined);
	return link.startsWith("!") ? link : `!${link}`;
}

/** Puts `embed` at the very top of a note's body: right after the frontmatter (which has to stay first), before the title heading. */
function insertAtBodyTop(data: string, embed: string): string {
	const bodyStart = data.length - stripFrontmatterBlock(data).length;
	let head = data.slice(0, bodyStart);
	if (head && !head.endsWith("\n")) head += "\n";
	return `${head}${embed}\n${data.slice(bodyStart)}`;
}

/** Strips a leading YAML frontmatter block, if present, from note content. */
function stripFrontmatterBlock(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}

/**
 * Strips a leading "# ..." heading, if the note's body starts with one. The character template
 * always opens with "# Name" right after the frontmatter, which just repeats what the card
 * already shows above, so the expanded preview hides it whatever name it carries.
 */
function stripLeadingHeading(markdown: string): string {
	const lines = markdown.replace(/^\s+/, "").split("\n");
	if (!/^#\s+\S/.test(lines[0] ?? "")) return markdown;
	lines.shift();
	while (lines[0] === "") lines.shift();
	return lines.join("\n");
}

/**
 * Full-screen image zoom (lightbox), opened by clicking the photo on an expanded card, so a
 * picture can be viewed large straight from the sidebar without opening the note to edit it.
 * The image opens fitted to the window. Scroll to zoom in/out around the cursor, drag to pan
 * once zoomed. A plain click (no drag) or Escape closes it.
 */
function openImageZoom(src: string, alt: string) {
	document.querySelector(".wb-zoom-overlay")?.remove();

	const overlay = document.body.createDiv({ cls: "wb-zoom-overlay", attr: { role: "dialog", "aria-modal": "true", "aria-label": alt || "Image" } });
	const img = overlay.createEl("img", { cls: "wb-zoom-img", attr: { src, alt, draggable: "false" } });

	let scale = 1;
	let x = 0;
	let y = 0;
	const apply = () => {
		img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
		overlay.toggleClass("is-zoomed", scale > 1);
	};

	const close = () => {
		overlay.remove();
		document.removeEventListener("keydown", onKey, true);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	};
	document.addEventListener("keydown", onKey, true);

	overlay.addEventListener("wheel", (e) => {
		e.preventDefault();
		const prev = scale;
		scale = Math.min(10, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
		if (scale === 1) {
			x = 0;
			y = 0;
		} else {
			// Keep the point under the cursor fixed while zooming.
			const cx = e.clientX - window.innerWidth / 2;
			const cy = e.clientY - window.innerHeight / 2;
			x = cx - ((cx - x) * scale) / prev;
			y = cy - ((cy - y) * scale) / prev;
		}
		apply();
	}, { passive: false });

	// Drag to pan; a press that barely moves counts as a click and closes the zoom.
	let dragStart: { mx: number; my: number; x: number; y: number } | null = null;
	let moved = false;
	overlay.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		dragStart = { mx: e.clientX, my: e.clientY, x, y };
		moved = false;
		overlay.setPointerCapture(e.pointerId);
	});
	overlay.addEventListener("pointermove", (e) => {
		if (!dragStart) return;
		const dx = e.clientX - dragStart.mx;
		const dy = e.clientY - dragStart.my;
		if (!moved && Math.hypot(dx, dy) < 4) return;
		moved = true;
		if (scale > 1) {
			overlay.addClass("is-panning");
			x = dragStart.x + dx;
			y = dragStart.y + dy;
			apply();
		}
	});
	overlay.addEventListener("pointerup", () => {
		overlay.removeClass("is-panning");
		const wasClick = dragStart && !moved;
		dragStart = null;
		if (wasClick) close();
	});
	img.onerror = close;
}

async function ensureFolder(app: App, path: string) {
	if (!app.vault.getAbstractFileByPath(path)) {
		await app.vault.createFolder(path);
	}
}

async function createNote(
	app: App,
	folder: string,
	filename: string,
	content: string
): Promise<TFile> {
	await ensureFolder(app, folder);
	const path = `${folder}/${slugify(filename)}.md`;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}
	return await app.vault.create(path, content);
}

function readFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};
	const result: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		let value = line.slice(idx + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		result[line.slice(0, idx).trim()] = value;
	}
	return result;
}

/** "Label: value • Label: value" for the non-empty values. A non-breaking space keeps each label with its value when the line wraps. */
function labeledLine(pairs: ReadonlyArray<readonly [string, string | undefined]>): string {
	return pairs
		.filter(([, value]) => value)
		.map(([label, value]) => `${label}:\u00a0${value}`)
		.join(" • ");
}

/** Lower-cases and strips accents, so "zoe" finds "Zoë" and "desmond" finds "Desmond". */
function normalizeForSearch(s: string): string {
	return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** "[[Name]]", "[[Name|Alias]]", or plain "Name" -> "Name" (trimmed). */
function parseRefName(raw: string): string {
	const trimmed = raw.trim();
	const m = trimmed.match(/^\[\[([^\]]+)\]\]$/);
	const inner = m ? m[1] : trimmed;
	return inner.split("|")[0].split("#")[0].trim();
}

/**
 * Everything a note "says", for searching: its frontmatter values (not the keys) plus its body,
 * with markup that isn't visible text removed (embeds, link targets, HTML tags such as the
 * <font color=...> around headings).
 */
function documentSearchText(content: string, fm: Record<string, string>): string {
	const body = stripFrontmatterBlock(content)
		.replace(/!\[\[[^\]]*\]\]/g, " ") // ![[embeds]]
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // ![images](...)
		.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // [[target|shown text]] -> shown text
		.replace(/\[\[([^\]]*)\]\]/g, "$1") // [[target]] -> target
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
		.replace(/<[^>]+>/g, " "); // <font color="...">, etc.
	const values = Object.entries(fm)
		.filter(([key]) => key !== "entry_type")
		.map(([, value]) => value);
	return [...values, body].join(" ");
}

interface NoteEntry {
	file: TFile;
	content: string;
	fm: Record<string, string>;
}
/** One tab's two halves: header (fixed region) and body (scrolling region). */
interface TabPane { head: HTMLElement; body: HTMLElement; }

type CardFn = (fm: Record<string, string>) => {
	title: string;
	meta: string;
	badge: string;
	search?: string;
	// Additional small labels drawn after the main badge (e.g. the character POV marker).
	extraBadges?: { text: string; cls: string }[];
};

/** True when a frontmatter value is actually set (not missing, null, or blank). */
const hasValue = (v: unknown): boolean =>
	v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/** The five entry sections, each with its own tab and folder. */
type SectionTab = "characters" | "locations" | "groups" | "lore" | "timeline";
/** Everything the sidebar can show: a section, or the Bookmarks view (opened from the section header, not the tab bar). */
type WBTab = SectionTab | "bookmarks";
const SECTION_TABS: SectionTab[] = ["characters", "locations", "groups", "lore", "timeline"];
const SECTION_LABELS: Record<SectionTab, string> = {
	characters: "Characters",
	locations: "Locations",
	groups: "Groups",
	lore: "Lore",
	timeline: "Timeline",
};

/** Search bar wording per tab. Characters match on four properties; every other tab matches the note's name and text. */
const SEARCH_HINTS: Record<WBTab, { noun: string; tip: string }> = {
	characters: { noun: "characters", tip: "Matches name, group, ship and home" },
	locations: { noun: "locations", tip: "Matches the name and the text of the note" },
	groups: { noun: "groups", tip: "Matches the name and the text of the note" },
	lore: { noun: "lore", tip: "Matches the title and the text of the note" },
	timeline: { noun: "timeline", tip: "Matches the title and the text of the note" },
	bookmarks: { noun: "bookmarks", tip: "Matches each bookmark the same way its own tab does" },
};

/**
 * Groups a flat list of notes into a parent/child tree using each note's "parent" frontmatter
 * text, matched (case/accent-insensitively, tolerant of "[[Name]]" wiki-link syntax) against
 * other notes' own names in the same list. A note whose parent text doesn't resolve to another
 * note here - unset, misspelled, or pointing outside this section - is left as a root: nesting
 * only happens where an actual parent/child relationship is detected. Any edge that would create
 * a cycle (A parents B parents A) is dropped so the tree stays walkable.
 */
function buildParentTree(
	entries: NoteEntry[],
	getParentName: (fm: Record<string, string>) => string,
	getOwnName: (fm: Record<string, string>) => string
): { roots: NoteEntry[]; childrenOf: Map<string, NoteEntry[]> } {
	const nameIndex = new Map<string, NoteEntry>();
	for (const entry of entries) {
		const key = normalizeForSearch(parseRefName(getOwnName(entry.fm) || ""));
		if (key && !nameIndex.has(key)) nameIndex.set(key, entry);
	}

	const parentOf = new Map<string, NoteEntry>();
	for (const entry of entries) {
		const raw = parseRefName(getParentName(entry.fm) || "");
		if (!raw) continue;
		const parent = nameIndex.get(normalizeForSearch(raw));
		if (parent && parent.file.path !== entry.file.path) parentOf.set(entry.file.path, parent);
	}

	// Drop any edge whose chain of parents loops back on itself, so the tree stays walkable.
	const isAcyclic = (start: NoteEntry): boolean => {
		const seen = new Set<string>();
		let cur: NoteEntry | undefined = start;
		while (cur) {
			if (seen.has(cur.file.path)) return false;
			seen.add(cur.file.path);
			cur = parentOf.get(cur.file.path);
		}
		return true;
	};
	for (const entry of entries) {
		if (parentOf.has(entry.file.path) && !isAcyclic(entry)) parentOf.delete(entry.file.path);
	}

	const childrenOf = new Map<string, NoteEntry[]>();
	const roots: NoteEntry[] = [];
	for (const entry of entries) {
		const parent = parentOf.get(entry.file.path);
		if (!parent) { roots.push(entry); continue; }
		const list = childrenOf.get(parent.file.path);
		if (list) list.push(entry); else childrenOf.set(parent.file.path, [entry]);
	}
	return { roots, childrenOf };
}

/**
 * Merges a reordered sibling group back into a flat priority order without disturbing anything
 * outside that group: every path in `groupPaths` is replaced, in its new order, at the position
 * of the group's first surviving member; everything else keeps its relative order.
 */
function mergeGroupOrder(overall: string[], groupPaths: string[], newGroupOrder: string[]): string[] {
	const groupSet = new Set(groupPaths);
	const result: string[] = [];
	let inserted = false;
	for (const path of overall) {
		if (groupSet.has(path)) {
			if (!inserted) { result.push(...newGroupOrder); inserted = true; }
		} else {
			result.push(path);
		}
	}
	if (!inserted) result.push(...newGroupOrder);
	return result;
}

// ─── Sidebar View ─────────────────────────────────────────────────────────────

const VIEW_TYPE = "universe-builder-sidebar";

class UniverseBuilderView extends ItemView {
	plugin: UniverseBuilderPlugin;
	activeTab: WBTab = "characters";
	/** What is typed in the search bar for each tab; kept here so it survives a redraw (Reload, new note, ...). */
	searchQueries: Record<WBTab, string> = { characters: "", locations: "", groups: "", lore: "", timeline: "", bookmarks: "" };
	/** The section tab to return to when the Bookmarks button is clicked again while viewing bookmarks. */
	private lastSectionTab: SectionTab = "characters";
	/** How each section draws its cards, captured in renderSection() so the Bookmarks view can draw them the same way. */
	private sectionConfigs: Partial<Record<SectionTab, { getCard: CardFn; thumbs: boolean; stackBadge: boolean }>> = {};
	/** The Bookmarks button in the title row, highlighted while the Bookmarks view is open. */
	private bookmarkHeaderButtons: HTMLButtonElement[] = [];
	private searchTargets: Partial<Record<WBTab, HTMLElement>> = {};
	/** Normalised text each card is matched against. */
	private searchIndex = new WeakMap<HTMLElement, string>();
	/** Every note currently drawn in the sidebar, keyed by path, so a wiki-link click can find its entry. */
	private entryByPath = new Map<string, NoteEntry>();
	/** Tabs whose lists nest child entries under their parent (see renderHierarchicalGroup). */
	private readonly hierarchicalTabs = new Set<WBTab>(["locations"]);
	/** Un-collapses one hierarchical parent's subtree, keyed by the parent's note path (used by revealCard). */
	private treeExpanders = new Map<string, () => Promise<void>>();
	/**
	 * Every collapsible group label drawn in the sidebar, mapped to a function that folds it and
	 * records that in settings (without saving). Used by collapseAllInTab(); weak so old DOM from a
	 * previous render() is simply dropped.
	 */
	private groupCollapsers = new WeakMap<HTMLElement, () => void>();
	/** Whether the click that started the current (possible) double-click landed on the tab that was already active. */
	private tabClickWasOnActive = false;
	/**
	 * The one card whose inline markdown editor is open (only one entry is edited at a time).
	 * finish() saves any changes and leaves edit mode, resolving false if that was cancelled.
	 */
	private activeEdit: {
		card: HTMLElement;
		isDirty: () => boolean;
		finish: () => Promise<boolean>;
		/** Tears the editor down without saving (its card is being collapsed or redrawn). */
		abandon: () => void;
	} | null = null;
	/** Note path whose editor should open as soon as its card is redrawn (after switching edits triggers a save + redraw). */
	private pendingEditPath: string | null = null;
	/** The expanded card, floating over the list (see enterFloat). Only one card is expanded at a time. */
	private floating: {
		card: HTMLElement;
		/** Holds the card's place (and height) in its list, so the list doesn't shift and the card can return to it. */
		placeholder: HTMLElement;
		pane: HTMLElement;
		backdrop: HTMLElement;
		observer: ResizeObserver;
		draggable: string | null;
	} | null = null;
	/** Set while re-opening a card after a redraw, so it floats straight into place without animating. */
	private floatInstantly = false;

	// Rebuilt on every render(); let switchTab() and the nav buttons operate without closures.
	private tabBarEl: HTMLElement | null = null;
	private tabContents: Partial<Record<WBTab, TabPane>> = {};
	private showTabSearchFn: (() => void) | null = null;
	private updateShadowFn: (() => void) | null = null;

	/**
	 * Back/forward history across tab switches and card expansions (including ones triggered by
	 * clicking a wiki-link in an expanded card). Persists across render() calls; only the DOM it
	 * points at is rebuilt.
	 */
	private navHistory: { tab: WBTab; cardPath: string | null }[] = [];
	private navIndex = -1;
	/** True while a back/forward navigation is replaying a history entry, so it isn't re-recorded. */
	private restoringNav = false;
	private navButtons: { back: HTMLButtonElement; fwd: HTMLButtonElement }[] = [];
	/** Back / Forward in the expanded card's toolbar; these step between expanded entries only (see navigateCard). */
	private cardNavButtons: { back: HTMLButtonElement; fwd: HTMLButtonElement }[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: UniverseBuilderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "Universe Builder"; }
	getIcon() { return "orbit"; }

	async onOpen() { await this.render(); }
	async onClose() {}

	/**
	 * Redraws the whole sidebar. With keepExpanded, the cards that were expanded (per tab) are
	 * re-opened afterwards, e.g. after saving an inline edit, so the saved card stays open.
	 */
	async render(opts: { keepExpanded?: boolean } = {}) {
		const { containerEl } = this;
		// Only the list area scrolls, so remember its position across the redraw.
		const scrollTop = containerEl.querySelector<HTMLElement>(".wb-scroll")?.scrollTop ?? 0;
		const reopen: { tab: WBTab; path: string }[] = [];
		if (opts.keepExpanded) {
			for (const [tab, pane] of Object.entries(this.tabContents) as [WBTab, TabPane][]) {
				pane.body.querySelectorAll<HTMLElement>(".wb-card.wb-card-expanded").forEach((card) => {
					const path = card.getAttribute("data-path");
					if (path) reopen.push({ tab, path });
				});
			}
		}
		const oldSearch = containerEl.querySelector<HTMLInputElement>(".wb-search-input");
		const searchHadFocus = !!oldSearch && containerEl.ownerDocument.activeElement === oldSearch;
		containerEl.empty();
		containerEl.addClass("wb-sidebar");
		// Rebuilt below as the lists are (re)drawn.
		this.entryByPath = new Map();
		this.treeExpanders = new Map();
		// The old DOM (and any open inline editor in it) is gone.
		this.activeEdit?.abandon();
		this.activeEdit = null;
		void this.exitFloat(true);
		this.navButtons = [];
		this.cardNavButtons = [];
		this.bookmarkHeaderButtons = [];
		this.sectionConfigs = {};

		// Fixed region: title, tabs, the active tab's section header (Reload / + New) and the search bar.
		// It never scrolls; the lists below it live in their own scrolling region.
		const fixed = containerEl.createDiv("wb-fixed");
		const scroll = containerEl.createDiv("wb-scroll");

		const header = fixed.createDiv("wb-header");
		header.createEl("h2", { text: "Universe Builder" });
		// Bookmarks: icon + "Bookmarks" label, anchored to the right of the title (outside the section
		// header, so it stays usable while an expanded entry floats over the list). Highlighted while
		// the Bookmarks view is open. Same size as Reload / + New (.wb-header-btn).
		const bookmarksBtn = header.createEl("button", {
			cls: "wb-btn-secondary wb-icon-btn wb-bookmarks-btn wb-header-btn",
			attr: { type: "button", "aria-label": "Bookmarks" },
		});
		setIcon(bookmarksBtn.createSpan({ cls: "wb-btn-icon" }), "bookmark");
		bookmarksBtn.createSpan({ text: "Bookmarks" });
		bookmarksBtn.onclick = () => this.toggleBookmarksView();
		this.bookmarkHeaderButtons.push(bookmarksBtn);

		const tabBar = fixed.createDiv("wb-tabs");
		const tabs: { id: SectionTab; label: string }[] = [
			{ id: "characters", label: "Characters" },
			{ id: "locations", label: "Locations" },
			{ id: "groups", label: "Groups" },
			{ id: "lore", label: "Lore" },
			{ id: "timeline", label: "Timeline" },
		];

		this.tabBarEl = tabBar;
		const contents: Partial<Record<WBTab, TabPane>> = {};
		tabs.forEach(({ id, label }) => {
			const btn = tabBar.createEl("button", { text: label, cls: "wb-tab" });
			btn.setAttribute("data-tab", id);
			if (id === this.activeTab) btn.addClass("active");
			btn.onclick = (e) => {
				// Remember, on the first click of a (possible) double-click, whether this tab was already open,
				// so a double-click that *switches* to a tab doesn't also collapse it.
				if (e.detail <= 1) this.tabClickWasOnActive = id === this.activeTab;
				if (id === this.activeTab) return;
				this.switchTab(id);
				this.recordNav(id, null);
			};
			// Double-clicking the tab you're already on collapses everything in it.
			btn.ondblclick = () => {
				if (!this.tabClickWasOnActive || id !== this.activeTab) return;
				void this.collapseAllInTab(id);
			};
			// Each tab has a header half (fixed region) and a body half (scrolling region).
			const pane: TabPane = {
				head: fixed.createDiv("wb-tab-content wb-tab-head"),
				body: scroll.createDiv("wb-tab-content wb-tab-body"),
			};
			if (id === this.activeTab) { pane.head.addClass("active"); pane.body.addClass("active"); }
			contents[id] = pane;
			this.searchTargets[id] = pane.body;
		});
		// The Bookmarks view has no tab of its own; it's opened from the Bookmarks button in the
		// title row and takes the place of the section's list while it's open.
		const bookmarksPane: TabPane = {
			head: fixed.createDiv("wb-tab-content wb-tab-head"),
			body: scroll.createDiv("wb-tab-content wb-tab-body wb-bookmarks-body"),
		};
		if (this.activeTab === "bookmarks") { bookmarksPane.head.addClass("active"); bookmarksPane.body.addClass("active"); }
		contents.bookmarks = bookmarksPane;
		this.searchTargets.bookmarks = bookmarksPane.body;
		this.tabContents = contents;

		// Search bar: last part of the fixed region, under the section header. Each tab keeps its own text.
		const searchBox = fixed.createDiv("wb-search");
		setIcon(searchBox.createSpan({ cls: "wb-search-icon" }), "search");
		const searchInput = searchBox.createEl("input", {
			cls: "wb-search-input",
			attr: { type: "text", spellcheck: "false" },
		});
		const clearBtn = searchBox.createEl("button", {
			cls: "wb-search-clear",
			attr: { type: "button", "aria-label": "Clear search" },
		});
		setIcon(clearBtn, "x");
		const syncClear = () => clearBtn.classList.toggle("is-visible", searchInput.value.length > 0);
		const showTabSearch = () => {
			const hint = SEARCH_HINTS[this.activeTab];
			searchInput.value = this.searchQueries[this.activeTab];
			searchInput.setAttribute("placeholder", `Search ${hint.noun}\u2026`);
			searchInput.setAttribute("title", hint.tip);
			searchInput.setAttribute("aria-label", `Search ${hint.noun}`);
			syncClear();
		};
		// Shadow under the fixed region while the list is scrolled, so it reads as sitting on top of it.
		const updateShadow = () => fixed.classList.toggle("is-scrolled", scroll.scrollTop > 0);
		scroll.addEventListener("scroll", updateShadow, { passive: true });
		this.showTabSearchFn = showTabSearch;
		this.updateShadowFn = updateShadow;
		const setQuery = (q: string) => {
			this.searchQueries[this.activeTab] = q;
			syncClear();
			this.applySearch(this.activeTab);
			scroll.scrollTop = 0; // the result set changed: start from the top of it
			updateShadow();
		};
		searchInput.addEventListener("input", () => setQuery(searchInput.value));
		searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && searchInput.value) {
				e.preventDefault();
				e.stopPropagation();
				searchInput.value = "";
				setQuery("");
			}
		});
		clearBtn.addEventListener("click", () => {
			searchInput.value = "";
			setQuery("");
			searchInput.focus();
		});
		showTabSearch();

		const folder = this.plugin.settings.worldFolder;

		await this.renderSection(
			"characters",
			contents.characters!,
			`${folder}/Characters`,
			"Characters",
			() => new CharacterModal(this.app, this.plugin, () => void this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				// Two lines: age/home, then group/ship (a line with no values is dropped).
				meta: [
					labeledLine([["Age", fm.age], ["Home", fm.home]]),
					labeledLine([["Group", fm.group], ["Ship", fm.ship]]),
				].filter(Boolean).join("\n"),
				badge: fm.role ?? "",
				// `pov` is set by hand in the note's properties (not in the New Character modal).
				extraBadges: hasValue(fm.pov) ? [{ text: "POV", cls: "wb-badge-pov" }] : [],
				// What the search bar matches against.
				search: [fm.name, fm.group, fm.ship, fm.home].filter(Boolean).join(" "),
			}),
			{ thumbs: true, groupGroups: true, stackBadge: true, expandable: true }
		);

		await this.renderSection(
			"locations",
			contents.locations!,
			`${folder}/Locations`,
			"Locations",
			() => new LocationModal(this.app, this.plugin, () => void this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				// Type already shows as the badge, so the sub-line is just the parent location.
				meta: (fm.parent ?? "").trim(),
				badge: fm.type ?? "",
			}),
			{
				thumbs: true,
				expandable: true,
				hierarchical: true,
				// Ships travel, so their `parent` (where they are right now) never nests them: they
				// always start their own tree, drawn in the separate Ships section below.
				getParentName: (fm) => (isShip(fm) ? "" : fm.parent ?? ""),
				getOwnName: (fm) => fm.name ?? "",
				movableSection: { label: "Ships", isMovable: isShip },
			}
		);

		await this.renderSection(
			"groups",
			contents.groups!,
			`${folder}/Groups`,
			"Groups",
			() => new GroupModal(this.app, this.plugin, () => void this.render()).open(),
			(fm) => ({
				title: fm.name ?? "Unnamed",
				meta: fm.goals ?? "",
				badge: fm.alignment ?? "",
			}),
			{ thumbs: true, expandable: true, typeGroups: true }
		);

		await this.renderSection(
			"lore",
			contents.lore!,
			`${folder}/Lore`,
			"Lore Entries",
			() => new LoreModal(this.app, this.plugin, () => void this.render()).open(),
			(fm) => ({
				title: fm.title ?? "Untitled",
				meta: fm.category ?? "",
				badge: fm.category ?? "",
			}),
			{ thumbs: true, expandable: true }
		);

		await this.renderSection(
			"timeline",
			contents.timeline!,
			`${folder}/Timeline`,
			"Timeline Events",
			() => new TimelineModal(this.app, this.plugin, () => void this.render()).open(),
			(fm) => ({
				title: fm.title ?? "Untitled",
				meta: fm.date ?? "",
				badge: "",
			}),
			{ thumbs: true, expandable: true }
		);

		// Bookmarks last: it reuses the entries and card styles the sections above just loaded.
		this.renderSectionHeader(bookmarksPane, null, true);
		this.renderBookmarks();

		// Re-open the cards that were expanded before the redraw, without adding history entries.
		if (reopen.length) {
			this.restoringNav = true;
			this.floatInstantly = true;
			try {
				for (const { tab, path } of reopen) {
					const card = contents[tab]?.body.querySelector<HTMLElement>(`.wb-card[data-path="${CSS.escape(path)}"]`);
					const entry = this.entryByPath.get(path);
					if (card && entry && !card.classList.contains("wb-card-expanded")) this.toggleCardExpand(tab, card, entry);
				}
			} finally {
				this.restoringNav = false;
				this.floatInstantly = false;
			}
			this.refreshCurrentCardHighlight();
		}

		// Redrawing empties the container, which resets its scroll position; restore it.
		scroll.scrollTop = scrollTop;

		// Re-apply each tab's search to the freshly drawn lists, and give the box its focus back.
		for (const { id } of tabs) this.applySearch(id);
		updateShadow();
		if (searchHadFocus) {
			searchInput.focus();
			const end = searchInput.value.length;
			searchInput.setSelectionRange(end, end);
		}

		// Seed a starting point for Back/Forward the first time the sidebar ever renders.
		if (this.navHistory.length === 0) {
			this.navHistory = [{ tab: this.activeTab, cardPath: null }];
			this.navIndex = 0;
		}
		this.updateNavButtonStates();
		this.updateBookmarkHeaderButtons();
	}

	/**
	 * Hides the cards on one tab that don't match its search text (and, on Characters, any group
	 * section left empty). Every word typed must appear in the card's searchable text, in any order,
	 * ignoring case and accents. Works on the existing cards, so nothing is re-read or re-rendered.
	 * Characters are matched on name, group, ship and home; other tabs on the name and the note's text.
	 */
	private applySearch(tab: WBTab) {
		const body = this.searchTargets[tab];
		if (!body) return;
		const query = this.searchQueries[tab];
		const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
		const searching = terms.length > 0;
		body.classList.toggle("is-searching", searching);

		const filterList = (list: Element): number => {
			let shown = 0;
			list.querySelectorAll<HTMLElement>(".wb-card").forEach((card) => {
				const haystack = this.searchIndex.get(card) ?? "";
				const match = terms.every((t) => haystack.includes(t));
				card.classList.toggle("wb-filtered-out", !match);
				if (match) shown++;
			});
			return shown;
		};

		let matches = 0;

		if (this.hierarchicalTabs.has(tab)) {
			// A card is kept visible if it matches directly, or if any of its (nested) descendants
			// do, so a matching child's ancestors stay in view to give it context. Evaluated bottom
			// up: a child group's own visibility is resolved before its parent card decides its own.
			const evalGroup = (list: Element): boolean => {
				let anyVisible = false;
				list.querySelectorAll(":scope > .wb-card").forEach((el) => {
					const card = el as HTMLElement;
					const haystack = this.searchIndex.get(card) ?? "";
					const ownMatch = terms.every((t) => haystack.includes(t));
					if (ownMatch) matches++;
					const childGroup = card.nextElementSibling;
					const childList = childGroup?.classList.contains("wb-child-group")
						? childGroup.querySelector<HTMLElement>(":scope > .wb-list")
						: null;
					const descendantMatch = childList ? evalGroup(childList) : false;
					const show = ownMatch || descendantMatch;
					card.classList.toggle("wb-filtered-out", searching && !show);
					const treeHeader = card.previousElementSibling;
					if (treeHeader?.classList.contains("wb-tree-header")) {
						treeHeader.classList.toggle("wb-filtered-out", searching && !show);
					}
					if (show) anyVisible = true;
				});
				return anyVisible;
			};
			body.querySelectorAll<HTMLElement>(":scope > .wb-list").forEach((topList) => {
				const anyVisible = evalGroup(topList);
				const sectionHeader = topList.previousElementSibling;
				if (sectionHeader?.classList.contains("wb-tree-section-header")) {
					sectionHeader.classList.toggle("wb-filtered-out", searching && !anyVisible);
				}
			});
		} else {
			body.querySelectorAll<HTMLElement>(".wb-group-header:not(.wb-subsidiary-header)").forEach((header) => {
				const list = header.nextElementSibling;
				if (!list || !list.classList.contains("wb-list")) return;
				const shown = filterList(list);
				const hideGroup = searching && shown === 0;
				header.classList.toggle("wb-filtered-out", hideGroup);
				list.classList.toggle("wb-filtered-out", hideGroup);
				matches += shown;
			});
			// Tabs without group sections: plain lists
			body.querySelectorAll<HTMLElement>(":scope > .wb-list").forEach((list) => {
				if (list.previousElementSibling?.classList.contains("wb-group-header")) return;
				matches += filterList(list);
			});
			// Groups: a "Subsidiaries" label stays only while something inside it matches, and
			// keeps its parent's card in view for context. Deepest first (reverse document order),
			// so a nested match has already revealed its own parent card before the level above looks.
			const subGroups = Array.from(body.querySelectorAll<HTMLElement>(".wb-subsidiary-group")).reverse();
			for (const group of subGroups) {
				const anyShown = !!group.querySelector(":scope > .wb-list > .wb-card:not(.wb-filtered-out)");
				group.classList.toggle("wb-filtered-out", searching && !anyShown);
				const owner = group.previousElementSibling;
				if (searching && anyShown && owner?.classList.contains("wb-card")) owner.classList.remove("wb-filtered-out");
			}
		}

		const none = body.querySelector<HTMLElement>(".wb-no-results");
		if (none) {
			none.textContent = `No ${none.getAttribute("data-noun") ?? "entries"} match \u201c${query.trim()}\u201d.`;
			none.classList.toggle("wb-filtered-out", !(searching && matches === 0));
		}
	}

	/** Returns a displayable URL for the first image embedded in a note, or null. */
	findFirstImageSrc(content: string, file: TFile): string | null {
		return this.findFirstImage(content, file)?.src ?? null;
	}

	/**
	 * Finds the first image embedded in a note (the one shown as the card's portrait): its
	 * displayable URL plus where its embed sits in `content`, so it can be swapped for another.
	 * `size` is an Obsidian size spec on the embed ("300" or "300x200"), if it had one.
	 */
	findFirstImage(content: string, file: TFile): PortraitMatch | null {
		const re = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			const start = m.index;
			const end = m.index + m[0].length;
			let target: string;
			let size = "";
			if (m[1] !== undefined) {
				// Wiki embed: ![[image.png|300]]
				const parts = m[1].split("|");
				target = parts[0].split("#")[0].trim();
				size = (parts[1] ?? "").trim();
			} else {
				// Markdown embed: ![alt](path/to/image.png) or ![alt|300](...)
				size = (m[2] ?? "").split("|").pop()!.trim();
				target = (m[3] ?? "").trim();
				if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
				if (/^https?:\/\//i.test(target)) {
					const bare = target.split(/[?#]/)[0];
					if (IMG_EXT.test(bare)) {
						return { src: target, start, end, file: null, name: bare.split("/").pop() || target, size: SIZE_SPEC.test(size) ? size : "" };
					}
					continue;
				}
				try { target = decodeURIComponent(target); } catch { /* keep as-is */ }
				target = target.split("#")[0];
			}
			if (!IMG_EXT.test(target)) continue;
			const dest =
				this.app.metadataCache.getFirstLinkpathDest(target, file.path) ??
				this.app.vault.getAbstractFileByPath(target);
			if (dest instanceof TFile) {
				return { src: this.app.vault.getResourcePath(dest), start, end, file: dest, name: dest.name, size: SIZE_SPEC.test(size) ? size : "" };
			}
		}
		return null;
	}

	async renderSection(
		tab: SectionTab,
		pane: TabPane,
		folderPath: string,
		label: string,
		onCreate: () => void,
		getCard: CardFn,
		opts: {
			thumbs?: boolean;
			reload?: boolean;
			groupGroups?: boolean;
			/** Groups: group entries under collapsible Corporation / Government / Military / Criminal headers by their `type` property. */
			typeGroups?: boolean;
			stackBadge?: boolean;
			/** Clicking a card expands an in-sidebar, text-only preview instead of opening the note. */
			expandable?: boolean;
			/** Nest entries under their detected parent (see renderHierarchicalGroup); requires getParentName/getOwnName. */
			hierarchical?: boolean;
			getParentName?: (fm: Record<string, string>) => string;
			getOwnName?: (fm: Record<string, string>) => string;
			/** Hierarchical tabs: roots matching isMovable (and their children) go in their own collapsible section, drawn last. */
			movableSection?: { label: string; isMovable: (fm: Record<string, string>) => boolean };
		} = {}
	) {
		const container = pane.body;
		this.sectionConfigs[tab] = { getCard, thumbs: !!opts.thumbs, stackBadge: !!opts.stackBadge };
		this.renderSectionHeader(pane, onCreate, opts.reload ?? true);

		const files = getMarkdownFilesIn(this.app, folderPath);

		if (files.length === 0) {
			container.createDiv("wb-list").createDiv({ cls: "wb-empty", text: `No ${label.toLowerCase()} yet.` });
			return;
		}

		const entries: NoteEntry[] = [];
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			const entry: NoteEntry = { file, content, fm: readFrontmatter(content) };
			entries.push(entry);
			this.entryByPath.set(file.path, entry);
		}

		if (opts.hierarchical) {
			const { roots, childrenOf } = buildParentTree(
				entries,
				opts.getParentName ?? (() => ""),
				opts.getOwnName ?? ((fm) => fm.name ?? "")
			);
			const movable = opts.movableSection;
			const fixedRoots = movable ? roots.filter((e) => !movable.isMovable(e.fm)) : roots;
			const movableRoots = movable ? roots.filter((e) => movable.isMovable(e.fm)) : [];
			this.renderHierarchicalGroup(
				tab, container, fixedRoots, entries, childrenOf, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable
			);
			if (movable && movableRoots.length) {
				// Same collapsible label as a parent location, but heading a whole section of its own.
				const header = this.createTreeHeader(container, movable.label);
				header.addClass("wb-tree-section-header");
				this.renderHierarchicalGroup(
					tab, container, movableRoots, entries, childrenOf, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable
				);
				const sectionList = header.nextElementSibling as HTMLElement;
				this.wireTreeCollapse(tab, header, [sectionList], `${tab}:section:${movable.label.toLowerCase()}`);
			}
			this.createNoResultsLine(container, label);
			return;
		}

		if (opts.typeGroups) {
			this.renderTypeGroups(tab, container, entries, getCard, opts);
			this.createNoResultsLine(container, label);
			return;
		}

		if (!opts.groupGroups) {
			const list = container.createDiv("wb-list");
			const ordered = this.orderEntries(entries, this.plugin.settings.sectionOrder[tab] ?? []);
			for (const entry of ordered) this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
			this.enableReorder(list, async (order) => {
				this.plugin.settings.sectionOrder[tab] = order;
				await this.plugin.saveSettings();
			});
			this.createNoResultsLine(container, label);
			return;
		}

		// Characters: one sub-section per group, each with its own drag-to-reorder list.
		const groups = new Map<string, { label: string; items: NoteEntry[] }>();
		for (const entry of entries) {
			const group = (entry.fm.group ?? "").trim();
			const key = group.toLowerCase();
			let bucket = groups.get(key);
			if (!bucket) {
				bucket = { label: group || "No Group", items: [] };
				groups.set(key, bucket);
			}
			bucket.items.push(entry);
		}

		// Each group's logo: the first image in its note under <World>/Groups, matched by
		// the note's `name` property or its file name (case-insensitive).
		const groupLogos = new Map<string, string>();
		const groupFolder = `${this.plugin.settings.worldFolder}/Groups`;
		for (const file of getMarkdownFilesIn(this.app, groupFolder)) {
			const content = await this.app.vault.cachedRead(file);
			const src = this.findFirstImageSrc(content, file);
			if (!src) continue;
			const names = [readFrontmatter(content).name ?? "", file.basename];
			for (const n of names) {
				const k = parseRefName(n).toLowerCase();
				if (k && !groupLogos.has(k)) groupLogos.set(k, src);
			}
		}

		// Alphabetical by group, with characters who have no group last.
		const orderedGroups = [...groups.entries()].sort(
			([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)
		);

		for (const [key, group] of orderedGroups) {
			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
			const logoSrc = key ? groupLogos.get(parseRefName(key).toLowerCase()) : undefined;
			if (logoSrc) {
				const logo = header.createEl("img", {
					cls: "wb-group-logo",
					attr: { src: logoSrc, alt: "", draggable: "false" },
				});
				logo.onerror = () => logo.remove();
			}
			header.createSpan({ cls: "wb-group-title", text: group.label });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedGroups.includes(key));
			this.groupCollapsers.set(header, () => {
				const settings = this.plugin.settings;
				if (!settings.collapsedGroups.includes(key)) settings.collapsedGroups = [...settings.collapsedGroups, key];
				applyCollapsed(true);
			});

			const toggleCollapsed = async () => {
				// While searching, matching sections are shown open regardless; leave the saved state alone.
				if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
				const settings = this.plugin.settings;
				const collapse = !settings.collapsedGroups.includes(key);
				settings.collapsedGroups = collapse
					? [...settings.collapsedGroups, key]
					: settings.collapsedGroups.filter((k) => k !== key);
				applyCollapsed(collapse);
				await this.plugin.saveSettings();
			};
			header.onclick = () => void toggleCollapsed();
			header.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					void toggleCollapsed();
				}
			};

			// Saved order first; anything not yet ordered keeps its default position after them.
			const items = this.orderEntries(group.items, this.plugin.settings.characterOrder[key] ?? []);

			for (const entry of items) this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
			this.enableReorder(list, async (order) => {
				this.plugin.settings.characterOrder[key] = order;
				await this.plugin.saveSettings();
			});
		}

		this.createNoResultsLine(container, label);
	}

	/**
	 * A tab's section header (fixed region): Back/Forward on the left (only when SHOW_NAV_BUTTONS is
	 * on); Reload and (for the entry sections) + New on the right, the same size as the title row's
	 * Bookmarks button (.wb-header-btn). The section's name isn't shown here: the highlighted tab
	 * above already shows it.
	 */
	private renderSectionHeader(pane: TabPane, onCreate: (() => void) | null, reload: boolean) {
		const hdr = pane.head.createDiv("wb-section-header");
		// Back/forward (if shown) at the left edge of the header.
		const titleGroup = hdr.createDiv("wb-section-title");
		if (SHOW_NAV_BUTTONS) {
			const navGroup = titleGroup.createDiv("wb-nav-buttons");
			const backBtn = navGroup.createEl("button", {
				cls: "wb-nav-btn",
				text: "<",
				attr: { type: "button", "aria-label": "Back" },
			});
			const fwdBtn = navGroup.createEl("button", {
				cls: "wb-nav-btn",
				text: ">",
				attr: { type: "button", "aria-label": "Forward" },
			});
			backBtn.onclick = () => this.navigateBack();
			fwdBtn.onclick = () => this.navigateForward();
			this.navButtons.push({ back: backBtn, fwd: fwdBtn });
		}

		const actions = hdr.createDiv("wb-section-actions");
		if (reload) {
			const reloadBtn = actions.createEl("button", { cls: "wb-btn-secondary wb-header-btn" });
			setIcon(reloadBtn.createSpan({ cls: "wb-btn-icon" }), "refresh-cw");
			reloadBtn.createSpan({ text: "Reload" });
			reloadBtn.onclick = async () => {
				await this.render();
				new Notice("Universe Builder reloaded.");
			};
		}
		if (onCreate) {
			const btn = actions.createEl("button", { text: "+ New", cls: "wb-btn-secondary wb-header-btn" });
			btn.onclick = onCreate;
		}
	}

	/**
	 * Groups: one collapsible sub-section per `type` property (Corporation, Government, Military, then Criminal),
	 * with groups that have no recognised type in an "Unassigned" section last. Headers use the
	 * same chevron as the Characters group groups, without a logo. Each section is its own
	 * drag-to-reorder list; its order is merged back into the tab's single saved order.
	 *
	 * An group whose `subsidiary-of` property names another group on this tab (matched on
	 * that group's `name`, tolerant of "[[Name]]" syntax, case and accents) is not listed in its
	 * own type section: it is drawn under its parent's card, inside a collapsible "Subsidiaries"
	 * label, whatever its own `type` says. If the parent can't be found (unset, misspelled, not an
	 * group, or part of a loop), the entry falls back to its `type` section as usual.
	 */
	private renderTypeGroups(
		tab: WBTab,
		container: HTMLElement,
		entries: NoteEntry[],
		getCard: CardFn,
		opts: { thumbs?: boolean; stackBadge?: boolean; expandable?: boolean }
	) {
		const known = new Set(GROUP_TYPES.map((t) => t.key));
		// Only entries whose parent was actually found are nested; everything else is a root.
		const { roots, childrenOf } = buildParentTree(
			entries,
			(fm) => fm[SUBSIDIARY_OF] ?? "",
			(fm) => fm.name ?? ""
		);
		const groups = new Map<string, NoteEntry[]>();
		for (const entry of roots) {
			const raw = (entry.fm.type ?? "").trim().toLowerCase();
			const key = known.has(raw) ? raw : "";
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(entry);
		}

		const sections = [...GROUP_TYPES, { key: "", label: "Unassigned" }].filter((t) => groups.has(t.key));
		for (const { key, label } of sections) {
			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
			header.createSpan({ cls: "wb-group-title", text: label });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedGroupTypes.includes(key));
			this.groupCollapsers.set(header, () => {
				const settings = this.plugin.settings;
				if (!settings.collapsedGroupTypes.includes(key)) settings.collapsedGroupTypes = [...settings.collapsedGroupTypes, key];
				applyCollapsed(true);
			});

			const toggleCollapsed = async () => {
				// While searching, matching sections are shown open regardless; leave the saved state alone.
				if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
				const settings = this.plugin.settings;
				const collapse = !settings.collapsedGroupTypes.includes(key);
				settings.collapsedGroupTypes = collapse
					? [...settings.collapsedGroupTypes, key]
					: settings.collapsedGroupTypes.filter((k) => k !== key);
				applyCollapsed(collapse);
				await this.plugin.saveSettings();
			};
			header.onclick = () => void toggleCollapsed();
			header.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					void toggleCollapsed();
				}
			};

			this.renderGroupList(tab, list, groups.get(key)!, entries, childrenOf, getCard, opts);
		}
	}

	/**
	 * Draws one drag-to-reorder list of group cards (a type section, or one parent's
	 * subsidiaries). Any card with subsidiaries gets a `.wb-child-group` right after it holding a
	 * collapsible "Subsidiaries" label and their own nested list, drawn the same way (so a
	 * subsidiary's own subsidiaries nest one level further in). The child group follows its card
	 * when it is dragged, and subsidiaries can only be reordered among themselves.
	 */
	private renderGroupList(
		tab: WBTab,
		list: HTMLElement,
		groupEntries: NoteEntry[],
		allEntries: NoteEntry[],
		childrenOf: Map<string, NoteEntry[]>,
		getCard: CardFn,
		opts: { thumbs?: boolean; stackBadge?: boolean; expandable?: boolean }
	) {
		const items = this.orderEntries(groupEntries, this.plugin.settings.sectionOrder[tab] ?? []);
		for (const entry of items) {
			this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
			const kids = childrenOf.get(entry.file.path);
			if (kids && kids.length) this.renderSubsidiaries(tab, list, entry, kids, allEntries, childrenOf, getCard, opts);
		}
		this.enableReorder(list, async (order) => {
			const settings = this.plugin.settings;
			const baseline = this.orderEntries(allEntries, settings.sectionOrder[tab] ?? []).map((e) => e.file.path);
			settings.sectionOrder[tab] = mergeGroupOrder(baseline, items.map((e) => e.file.path), order);
			await this.plugin.saveSettings();
		});
	}

	/** The collapsible "Subsidiaries" label (and its nested list) drawn right under a parent group's card. */
	private renderSubsidiaries(
		tab: WBTab,
		list: HTMLElement,
		parent: NoteEntry,
		kids: NoteEntry[],
		allEntries: NoteEntry[],
		childrenOf: Map<string, NoteEntry[]>,
		getCard: CardFn,
		opts: { thumbs?: boolean; stackBadge?: boolean; expandable?: boolean }
	) {
		const path = parent.file.path;
		const group = list.createDiv("wb-child-group wb-subsidiary-group");
		const header = group.createDiv("wb-group-header wb-subsidiary-header");
		header.setAttribute("role", "button");
		header.setAttribute("tabindex", "0");
		setIcon(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
		header.createSpan({ cls: "wb-group-title", text: "Subsidiaries" });
		header.createSpan({ cls: "wb-group-count", text: String(kids.length) });
		const subList = group.createDiv("wb-list");

		const applyCollapsed = (collapsed: boolean) => {
			header.classList.toggle("is-collapsed", collapsed);
			subList.classList.toggle("is-collapsed", collapsed);
			header.setAttribute("aria-expanded", String(!collapsed));
		};
		applyCollapsed(this.plugin.settings.collapsedSubsidiaries.includes(path));
		this.groupCollapsers.set(header, () => {
			const settings = this.plugin.settings;
			if (!settings.collapsedSubsidiaries.includes(path)) settings.collapsedSubsidiaries = [...settings.collapsedSubsidiaries, path];
			applyCollapsed(true);
		});

		const toggleCollapsed = async () => {
			// While searching, matching sections are shown open regardless; leave the saved state alone.
			if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
			const settings = this.plugin.settings;
			const collapse = !settings.collapsedSubsidiaries.includes(path);
			settings.collapsedSubsidiaries = collapse
				? [...settings.collapsedSubsidiaries, path]
				: settings.collapsedSubsidiaries.filter((p) => p !== path);
			applyCollapsed(collapse);
			await this.plugin.saveSettings();
		};
		header.onclick = () => void toggleCollapsed();
		header.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				void toggleCollapsed();
			}
		};

		this.renderGroupList(tab, subList, kids, allEntries, childrenOf, getCard, opts);
	}

	/**
	 * Applies a saved manual order (a list of note paths, earliest first) to a set of entries.
	 * Anything not yet present in `saved` keeps its original relative position after the ordered ones.
	 */
	private orderEntries(entries: NoteEntry[], saved: string[]): NoteEntry[] {
		const rank = (path: string) => {
			const i = saved.indexOf(path);
			return i === -1 ? saved.length : i;
		};
		return entries
			.map((entry, index) => ({ entry, index }))
			.sort((a, b) => rank(a.entry.file.path) - rank(b.entry.file.path) || a.index - b.index)
			.map(({ entry }) => entry);
	}

	/**
	 * Draws one sibling group of a hierarchical (parent/child) tab - the roots, or one parent's
	 * children - as its own `.wb-list`, then recurses into each entry's own children (if any)
	 * as a further-indented sibling group nested right after that entry's card. Each group gets
	 * its own enableReorder() call, so a card can only be dragged among its own siblings, and
	 * indentation is pure left-side margin (`.wb-child-group` in styles.css) that shrinks the
	 * nested group in from the left while its right edge stays flush with everything above it.
	 */
	private renderHierarchicalGroup(
		tab: WBTab,
		host: HTMLElement,
		groupEntries: NoteEntry[],
		allEntries: NoteEntry[],
		childrenOf: Map<string, NoteEntry[]>,
		getCard: CardFn,
		thumbs: boolean,
		stackBadge: boolean,
		expandable: boolean
	) {
		const list = host.createDiv("wb-list");
		const ordered = this.orderEntries(groupEntries, this.plugin.settings.sectionOrder[tab] ?? []);
		for (const entry of ordered) {
			const kids = childrenOf.get(entry.file.path);
			// Every entry gets an Groups-style collapsible label right above its card. For a
			// parent it hides the card and its whole subtree; for a leaf it hides just the card.
			const header = this.createTreeHeader(list, getCard(entry.fm).title);
			const card = this.renderCard(tab, list, entry, getCard, thumbs, stackBadge, expandable);
			const parts: HTMLElement[] = [card];
			if (kids && kids.length) {
				const childHost = list.createDiv("wb-child-group");
				this.renderHierarchicalGroup(tab, childHost, kids, allEntries, childrenOf, getCard, thumbs, stackBadge, expandable);
				parts.push(childHost);
			}
			this.wireTreeCollapse(tab, header, parts, entry.file.path);
		}
		this.enableReorder(list, async (order) => {
			const settings = this.plugin.settings;
			const baseline = this.orderEntries(allEntries, settings.sectionOrder[tab] ?? []).map((e) => e.file.path);
			const groupPaths = ordered.map((e) => e.file.path);
			settings.sectionOrder[tab] = mergeGroupOrder(baseline, groupPaths, order);
			await this.plugin.saveSettings();
		});
	}

	/** A collapsible label (chevron + name) drawn above every hierarchical entry's card. */
	private createTreeHeader(list: HTMLElement, title: string): HTMLElement {
		const header = list.createDiv("wb-group-header wb-tree-header");
		header.setAttribute("role", "button");
		header.setAttribute("tabindex", "0");
		setIcon(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
		header.createSpan({ cls: "wb-group-title", text: title });
		return header;
	}

	/**
	 * Makes a hierarchical parent's label collapse (or expand) the parent's own card together with
	 * its whole nested subtree - e.g. collapsing SOL hides everything in SOL, collapsing Earth hides
	 * Earth, Las Luna and Colonia. Nested labels keep their own saved state, so re-opening SOL shows
	 * Earth still collapsed if it was. The state is saved per note path in plugin data.
	 */
	private wireTreeCollapse(tab: WBTab, header: HTMLElement, parts: HTMLElement[], path: string) {
		for (const p of parts) p.setAttribute("data-tree-owner", path);
		const apply = (collapsed: boolean) => {
			header.classList.toggle("is-collapsed", collapsed);
			header.setAttribute("aria-expanded", String(!collapsed));
			for (const p of parts) p.classList.toggle("wb-tree-hidden", collapsed);
		};
		apply(this.plugin.settings.collapsedParents.includes(path));

		const setCollapsed = async (collapse: boolean) => {
			apply(collapse);
			const settings = this.plugin.settings;
			if (settings.collapsedParents.includes(path) === collapse) return;
			settings.collapsedParents = collapse
				? [...settings.collapsedParents, path]
				: settings.collapsedParents.filter((p) => p !== path);
			await this.plugin.saveSettings();
		};
		this.treeExpanders.set(path, () => setCollapsed(false));
		this.groupCollapsers.set(header, () => {
			const settings = this.plugin.settings;
			if (!settings.collapsedParents.includes(path)) settings.collapsedParents = [...settings.collapsedParents, path];
			apply(true);
		});

		const toggle = () => {
			// While searching, matching entries are shown open regardless; leave the saved state alone.
			if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
			void setCollapsed(!header.classList.contains("is-collapsed"));
		};
		header.onclick = toggle;
		header.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggle();
			}
		};
	}

	/** The "No ... match" line; hidden until applySearch() finds nothing. */
	private createNoResultsLine(container: HTMLElement, label: string) {
		container.createDiv({
			cls: "wb-empty wb-no-results wb-filtered-out",
			attr: { "data-noun": label.toLowerCase() },
		});
	}

	private renderCard(
		tab: WBTab,
		parent: HTMLElement,
		entry: NoteEntry,
		getCard: CardFn,
		thumbs: boolean,
		stackBadge: boolean,
		expandable: boolean
	): HTMLElement {
		const { file, content, fm } = entry;
		const { title, meta, badge, search, extraBadges } = getCard(fm);

		const card = parent.createDiv("wb-card");
		if (stackBadge) card.addClass("wb-card-stacked");
		card.setAttribute("data-path", file.path);
		// Characters supply their own (four properties); everything else searches name + note text.
		this.searchIndex.set(card, normalizeForSearch(search ?? `${title} ${documentSearchText(content, fm)}`));
		// Thumbnail + text live in their own row, kept separate from the card itself so that when
		// an expand area is appended below (see toggleCardExpand), it isn't pulled into this row's
		// flex layout as a second column — it stays a full-width block underneath.
		let body: HTMLElement = card;
		if (thumbs) {
			card.addClass("wb-card-with-thumb");
			const row = card.createDiv("wb-card-row");
			const thumb = row.createDiv("wb-thumb");
			const src = this.findFirstImageSrc(content, file);
			if (src) {
				const img = thumb.createEl("img", { attr: { src, alt: "", draggable: "false" } });
				thumb.addClass("wb-thumb-has-img");
				// Magnifier badge in the top-right corner; CSS only reveals it (on hover) while the
				// card is expanded, which is also the only time a click on the photo zooms it.
				const zoomBadge = thumb.createSpan({ cls: "wb-thumb-zoom", attr: { "aria-hidden": "true" } });
				setIcon(zoomBadge, "zoom-in");
				img.onerror = () => {
					img.remove();
					zoomBadge.remove();
					thumb.removeClass("wb-thumb-has-img");
				};
				thumb.addEventListener("click", (e) => {
					// Collapsed: let the click fall through to the card so it expands as usual.
					if (!card.classList.contains("wb-card-expanded") || !thumb.contains(img)) return;
					e.preventDefault();
					e.stopPropagation();
					openImageZoom(src, title);
				});
			}
			body = row.createDiv("wb-card-body");
			// Every section tab has portraits: drop an image on the card to set it.
			this.enableImageDrop(card, entry, title);
		}
		const titleEl = body.createDiv("wb-card-title");
		titleEl.createSpan({ text: title });
		if (expandable) titleEl.addClass("wb-card-title-row");
		const extras = extraBadges ?? [];
		if (badge || extras.length) {
			// stackBadge: badge on its own line under the name; otherwise inline beside it
			const badgeHost = stackBadge ? body.createDiv("wb-card-badge-row") : titleEl;
			if (badge) {
				const b = badgeHost.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
				b.setText(badge);
			}
			for (const extra of extras) badgeHost.createSpan({ cls: `wb-badge ${extra.cls}`, text: extra.text });
		}
		// Added last so it's always the rightmost element in the title row, after any inline badge.
		if (expandable) setIcon(titleEl.createSpan({ cls: "wb-card-chevron" }), "chevron-right");
		if (meta) for (const line of meta.split("\n")) body.createDiv({ cls: "wb-card-meta", text: line });

		if (expandable) {
			card.setAttribute("role", "button");
			card.setAttribute("tabindex", "0");
			card.setAttribute("aria-expanded", "false");
			card.onclick = () => this.toggleCardExpand(tab, card, entry);
			card.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.toggleCardExpand(tab, card, entry);
				}
			};
		} else {
			card.onclick = () => this.app.workspace.getLeaf().openFile(file);
		}
		return card;
	}

	/**
	 * Expands a card to show the note's text (all but the portrait image) instead of opening it in the
	 * editor, so writing in the main pane isn't interrupted. The expanded card floats over the list
	 * (see enterFloat), and only one card is expanded at a time: expanding another closes the open
	 * one first. Modify MD opens the note the normal way; Edit edits its markdown inline, still
	 * floating. Clicking the card's title row again (its X) collapses it back into the list.
	 * `force` skips the "Discard changes?" question (already answered).
	 */
	private toggleCardExpand(tab: WBTab, card: HTMLElement, entry: NoteEntry, force = false) {
		const wasExpanded = card.classList.contains("wb-card-expanded");
		// Collapsing a card mid-edit would throw the edits away: ask first.
		if (wasExpanded && !force && this.activeEdit?.card === card && this.activeEdit.isDirty()) {
			void confirmModal(this.app, "Discard changes?", `Your edits to "${entry.file.basename}" haven't been saved.`, "Discard").then((ok) => {
				if (ok) this.toggleCardExpand(tab, card, entry, true);
			});
			return;
		}
		if (wasExpanded) {
			this.collapseCard(card, false);
			this.recordNav(tab, null);
			return;
		}

		// Only one card floats at a time: close the open one (asking first if it has unsaved edits).
		const other = this.floating?.card;
		if (other && other !== card && other.isConnected && other.classList.contains("wb-card-expanded")) {
			if (!force && this.activeEdit?.card === other && this.activeEdit.isDirty()) {
				const name = this.entryByPath.get(other.getAttribute("data-path") ?? "")?.file.basename ?? "this entry";
				void confirmModal(this.app, "Discard changes?", `Your edits to "${name}" haven't been saved.`, "Discard").then((ok) => {
					if (ok) this.toggleCardExpand(tab, card, entry, true);
				});
				return;
			}
		}
		// Switching straight from one expanded entry to another (a [[link]], Back / Forward): the
		// old card drops back into the list and the new one appears in its place, with no animation.
		let switching = false;
		if (other && other !== card && other.isConnected && other.classList.contains("wb-card-expanded")) {
			this.collapseCard(other, true);
			switching = true;
		}

		// Lift the card out of the list, measured while it's still collapsed so it grows from there.
		this.enterFloat(card, switching);
		card.addClass("wb-card-expanded");
		card.setAttribute("aria-expanded", "true");

		const expand = card.createDiv("wb-card-expand");
		// Cards are drag-sortable (draggable="true"); override that here so selecting text in the
		// preview doesn't get hijacked into a card drag.
		expand.setAttribute("draggable", "false");
		// Clicks inside the expanded area (the Edit button, links, selecting text) shouldn't
		// also toggle the card's own expand/collapse handler.
		expand.onclick = (e) => e.stopPropagation();
		// Same for keys: Enter/Space on the toolbar buttons shouldn't reach the card's own key handler.
		expand.onkeydown = (e) => e.stopPropagation();

		const body = expand.createDiv("wb-card-expand-body");
		body.addClass("markdown-rendered");
		// Text in the preview can be selected (see styles.css) and copied with Ctrl/Cmd+C; custom
		// views get no right-click menu from Obsidian, so offer Copy for a selection made here.
		body.addEventListener("contextmenu", (e) => {
			const selection = body.win.getSelection();
			const text = selection?.toString() ?? "";
			if (!text.trim() || !selection?.anchorNode || !body.contains(selection.anchorNode)) return;
			e.preventDefault();
			e.stopPropagation();
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle("Copy").setIcon("copy").onClick(() => {
					void navigator.clipboard.writeText(text).catch(() => new Notice("Couldn't copy the selection."));
				})
			);
			menu.showAtMouseEvent(e);
		});
		// Frontmatter (properties already shown on the card above) and the portrait image (already
		// the card's thumbnail) are left out, plus the leading "# Name" heading the templates open
		// with, which just restates the card's own title. Every other image is kept, shown as a
		// 64px cropped square (see styles.css); clicking one opens it full-screen.
		const portraitMatch = this.findFirstImage(entry.content, entry.file);
		const withoutPortrait = portraitMatch
			? entry.content.slice(0, portraitMatch.start) + entry.content.slice(portraitMatch.end)
			: entry.content;
		const bodyText = stripLeadingHeading(stripFrontmatterBlock(withoutPortrait));
		void MarkdownRenderer.render(this.app, bodyText, body, entry.file.path, this);

		// Wiki-links in the preview (e.g. "Part of: [[Colonia]]") are rendered as clickable text but
		// do nothing on their own; jump to the linked note's own card instead of leaving the sidebar.
		body.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			if (target.instanceOf(HTMLImageElement) && target.src) {
				e.preventDefault();
				e.stopPropagation();
				openImageZoom(target.src, target.alt || entry.file.basename);
				return;
			}
			const link = target.closest<HTMLElement>("a.internal-link");
			if (!link) return;
			e.preventDefault();
			e.stopPropagation();
			const href = link.getAttribute("data-href") ?? link.getAttribute("href");
			if (href) this.followWikiLink(href, entry.file.path);
		});

		// Back / Forward | Bookmark (left); Modify MD + Edit (right). They sit at the top of the
		// expanded area, above their own divider and the note's text (or the editor), so they're
		// reachable without scrolling a long entry.
		const toolbar = createDiv("wb-card-expand-toolbar");
		body.insertAdjacentElement("beforebegin", toolbar);
		const leftGroup = toolbar.createDiv("wb-card-expand-left");
		// Back / Forward: step through the entries expanded before and after this one (e.g. after
		// following a [[link]] in the preview).
		const navBtn = (label: string, icon: string, dir: -1 | 1) => {
			const btn = leftGroup.createEl("button", {
				cls: "wb-btn-secondary wb-icon-btn wb-card-nav-btn",
				attr: { type: "button", "aria-label": label },
			});
			setIcon(btn, icon);
			btn.onclick = () => this.navigateCard(dir);
			return btn;
		};
		const cardBack = navBtn("Back", "chevron-left", -1);
		const cardFwd = navBtn("Forward", "chevron-right", 1);
		this.cardNavButtons.push({ back: cardBack, fwd: cardFwd });
		this.updateNavButtonStates();
		leftGroup.createSpan({ cls: "wb-toolbar-sep", text: "|", attr: { "aria-hidden": "true" } });
		const bookmarkBtn = leftGroup.createEl("button", {
			cls: "wb-btn-secondary wb-icon-btn wb-bookmark-toggle",
			attr: { type: "button", "data-bookmark-path": entry.file.path },
		});
		// Icon + label, like Modify MD / Edit beside it. The whole button (label included) turns the
		// accent color while the entry is bookmarked.
		setIcon(bookmarkBtn.createSpan({ cls: "wb-btn-icon" }), "bookmark");
		bookmarkBtn.createSpan({ text: "Bookmark" });
		this.syncBookmarkToggle(bookmarkBtn, this.plugin.settings.bookmarks.includes(entry.file.path));
		bookmarkBtn.onclick = () => void this.toggleBookmark(entry.file.path);

		// Right-hand group: [Modify MD] [Edit] while reading, swapped for [Cancel] [Save] while editing inline.
		const actions = toolbar.createDiv("wb-card-expand-actions");
		const showViewActions = () => {
			actions.empty();
			// Modify MD: opens the note in the main editor (what Edit used to do).
			const modifyBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
			setIcon(modifyBtn.createSpan({ cls: "wb-btn-icon" }), "file-text");
			modifyBtn.createSpan({ text: "Modify MD" });
			modifyBtn.onclick = () => this.app.workspace.getLeaf().openFile(entry.file);
			// Edit: edits the note's markdown right here in the sidebar.
			const editBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
			setIcon(editBtn.createSpan({ cls: "wb-btn-icon" }), "pencil");
			editBtn.createSpan({ text: "Edit" });
			editBtn.onclick = () => void runExclusive(startEditing);
		};
		const showEditActions = () => {
			actions.empty();
			const cancelBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
			setIcon(cancelBtn.createSpan({ cls: "wb-btn-icon" }), "x");
			cancelBtn.createSpan({ text: "Cancel" });
			cancelBtn.onclick = () => void runExclusive(discard);
			// Same look as Cancel beside it: the floating card already stands out on its own.
			const saveBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
			setIcon(saveBtn.createSpan({ cls: "wb-btn-icon" }), "check");
			saveBtn.createSpan({ text: "Save" });
			saveBtn.onclick = () => void runExclusive(finishEditing);
		};

		/**
		 * Inline editor: swaps the rendered preview for an editor holding the note's markdown.
		 * Normally that's Obsidian's own Live Preview editor (see createLivePreviewEditor), with the
		 * frontmatter in a small raw "Properties" box above it; if that can't be created, or the
		 * "Sidebar editor" setting is "Raw markdown", it's a plain textarea with the whole file.
		 * Save (or Mod+S / Mod+Enter) writes the changes and returns to the preview; the sidebar is
		 * redrawn so a changed name, role, group etc. shows on the card straight away. Cancel (or
		 * Escape) discards them, asking first if anything changed. Only one entry is edited at a time:
		 * opening the editor on another card saves and closes this one.
		 */
		let editor: InlineEditor | null = null;
		/** Portrait drop area above the editor, only for an entry that has no portrait yet. */
		let portrait: { picker: PortraitPicker; holder: HTMLElement } | null = null;
		const removePortraitPicker = () => {
			portrait?.picker.destroy();
			portrait?.holder.remove();
			portrait = null;
		};
		let original = "";
		let busy = false;
		/** Runs one editor action at a time, so a double-click can't save or open twice. */
		const runExclusive = async (fn: () => Promise<unknown>) => {
			if (busy) return;
			busy = true;
			try { await fn(); } finally { busy = false; }
		};
		const isDirty = () => !!editor && (editor.isDirty() || !!portrait?.picker.hasImage);

		const stopEditing = () => {
			if (this.activeEdit?.card === card) this.activeEdit = null;
			editor?.destroy();
			editor = null;
			removePortraitPicker();
			body.show();
			expand.removeClass("is-editing");
			showViewActions();
			// The card stays floating, back in read mode.
		};

		const startEditing = async () => {
			// Only one entry is edited at a time: close (and save) the one already open first.
			const other = this.activeEdit;
			if (other && other.card !== card) {
				// If saving it redraws the sidebar, this card is rebuilt and its editor opens from there.
				this.pendingEditPath = entry.file.path;
				const ok = await other.finish();
				if (!ok || !card.isConnected) {
					if (!ok) this.pendingEditPath = null;
					return;
				}
				this.pendingEditPath = null;
			}
			try {
				original = await this.app.vault.read(entry.file);
			} catch {
				new Notice(`Couldn't read "${entry.file.basename}".`);
				return;
			}
			if (!card.isConnected || !expand.isConnected || editor) return;

			expand.addClass("is-editing");
			showEditActions();
			body.hide();
			// No portrait yet: offer the same drop area as the New entry forms, above the editor.
			// The chosen image is only imported when the edits are saved.
			if (!this.findFirstImage(original, entry.file)) {
				const holder = createDiv("wb-card-editor-portrait");
				body.insertAdjacentElement("beforebegin", holder);
				const picker = new PortraitPicker(this.app, this.plugin, holder, entry.file.parent?.path ?? this.plugin.settings.worldFolder);
				portrait = { picker, holder };
			}
			const keys: InlineEditorKeys = {
				save: () => void runExclusive(finishEditing),
				cancel: () => void runExclusive(discard),
			};
			editor =
				(this.plugin.settings.inlineEditor === "live"
					? createLivePreviewEditor(this.app, this, body, entry.file, original, keys, this.findFirstImage(original, entry.file))
					: null) ?? createRawEditor(body, entry.file, original, keys);
			this.activeEdit = {
				card,
				isDirty,
				finish: async () => {
					await finishEditing();
					return !editor || !card.isConnected;
				},
				abandon: () => {
					editor?.destroy();
					editor = null;
					removePortraitPicker();
				},
			};
			editor.focus();
		};

		const discard = async () => {
			if (isDirty() && !(await confirmModal(this.app, "Discard changes?", `Your edits to "${entry.file.basename}" haven't been saved.`, "Discard"))) {
				editor?.focus();
				return;
			}
			stopEditing();
		};

		/** Leaves edit mode, saving first if anything changed. */
		const finishEditing = async () => {
			if (!editor) return;
			if (!isDirty()) { stopEditing(); return; }
			try {
				if (editor.isDirty()) {
					// Don't silently overwrite changes made elsewhere (e.g. in the main editor) since editing began.
					const current = await this.app.vault.read(entry.file);
					if (current !== original && !(await confirmModal(
						this.app,
						"Note changed elsewhere",
						`"${entry.file.basename}" was modified outside the sidebar after you started editing. Overwrite it with your version?`,
						"Overwrite"
					))) {
						editor?.focus();
						return;
					}
					if (!editor) return;
					await this.app.vault.modify(entry.file, editor.getText());
				}
				// Added after the text is written, so it lands at the top of the saved body.
				await portrait?.picker.attachTo(entry.file, `Saved "${entry.file.basename}", but its portrait couldn't be imported.`);
				removePortraitPicker();
				if (this.activeEdit?.card === card) this.activeEdit = null;
				editor?.destroy();
				editor = null;
				// Redraw so the card's title/badges/grouping reflect the new frontmatter, then re-open it
				// (still floating, in read mode).
				await this.render({ keepExpanded: true });
				new Notice(`Saved "${entry.file.basename}".`);
			} catch (err) {
				console.error("Universe Builder: save failed", err);
				new Notice(`Couldn't save "${entry.file.basename}".`);
			}
		};


		showViewActions();

		// Switching edits from another card saved (and redrew) the sidebar: open this card's editor now.
		if (this.pendingEditPath === entry.file.path) {
			this.pendingEditPath = null;
			void runExclusive(startEditing);
		}

		this.recordNav(tab, entry.file.path);
	}

	/**
	 * Collapses an expanded card back into its list: closes its inline editor (without saving), removes
	 * the expanded area, and shrinks it from floating back into its place (at once if `instant`).
	 */
	private collapseCard(card: HTMLElement, instant: boolean) {
		if (this.activeEdit?.card === card) {
			this.activeEdit.abandon();
			this.activeEdit = null;
		}
		card.querySelector(":scope > .wb-card-expand")?.remove();
		card.removeClass("wb-card-expanded");
		card.setAttribute("aria-expanded", "false");
		if (this.floating?.card === card) void this.exitFloat(instant);
	}

	// ─── Floating card (expanded entry over the list) ──────────────────────────────

	/**
	 * Floats an expanding card over the list: it covers the list area plus the section header and
	 * search bar, from just under the section tabs to the bottom of the sidebar, inset by FLOAT_GAP
	 * (FLOAT_GAP_BOTTOM at the bottom), with everything behind it dimmed. It stays floating in
	 * read mode and while being edited inline. The card is lifted out of the list (position:
	 * absolute on the view's root) and a placeholder of its height keeps its spot, so nothing below
	 * it moves and exitFloat() can shrink it straight back. Call it before adding the card's
	 * expanded contents: the animation starts from the card's current (collapsed) size. `instant`
	 * skips the animation (used when switching straight from another expanded entry).
	 */
	private enterFloat(card: HTMLElement, instant = false) {
		void this.exitFloat(true); // instant: finishes synchronously
		const root = this.containerEl;
		const pane = card.closest<HTMLElement>(".wb-tab-body");
		if (!pane || !card.isConnected) return;

		const start = this.rectInRoot(card);
		const placeholder = createDiv("wb-edit-placeholder");
		placeholder.style.height = `${start.height}px`;
		card.insertAdjacentElement("beforebegin", placeholder);

		const backdrop = root.createDiv("wb-edit-backdrop");
		const observer = new ResizeObserver(() => this.updateFloatBounds());
		observer.observe(root);
		const fixed = root.querySelector<HTMLElement>(".wb-fixed");
		if (fixed) observer.observe(fixed);
		// The tab bar can wrap onto a second line when the sidebar is resized.
		const tabBar = root.querySelector<HTMLElement>(".wb-tabs");
		if (tabBar) observer.observe(tabBar);
		this.floating = { card, placeholder, pane, backdrop, observer, draggable: card.getAttribute("draggable") };
		this.updateFloatBounds();

		// Cards are drag-sortable; don't let the floating one be picked up.
		card.setAttribute("draggable", "false");
		// The chevron becomes an X while floating: clicking the title row closes the card.
		this.setCardChevron(card, "x");
		root.addClass("wb-has-edit-focus");
		pane.addClass("wb-edit-focus-pane");
		card.addClass("wb-card-focus");
		// Floating on a tab that isn't showing (e.g. re-opened by a redraw): keep that tab's float hidden.
		const paneShown = pane.classList.contains("active");
		root.toggleClass("wb-edit-focus-hidden", !paneShown);

		if (instant || this.floatInstantly || !paneShown || this.reducedMotion()) {
			backdrop.addClass("is-visible");
			return;
		}
		// Start exactly where the card sat in the list, then grow to the focus bounds.
		this.setFocusGeometry(card, start);
		card.addClass("wb-card-focus-animating");
		void card.offsetWidth; // commit the start position before transitioning away from it
		backdrop.addClass("is-visible");
		this.setFocusGeometry(card, this.focusTarget());
		window.setTimeout(() => {
			if (this.floating?.card !== card) return;
			card.removeClass("wb-card-focus-animating");
			this.setFocusGeometry(card, null); // hand over to the CSS bounds, which follow resizes
		}, FLOAT_MS);
	}

	/**
	 * Shrinks the floating card back into its place in the list and restores the list. Resolves
	 * once the animation has finished. `instant` skips the animation (the card is being collapsed
	 * or redrawn); so does a card that's no longer on screen.
	 */
	private async exitFloat(instant = false): Promise<void> {
		const focus = this.floating;
		if (!focus) return;
		this.floating = null;
		focus.observer.disconnect();
		const { card, placeholder, pane, backdrop } = focus;
		const finish = () => {
			card.removeClass("wb-card-focus", "wb-card-focus-animating");
			this.setFocusGeometry(card, null);
			this.setCardChevron(card, "chevron-right");
			if (focus.draggable === null) card.removeAttribute("draggable");
			else card.setAttribute("draggable", focus.draggable);
			placeholder.remove();
			backdrop.remove();
			pane.removeClass("wb-edit-focus-pane");
			this.containerEl.removeClass("wb-has-edit-focus", "wb-edit-focus-hidden");
		};
		const visible = card.isConnected && placeholder.isConnected && card.offsetParent !== null;
		if (instant || !visible || this.reducedMotion()) { finish(); return; }

		const target = this.rectInRoot(placeholder);
		this.setFocusGeometry(card, this.rectInRoot(card));
		card.addClass("wb-card-focus-animating");
		void card.offsetWidth;
		backdrop.removeClass("is-visible");
		// Back to the spot (and height) it had in the list, which the placeholder kept.
		this.setFocusGeometry(card, target);
		await new Promise<void>((resolve) => window.setTimeout(resolve, FLOAT_MS));
		finish();
	}

	/** Swaps the icon in a card's title-row chevron (the collapsed arrow, or an X while the card floats). */
	private setCardChevron(card: HTMLElement, icon: "chevron-right" | "x") {
		const chevron = card.querySelector<HTMLElement>(":scope > .wb-card-row .wb-card-chevron, :scope > .wb-card-title .wb-card-chevron");
		if (!chevron) return;
		chevron.empty();
		setIcon(chevron, icon);
	}

	/** Recomputes the edges of the area the floating card fills (CSS variables on the root). */
	private updateFloatBounds() {
		const root = this.containerEl;
		const scroll = root.querySelector<HTMLElement>(".wb-scroll");
		if (!scroll) return;
		const r = root.getBoundingClientRect();
		const sc = scroll.getBoundingClientRect();
		const cs = getComputedStyle(scroll);
		// Starts right under the section tabs, so the section header and search bar are covered too
		// (searching while an entry floats would only filter the hidden list). The tabs stay usable.
		const tabs = root.querySelector<HTMLElement>(".wb-tabs");
		const top = (tabs ? tabs.getBoundingClientRect().bottom : sc.top) - r.top;
		root.style.setProperty("--wb-focus-area-top", `${top}px`);
		root.style.setProperty("--wb-focus-top", `${top + FLOAT_GAP}px`);
		root.style.setProperty("--wb-focus-bottom", `${r.bottom - sc.bottom + FLOAT_GAP_BOTTOM}px`);
		root.style.setProperty("--wb-focus-left", `${sc.left - r.left + (parseFloat(cs.paddingLeft) || 0)}px`);
		root.style.setProperty("--wb-focus-right", `${r.right - sc.right + (parseFloat(cs.paddingRight) || 0)}px`);
	}

	/** Where the floating card ends up, in the root's coordinates. */
	private focusTarget(): { top: number; left: number; width: number; height: number } {
		const root = this.containerEl;
		const r = root.getBoundingClientRect();
		const px = (name: string) => parseFloat(root.style.getPropertyValue(name)) || 0;
		const top = px("--wb-focus-top");
		const left = px("--wb-focus-left");
		return { top, left, width: r.width - left - px("--wb-focus-right"), height: r.height - top - px("--wb-focus-bottom") };
	}

	/** An element's box relative to the view's root (the floating card's containing block). */
	private rectInRoot(el: HTMLElement): { top: number; left: number; width: number; height: number } {
		const r = this.containerEl.getBoundingClientRect();
		const b = el.getBoundingClientRect();
		return { top: b.top - r.top, left: b.left - r.left, width: b.width, height: b.height };
	}

	/** Pins the card to an explicit box while animating; null goes back to the CSS focus bounds. */
	private setFocusGeometry(card: HTMLElement, box: { top: number; left: number; width: number; height: number } | null) {
		if (!box) {
			for (const prop of ["top", "left", "width", "height", "right", "bottom"]) card.style.removeProperty(prop);
			return;
		}
		card.setCssStyles({
			top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`,
			right: "auto", bottom: "auto",
		});
	}

	private reducedMotion(): boolean {
		return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	}

	/**
	 * "Collapse all" for one section, triggered by double-clicking its (already active) tab button:
	 * closes every expanded card preview and folds every collapsible group label in the section
	 * (group groups on Characters, type groups and Subsidiaries on Groups, every tree label
	 * and the Ships section on Locations). The folded state is saved like a manual fold. While a
	 * search is active the matching entries still show (as with a manual fold); the saved state
	 * takes over once the search is cleared.
	 */
	private async collapseAllInTab(tab: SectionTab) {
		const pane = this.tabContents[tab];
		if (!pane) return;

		let closedCard = false;
		pane.body.querySelectorAll<HTMLElement>(".wb-card.wb-card-expanded").forEach((card) => {
			// Leave a card with unsaved inline edits open rather than dropping the edits.
			if (this.activeEdit?.card === card && this.activeEdit.isDirty()) return;
			this.collapseCard(card, false);
			closedCard = true;
		});
		if (closedCard) this.recordNav(tab, null);

		let folded = false;
		pane.body.querySelectorAll<HTMLElement>(".wb-group-header").forEach((header) => {
			const collapse = this.groupCollapsers.get(header);
			if (!collapse) return;
			collapse();
			folded = true;
		});
		this.refreshCurrentCardHighlight();
		this.updateShadowFn?.();
		if (folded) await this.plugin.saveSettings();
	}

	/** The section folder a tab's notes live in, e.g. "UniverseBuilder/Characters". */
	private tabFolder(tab: SectionTab): string {
		return `${this.plugin.settings.worldFolder}/${SECTION_LABELS[tab]}`;
	}

	/** Which tab (if any) a given file's own card lives on. */
	private findEntryTab(file: TFile): SectionTab | null {
		for (const tab of SECTION_TABS) {
			if (file.path.startsWith(this.tabFolder(tab) + "/")) return tab;
		}
		return null;
	}

	/**
	 * Switches the active tab's DOM (fixed header half + scrolling body half) without touching
	 * navigation history — callers that count as a "navigation" record it themselves via recordNav().
	 */
	private switchTab(id: WBTab) {
		this.activeTab = id;
		if (id !== "bookmarks") this.lastSectionTab = id;
		this.tabBarEl?.querySelectorAll<HTMLElement>(".wb-tab").forEach((b) => b.removeClass("active"));
		this.tabBarEl?.querySelector<HTMLElement>(`.wb-tab[data-tab="${id}"]`)?.addClass("active");
		Object.values(this.tabContents).forEach((c) => { c?.head.removeClass("active"); c?.body.removeClass("active"); });
		this.tabContents[id]?.head.addClass("active");
		this.tabContents[id]?.body.addClass("active");
		// A floating (expanded) entry stays up on its own tab; other tabs show (and scroll) normally.
		this.containerEl.toggleClass("wb-edit-focus-hidden", !!this.floating && this.floating.pane !== this.tabContents[id]?.body);
		this.showTabSearchFn?.();
		this.updateShadowFn?.();
		this.updateBookmarkHeaderButtons();
	}

	// ─── Bookmarks ───────────────────────────────────────────────────────────

	/** The title row's Bookmarks button: opens the Bookmarks view, or goes back to the last section if it's already open. */
	private toggleBookmarksView() {
		const target: WBTab = this.activeTab === "bookmarks" ? this.lastSectionTab : "bookmarks";
		this.switchTab(target);
		this.recordNav(target, null);
	}

	private updateBookmarkHeaderButtons() {
		const open = this.activeTab === "bookmarks";
		for (const btn of this.bookmarkHeaderButtons) {
			btn.classList.toggle("is-active", open);
			btn.setAttribute("aria-pressed", String(open));
			btn.setAttribute("aria-label", open ? "Close bookmarks" : "Bookmarks");
		}
	}

	private syncBookmarkToggle(btn: HTMLElement, on: boolean) {
		btn.classList.toggle("is-bookmarked", on);
		btn.setAttribute("aria-pressed", String(on));
		btn.setAttribute("aria-label", on ? "Remove bookmark" : "Add bookmark");
	}

	/** Adds or removes one note from the bookmarks, updating every expanded copy of its card. */
	private async toggleBookmark(path: string) {
		const settings = this.plugin.settings;
		const on = !settings.bookmarks.includes(path);
		settings.bookmarks = on ? [...settings.bookmarks, path] : settings.bookmarks.filter((p) => p !== path);
		this.containerEl.querySelectorAll<HTMLElement>(".wb-bookmark-toggle").forEach((btn) => {
			if (btn.getAttribute("data-bookmark-path") === path) this.syncBookmarkToggle(btn, on);
		});
		// Redraw the Bookmarks list right away, so an entry un-bookmarked from inside the Bookmarks
		// view disappears from it without needing Reload.
		this.renderBookmarks();
		await this.plugin.saveSettings();
	}

	/**
	 * Draws the Bookmarks view's list: bookmarked entries grouped under collapsible section headers
	 * (Characters, Locations, ...), each card drawn exactly as on its own tab. Each group can be
	 * dragged into its own order, saved back into the single bookmarks list.
	 */
	private renderBookmarks() {
		const pane = this.tabContents.bookmarks;
		if (!pane) return;
		const container = pane.body;
		const tab: WBTab = "bookmarks";
		// Keep what the reader had open (expanded cards, scroll position) across the redraw.
		const wasExpanded = new Set(
			Array.from(container.querySelectorAll<HTMLElement>(".wb-card.wb-card-expanded")).map(
				(c) => c.getAttribute("data-path") ?? ""
			)
		);
		const scrollEl = this.activeTab === tab ? container.closest<HTMLElement>(".wb-scroll") : null;
		const scrollTop = scrollEl?.scrollTop ?? 0;
		container.empty();
		// The floating card, if it was one of these, went with the old list.
		if (this.floating && !this.floating.card.isConnected) void this.exitFloat(true);

		const entries = this.plugin.settings.bookmarks
			.map((path) => this.entryByPath.get(path))
			.filter((e): e is NoteEntry => !!e);
		if (entries.length === 0) {
			container.createDiv("wb-list").createDiv({
				cls: "wb-empty",
				text: "No bookmarks yet. Expand an entry and click its bookmark icon to add it here.",
			});
			this.applySearch(tab);
			return;
		}

		for (const section of SECTION_TABS) {
			const cfg = this.sectionConfigs[section];
			const items = entries.filter((e) => this.findEntryTab(e.file) === section);
			if (!cfg || items.length === 0) continue;

			const header = container.createDiv("wb-group-header");
			header.setAttribute("role", "button");
			header.setAttribute("tabindex", "0");
			setIcon(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
			header.createSpan({ cls: "wb-group-title", text: SECTION_LABELS[section] });
			const list = container.createDiv("wb-list");

			const applyCollapsed = (collapsed: boolean) => {
				header.classList.toggle("is-collapsed", collapsed);
				list.classList.toggle("is-collapsed", collapsed);
				header.setAttribute("aria-expanded", String(!collapsed));
			};
			applyCollapsed(this.plugin.settings.collapsedBookmarkGroups.includes(section));
			const toggleCollapsed = async () => {
				if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
				const settings = this.plugin.settings;
				const collapse = !settings.collapsedBookmarkGroups.includes(section);
				settings.collapsedBookmarkGroups = collapse
					? [...settings.collapsedBookmarkGroups, section]
					: settings.collapsedBookmarkGroups.filter((k) => k !== section);
				applyCollapsed(collapse);
				await this.plugin.saveSettings();
			};
			header.onclick = () => void toggleCollapsed();
			header.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					void toggleCollapsed();
				}
			};

			for (const entry of items) this.renderCard(tab, list, entry, cfg.getCard, cfg.thumbs, cfg.stackBadge, true);
			this.enableReorder(list, async (order) => {
				const settings = this.plugin.settings;
				// Skip cards un-bookmarked since the list was drawn, so a drag can't bring them back.
				const kept = order.filter((p) => settings.bookmarks.includes(p));
				settings.bookmarks = mergeGroupOrder(settings.bookmarks, items.map((e) => e.file.path), kept);
				await this.plugin.saveSettings();
			});
		}

		this.createNoResultsLine(container, "Bookmarks");
		this.applySearch(tab);

		// Re-open the cards that were expanded before the redraw, without adding history entries.
		if (wasExpanded.size) {
			this.restoringNav = true;
			this.floatInstantly = true;
			try {
				container.querySelectorAll<HTMLElement>(".wb-card").forEach((card) => {
					const path = card.getAttribute("data-path") ?? "";
					const entry = this.entryByPath.get(path);
					if (entry && wasExpanded.has(path)) this.toggleCardExpand(tab, card, entry);
				});
			} finally {
				this.restoringNav = false;
				this.floatInstantly = false;
			}
		}
		if (scrollEl) scrollEl.scrollTop = scrollTop;
		this.refreshCurrentCardHighlight();
	}

	/**
	 * Records where the sidebar is now pointed (which tab, and which card - if any - is the one the
	 * user just navigated to) as a Back/Forward history entry. Ignored while a Back/Forward click is
	 * itself replaying a past entry, and skipped if it's identical to the current entry.
	 */
	private recordNav(tab: WBTab, cardPath: string | null) {
		if (this.restoringNav) return;
		const top = this.navHistory[this.navIndex];
		if (top && top.tab === tab && top.cardPath === cardPath) return;
		this.navHistory = this.navHistory.slice(0, this.navIndex + 1);
		this.navHistory.push({ tab, cardPath });
		this.navIndex = this.navHistory.length - 1;
		this.updateNavButtonStates();
	}

	private updateNavButtonStates() {
		const canBack = this.navIndex > 0;
		const canForward = this.navIndex < this.navHistory.length - 1;
		for (const { back, fwd } of this.navButtons) {
			back.toggleAttribute("disabled", !canBack);
			fwd.toggleAttribute("disabled", !canForward);
		}
		// Card toolbars: drop the ones whose card was collapsed or redrawn, then update the rest.
		this.cardNavButtons = this.cardNavButtons.filter(({ back }) => back.isConnected);
		const cardBack = this.cardNavTarget(-1) !== null;
		const cardFwd = this.cardNavTarget(1) !== null;
		for (const { back, fwd } of this.cardNavButtons) {
			back.toggleAttribute("disabled", !cardBack);
			fwd.toggleAttribute("disabled", !cardFwd);
		}
		this.refreshCurrentCardHighlight();
	}

	/**
	 * The nearest history entry before (-1) or after (1) the current one that has an expanded card,
	 * or null. Entries without one (a tab switch, or a card being closed) are skipped: the card
	 * toolbar's Back / Forward step from one expanded entry to the next.
	 */
	private cardNavTarget(dir: -1 | 1): number | null {
		for (let i = this.navIndex + dir; i >= 0 && i < this.navHistory.length; i += dir) {
			if (this.navHistory[i].cardPath) return i;
		}
		return null;
	}

	/** Back / Forward from an expanded card's toolbar: expands the previous / next expanded entry in the history. */
	private navigateCard(dir: -1 | 1) {
		const target = this.cardNavTarget(dir);
		if (target === null) return;
		this.navIndex = target;
		this.applyNavEntry(this.navHistory[target]);
	}

	/**
	 * Marks the card at the current point in the nav history (if any) as the "current" one, with an
	 * accent-colored border, and makes sure it's the only card so marked. Derived fresh from
	 * navHistory every time rather than tracked separately, so there's never more than one: expanding
	 * or jumping to a different card, collapsing the current one, or stepping Back/Forward all just
	 * change which entry (if any) is at navIndex, and this re-reads that.
	 */
	private refreshCurrentCardHighlight() {
		this.containerEl
			.querySelectorAll<HTMLElement>(".wb-card-current")
			.forEach((el) => el.removeClass("wb-card-current"));
		const current = this.navHistory[this.navIndex];
		if (!current?.cardPath) return;
		const pane = this.tabContents[current.tab];
		const card = pane?.body.querySelector<HTMLElement>(`.wb-card[data-path="${CSS.escape(current.cardPath)}"]`);
		card?.addClass("wb-card-current");
	}

	private navigateBack() {
		if (this.navIndex <= 0) return;
		this.navIndex--;
		this.applyNavEntry(this.navHistory[this.navIndex]);
	}

	private navigateForward() {
		if (this.navIndex >= this.navHistory.length - 1) return;
		this.navIndex++;
		this.applyNavEntry(this.navHistory[this.navIndex]);
	}

	private applyNavEntry(entry: { tab: WBTab; cardPath: string | null }) {
		this.restoringNav = true;
		try {
			this.switchTab(entry.tab);
			if (entry.cardPath) {
				this.revealCard(entry.tab, entry.cardPath);
			} else {
				// A history entry with no card: nothing on that tab is expanded, so close its floating card.
				const float = this.floating;
				const onTab = !!float && float.pane === this.tabContents[entry.tab]?.body;
				if (float && onTab && !(this.activeEdit?.card === float.card && this.activeEdit.isDirty())) {
					this.collapseCard(float.card, false);
				}
			}
		} finally {
			this.restoringNav = false;
		}
		this.updateNavButtonStates();
	}

	/**
	 * Follows a wiki-link clicked inside an expanded card's preview: if the target note has its own
	 * card somewhere in the sidebar, switches to that tab, expands its card and scrolls it into view
	 * instead of opening the note in the main editor. Anything outside the tracked sections (or an
	 * unresolved link) falls back to Obsidian's normal "open the note" behavior.
	 */
	private followWikiLink(linktext: string, sourcePath: string) {
		const linkPath = linktext.split("#")[0];
		const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
		if (!dest) {
			new Notice(`Couldn't find "${linktext}".`);
			return;
		}
		const tab = this.findEntryTab(dest);
		if (!tab) {
			void this.app.workspace.getLeaf().openFile(dest);
			return;
		}
		if (tab !== this.activeTab) this.switchTab(tab);
		this.revealCard(tab, dest.path);
	}

	/**
	 * Brings one tab's card into view: un-collapses its group group if needed, clears an active
	 * search filter that would otherwise hide it, expands it (recording that as a nav entry, same as
	 * a direct click would), and scrolls it into view.
	 */
	private revealCard(tab: WBTab, path: string) {
		const pane = this.tabContents[tab];
		if (!pane) return;
		const card = pane.body.querySelector<HTMLElement>(`.wb-card[data-path="${CSS.escape(path)}"]`);
		if (!card) return;

		// Open every collapsed list the card sits in (an group group, and on Groups any
		// "Subsidiaries" labels it is nested under).
		for (let list = card.closest<HTMLElement>(".wb-list"); list && list !== pane.body; list = list.parentElement?.closest<HTMLElement>(".wb-list") ?? null) {
			if (!list.classList.contains("is-collapsed")) continue;
			list.removeClass("is-collapsed");
			const header = list.previousElementSibling;
			if (header instanceof HTMLElement && header.classList.contains("wb-group-header")) {
				header.removeClass("is-collapsed");
				header.setAttribute("aria-expanded", "true");
			}
		}
		// Hierarchical tabs: open every collapsed parent label the card sits under (or belongs to).
		for (let el: HTMLElement | null = card; el && el !== pane.body; el = el.parentElement) {
			if (!el.classList.contains("wb-tree-hidden")) continue;
			const owner = el.getAttribute("data-tree-owner");
			if (owner) void this.treeExpanders.get(owner)?.();
		}

		if (card.classList.contains("wb-filtered-out") && this.searchQueries[tab]) {
			this.searchQueries[tab] = "";
			this.applySearch(tab);
			if (tab === this.activeTab) this.showTabSearchFn?.();
		}

		if (!card.classList.contains("wb-card-expanded")) {
			// Bring its spot in the list into view first: it floats up from there, and shrinks back
			// to it when closed.
			card.scrollIntoView({ block: "center" });
			const entry = this.entryByPath.get(path);
			if (entry) this.toggleCardExpand(tab, card, entry);
		}
	}

	/**
	 * Lets an image file be dropped onto a portrait card (collapsed or expanded) to set its
	 * portrait, from outside Obsidian (e.g. File Explorer) or from Obsidian's own file list. The
	 * card is outlined while an image is over it. Drops meant for an open inline editor are left
	 * to the editor, and card reorder drags (which carry application/x-wb-card) are ignored.
	 */
	private enableImageDrop(card: HTMLElement, entry: NoteEntry, title: string) {
		const isImage = (e: DragEvent) => isImageDrag(this.app, e);
		// Over the open inline editor: let the editor take the drop as it normally would.
		const overEditor = (e: DragEvent) =>
			this.activeEdit?.card === card &&
			e.target instanceof Node &&
			!!card.querySelector(":scope > .wb-card-expand")?.contains(e.target);
		const clear = () => card.removeClass("wb-card-image-drop");

		card.addEventListener("dragenter", (e) => {
			if (!isImage(e) || overEditor(e)) return;
			e.preventDefault();
			card.addClass("wb-card-image-drop");
		});
		card.addEventListener("dragover", (e) => {
			if (!isImage(e)) return;
			if (overEditor(e)) { clear(); return; }
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
			card.addClass("wb-card-image-drop");
		});
		card.addEventListener("dragleave", (e) => {
			if (!card.contains(e.relatedTarget as Node | null)) clear();
		});
		card.addEventListener("drop", (e) => {
			clear();
			if (!isImage(e) || overEditor(e)) return;
			e.preventDefault();
			e.stopPropagation();
			const image = droppedImageFrom(this.app, e.dataTransfer!);
			if (!image) return;
			if (this.activeEdit) {
				// Saving the portrait redraws the sidebar, which would close the open editor.
				new Notice("Finish editing the open entry before dropping an image.");
				return;
			}
			void this.setPortrait(entry.file, title, image);
		});
	}

	/**
	 * Sets a note's portrait to a dropped image. If the note already embeds a portrait image, asks
	 * before replacing it (declining changes nothing, and nothing is copied into the vault), then
	 * swaps that embed for the new one in place, keeping any size spec. Otherwise the embed is
	 * added at the very top of the note's body (right after the frontmatter, which has to stay first).
	 * An image from outside the vault is copied into `<Universe folder>/Images/<Section>` (see
	 * importImage), so the note never points at a file outside the vault.
	 */
	private async setPortrait(note: TFile, title: string, image: DroppedImage) {
		try {
			const existing = this.findFirstImage(await this.app.vault.read(note), note);
			if (existing) {
				if (image.kind === "vault" && existing.file?.path === image.file.path) {
					new Notice(`"${image.file.name}" is already the portrait for "${title}".`);
					return;
				}
				const ok = await confirmModal(
					this.app,
					"Replace portrait?",
					`"${title}" already has a portrait (${existing.name}). Replace it with ${image.file.name}?`,
					"Replace"
				);
				if (!ok) return;
			}

			let imageFile: TFile;
			if (image.kind === "vault") {
				imageFile = image.file;
			} else {
				imageFile = await importImage(this.app, this.plugin.settings.worldFolder, image.file, note.path);
			}

			await this.app.vault.process(note, (data) => {
				// Re-located in the current text, in case the note changed while the dialog was open.
				const current = this.findFirstImage(data, note);
				if (current) return data.slice(0, current.start) + portraitEmbed(this.app, imageFile, note.path, current.size) + data.slice(current.end);
				return insertAtBodyTop(data, portraitEmbed(this.app, imageFile, note.path));
			});
			await this.render({ keepExpanded: true });
			new Notice(`Portrait ${existing ? "replaced" : "added"} for "${title}".`);
		} catch (err) {
			console.error("Universe Builder: setting portrait failed", err);
			new Notice(`Couldn't set the portrait for "${title}".`);
		}
	}

	/**
	 * Makes the cards in one list drag-sortable (an group's character group, a hierarchical
	 * tab's parent or child group, or a whole flat tab like Lore). Each list only accepts cards
	 * that were picked up from that same list, so entries can't be dragged between groups,
	 * between a parent's children and its siblings, or between tabs. Every DOM query here is
	 * scoped to this list's own direct children (`:scope > .wb-card`) so a hierarchical tab's
	 * nested child-group lists - which live inside this list's DOM subtree - are never touched by
	 * an ancestor list's bookkeeping, and every listener stops propagation so a drag started in a
	 * nested list isn't also seen by the (ancestor) lists it's nested inside. The new order is
	 * handed to `onReorder` to persist to plugin data; notes themselves are never modified.
	 */
	private enableReorder(list: HTMLElement, onReorder: (order: string[]) => Promise<void>) {
		let dragged: HTMLElement | null = null;
		let dropTarget: HTMLElement | null = null;
		let dropAfter = false;

		const cardAt = (t: EventTarget | null): HTMLElement | null =>
			t instanceof HTMLElement ? t.closest<HTMLElement>(".wb-card") : null;
		// A card's "unit": its tree label above it and its nested child group below it (hierarchical
		// tabs), so a parent is always dragged together with its whole subtree.
		const unitOf = (card: HTMLElement): HTMLElement[] => {
			const parts: HTMLElement[] = [];
			const prev = card.previousElementSibling;
			if (prev instanceof HTMLElement && prev.classList.contains("wb-tree-header")) parts.push(prev);
			parts.push(card);
			const next = card.nextElementSibling;
			if (next instanceof HTMLElement && next.classList.contains("wb-child-group")) parts.push(next);
			return parts;
		};
		const clearMarks = () => {
			list.querySelectorAll(":scope > .wb-drop-before, :scope > .wb-drop-after").forEach((el) =>
				el.classList.remove("wb-drop-before", "wb-drop-after")
			);
			dropTarget = null;
		};

		list.querySelectorAll<HTMLElement>(":scope > .wb-card").forEach((card) =>
			card.setAttribute("draggable", "true")
		);

		list.addEventListener("dragstart", (e) => {
			const card = cardAt(e.target);
			if (!card || card.parentElement !== list || !e.dataTransfer) return;
			e.stopPropagation(); // keep an ancestor (hierarchical) list from also seeing this drag
			dragged = card;
			e.dataTransfer.effectAllowed = "move";
			// Custom type only, so dropping onto a note or editor doesn't paste anything.
			e.dataTransfer.setData("application/x-wb-card", card.getAttribute("data-path") ?? "");
			window.setTimeout(() => card.classList.add("wb-dragging"), 0);
		});

		list.addEventListener("dragend", () => {
			dragged?.classList.remove("wb-dragging");
			dragged = null;
			clearMarks();
		});

		list.addEventListener("dragover", (e) => {
			if (!dragged) return; // not picked up from this list: not a valid drop
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const target = cardAt(e.target);
			if (!target || target.parentElement !== list) return; // in a gap, or over a nested child group: keep the last indicator
			clearMarks();
			if (target === dragged) return;
			const r = target.getBoundingClientRect();
			dropTarget = target;
			dropAfter = e.clientY >= r.top + r.height / 2;
			const unit = unitOf(target);
			(dropAfter ? unit[unit.length - 1] : unit[0]).classList.add(dropAfter ? "wb-drop-after" : "wb-drop-before");
		});

		list.addEventListener("dragleave", (e) => {
			if (!list.contains(e.relatedTarget as Node | null)) clearMarks();
		});

		const handleDrop = async (e: DragEvent) => {
			if (!dragged) return;
			e.preventDefault();
			e.stopPropagation();
			const moving = dragged;
			if (dropTarget && dropTarget !== moving) {
				const movingParts = unitOf(moving);
				const targetParts = unitOf(dropTarget);
				const ref = dropAfter ? targetParts[targetParts.length - 1].nextSibling : targetParts[0];
				// Dropping right where the unit already sits leaves it in place.
				if (!movingParts.includes(ref as HTMLElement)) {
					for (const part of movingParts) list.insertBefore(part, ref);
				}
				const order = Array.from(list.querySelectorAll<HTMLElement>(":scope > .wb-card")).map(
					(c) => c.getAttribute("data-path") ?? ""
				);
				await onReorder(order);
			}
			clearMarks();
		};
		list.addEventListener("drop", (e) => void handleDrop(e));
	}
}

// ─── Inline editors (sidebar Edit button) ────────────────────────────────────

/** What the expanded card needs from whichever inline editor is open. */
interface InlineEditor {
	/** The full note text to write back (frontmatter + body). Returns the original text untouched if nothing changed. */
	getText(): string;
	isDirty(): boolean;
	focus(): void;
	/** Removes the editor from the DOM and releases anything it registered. */
	destroy(): void;
}
interface InlineEditorKeys { save: () => void; cancel: () => void; }

/** Splits a leading YAML frontmatter block into its delimiters and contents, so the two can be edited separately. */
function splitFrontmatter(text: string): { open: string; yaml: string; close: string; body: string } | null {
	const m = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
	if (!m) return null;
	return { open: m[1], yaml: m[2], close: m[3], body: text.slice(m[0].length) };
}

/** Plain auto-growing textarea (used for the whole note in raw mode, and for the Properties box in Live Preview mode). */
function createAutoTextarea(parent: HTMLElement, cls: string, value: string, label: string, keys: InlineEditorKeys): HTMLTextAreaElement {
	const ta = parent.createEl("textarea", { cls, attr: { spellcheck: "true", "aria-label": label } });
	ta.value = value;
	// Grow with the text (up to the CSS max-height, then it scrolls).
	const autosize = () => {
		ta.setCssStyles({ height: "auto" });
		ta.setCssStyles({ height: `${ta.scrollHeight + 2}px` });
	};
	ta.addEventListener("input", autosize);
	ta.addEventListener("keydown", (e) => {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && (e.key === "s" || e.key === "Enter")) {
			e.preventDefault();
			keys.save();
		} else if (e.key === "Escape") {
			e.preventDefault();
			keys.cancel();
		} else if (e.key === "Tab" && !mod && !e.altKey) {
			// Insert a tab instead of moving focus out of the editor.
			e.preventDefault();
			ta.setRangeText("\t", ta.selectionStart, ta.selectionEnd, "end");
			autosize();
		}
	});
	// Size once it's laid out (scrollHeight is 0 while detached).
	window.requestAnimationFrame(autosize);
	return ta;
}

/**
 * RAW MARKDOWN EDITOR: a plain textarea holding the note's entire file, frontmatter included.
 * Uses only standard DOM, so it can't be broken by Obsidian updates. It's the fallback whenever
 * the Live Preview editor can't be created, and what the "Sidebar editor: Raw markdown" setting uses.
 */
function createRawEditor(anchor: HTMLElement, file: TFile, text: string, keys: InlineEditorKeys): InlineEditor {
	const wrap = createDiv("wb-card-editor-wrap");
	anchor.insertAdjacentElement("afterend", wrap);
	const ta = createAutoTextarea(wrap, "wb-card-editor", text, `Edit ${file.basename}`, keys);
	return {
		getText: () => ta.value,
		isDirty: () => ta.value !== text,
		focus: () => {
			ta.focus();
			ta.setSelectionRange(0, 0);
			ta.scrollTop = 0;
		},
		destroy: () => wrap.remove(),
	};
}

/*
 * ⚠ UNDOCUMENTED OBSIDIAN API ⚠  (see README.md › "Undocumented Obsidian API")
 *
 * Obsidian's plugin API has no supported way to put its Live Preview editor inside a custom view.
 * The technique below, the same one the Kanban plugin uses for its card editor
 * (github.com/mgmeyers/obsidian-kanban, src/main.ts getEditorClass() and
 * src/components/Editor/MarkdownEditor.tsx), borrows the editor class from a throwaway markdown
 * embed:
 *   1. app.embedRegistry.embedByExtension.md(...) builds an embed (the kind used for ![[note]]).
 *   2. Setting editable = true and calling showEditor() makes it create its editor (embed.editMode).
 *   3. The prototype two levels up from editMode is Obsidian's internal (scrollable) markdown
 *      editor class; we keep its constructor and unload the embed.
 *   4. New instances of that class are then created in the sidebar with a small stand-in "owner"
 *      object mimicking the bits of MarkdownView the editor asks for.
 * Every internal name used: app.embedRegistry, embedByExtension.md, embed.editable,
 * embed.showEditor(), embed.editMode, the editor's constructor(app, containerEl, owner), its
 * set(text), .editor, .cm, updateBottomPadding(), and app.vault.config. If any of these change,
 * resolveLivePreviewEditorClass() or createLivePreviewEditor() returns null and the sidebar falls
 * back to createRawEditor() automatically.
 */
/** Text size of the sidebar's Live Preview editor relative to the main editor (0.75 = 25% smaller). */
const LIVE_PREVIEW_TEXT_SCALE = 0.75;
/** The parts of Obsidian's internal (undocumented) markdown editor component this plugin touches. */
interface LivePreviewEditor extends Component {
	editor?: Editor;
	cm?: { state?: { doc?: { toString(): string } } };
	set(text: string, clear?: boolean): void;
}
type LivePreviewEditorClass = new (app: App, containerEl: HTMLElement, owner: MarkdownFileInfo) => LivePreviewEditor;
/** Internal embed created by app.embedRegistry for a markdown file (undocumented API). */
interface InternalMarkdownEmbed {
	editable: boolean;
	editMode?: object | null;
	load(): void;
	unload(): void;
	showEditor(): void;
}
interface InternalEmbedRegistry {
	embedByExtension?: {
		md?: (ctx: { app: App; containerEl: HTMLElement; state: Record<string, unknown> }, file: TFile | null, subpath: string) => InternalMarkdownEmbed | null | undefined;
	};
}
/** undefined = not looked up yet; null = unavailable in this Obsidian version (use the raw editor). */
let livePreviewEditorClass: LivePreviewEditorClass | null | undefined;

function resolveLivePreviewEditorClass(app: App): LivePreviewEditorClass | null {
	if (livePreviewEditorClass !== undefined) return livePreviewEditorClass;
	livePreviewEditorClass = null;
	try {
		const registry = (app as App & { embedRegistry?: InternalEmbedRegistry }).embedRegistry;
		const embed = registry?.embedByExtension?.md?.({ app, containerEl: createDiv(), state: {} }, null, "");
		if (embed) {
			embed.load();
			embed.editable = true;
			embed.showEditor();
			let ctor: unknown = null;
			if (embed.editMode) {
				const proto = Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode) as object) as { constructor?: unknown } | null;
				ctor = proto?.constructor;
			}
			embed.unload();
			if (typeof ctor === "function") livePreviewEditorClass = ctor as LivePreviewEditorClass;
		}
	} catch (err) {
		console.warn("Universe Builder: Live Preview editor unavailable (Obsidian internals changed?); using the raw markdown editor.", err);
	}
	return livePreviewEditorClass;
}

/**
 * LIVE PREVIEW EDITOR: Obsidian's own editor (formatting rendered as you type, [[link]] suggestions,
 * editor hotkeys) for the note's body, plus a raw "Properties" box above it for the frontmatter
 * YAML. It edits a copy of the text in memory: nothing is written to the file until Save.
 * When the portrait embed (`portrait`) is the first thing in the body on its own line (where the
 * plugin always puts it), that line is held back from the editor, since the card already shows
 * the portrait, and put back in front of the body on save. Every other image stays in the editor.
 * Likewise the "# Title" heading line the templates open with (right after the portrait, or first
 * in the body), which repeats the card's own title: only a line starting "# " (hash + space) at
 * that spot counts; later "# " lines and "##" headings stay in the editor.
 * Returns null if the internal editor can't be created, so the caller can fall back.
 */
function createLivePreviewEditor(
	app: App,
	parent: Component,
	anchor: HTMLElement,
	file: TFile,
	text: string,
	keys: InlineEditorKeys,
	portrait: { start: number; end: number } | null = null
): InlineEditor | null {
	const Base = resolveLivePreviewEditorClass(app);
	if (!Base) return null;

	const wrap = createDiv("wb-card-editor-wrap wb-card-editor-live");
	anchor.insertAdjacentElement("afterend", wrap);
	const fm = splitFrontmatter(text);
	let props: HTMLTextAreaElement | null = null;
	if (fm) {
		// Collapsed to start with, so the body text is what's in view; the header toggles it open.
		const toggle = wrap.createEl("button", {
			cls: "wb-card-editor-label wb-card-editor-props-toggle",
			attr: { type: "button", "aria-expanded": "false" },
		});
		setIcon(toggle.createSpan({ cls: "wb-card-editor-props-chevron" }), "chevron-right");
		toggle.createSpan({ text: "Properties" });
		const count = fm.yaml.split(/\r?\n/).filter((line) => /^[^\s#-][^:]*:/.test(line)).length;
		if (count) toggle.createSpan({ cls: "wb-card-editor-props-count", text: `(${count})` });
		const box = createAutoTextarea(wrap, "wb-card-editor wb-card-editor-props", fm.yaml, `Properties of ${file.basename}`, keys);
		box.hide();
		props = box;
		toggle.onclick = () => {
			const open = !box.isShown();
			box.toggle(open);
			toggle.setAttribute("aria-expanded", String(open));
			toggle.toggleClass("is-open", open);
			// Size it now that it's visible (a hidden textarea has no scroll height).
			if (open) box.dispatchEvent(new Event("input"));
		};
	}
	const host = wrap.createDiv("wb-card-editor-body");
	// Draw the editor's text 25% smaller than the main editor (the raw fallback keeps its own size).
	// Everything in the editor, headings included, scales from --font-text-size.
	const baseSize = parseFloat(getComputedStyle(host).getPropertyValue("--font-text-size")) || 16;
	host.style.setProperty("--font-text-size", `${baseSize * LIVE_PREVIEW_TEXT_SCALE}px`);

	let cmp: LivePreviewEditor | null = null;
	// Stand-in for the MarkdownView the editor normally lives in (same shape Kanban uses).
	const owner: MarkdownFileInfo & Record<string, unknown> & { editMode: LivePreviewEditor | null } = {
		app,
		hoverPopover: null,
		showSearch: () => {},
		toggleMode: () => {},
		onMarkdownScroll: () => {},
		getMode: () => "source",
		scroll: 0,
		editMode: null,
		get editor() { return cmp?.editor; },
		get file() { return file; },
		get path() { return file.path; },
	};
	// Hide line numbers and fold arrows in the narrow sidebar, whatever the vault's editor settings are.
	const vaultProxy = new Proxy(app.vault, {
		get(target, prop, receiver) {
			if (prop === "config") {
				const config = (target as Vault & { config?: Record<string, unknown> }).config ?? {};
				return new Proxy(config, {
					get(cfg, key, r) {
						if (key === "showLineNumber" || key === "foldHeading" || key === "foldIndent") return false;
						return Reflect.get(cfg, key, r) as unknown;
					},
				});
			}
			return Reflect.get(target, prop, receiver) as unknown;
		},
	});
	const appProxy = new Proxy(app, {
		get(target, prop, receiver) {
			return prop === "vault" ? vaultProxy : (Reflect.get(target, prop, receiver) as unknown);
		},
	});

	const fullBody = fm ? fm.body : text;
	// The portrait's line and the "# Title" line, kept out of the editor (see above); "" when neither is at the top.
	let lead = "";
	const bodyOffset = text.length - fullBody.length;
	if (portrait && portrait.start >= bodyOffset) {
		const start = portrait.start - bodyOffset;
		const end = portrait.end - bodyOffset;
		// The rest of its line plus any blank lines after it, so the editor opens on the title.
		const lineEnd = fullBody.slice(end).match(/^[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/);
		if (!fullBody.slice(0, start).trim() && lineEnd) lead = fullBody.slice(0, end + lineEnd[0].length);
	}
	// The title heading next, with any blank lines around it, so the editor opens on the first section.
	const heading = fullBody.slice(lead.length).match(/^(?:[ \t]*\r?\n)*# [^\r\n]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/);
	if (heading) lead += heading[0];
	const bodyText = fullBody.slice(lead.length);
	let initialBody = bodyText;
	try {
		class SidebarMarkdownEditor extends Base {
			// The stock editor pads the bottom so the last line can scroll to mid-screen; not wanted in a card.
			updateBottomPadding() {}
		}
		const editor = new SidebarMarkdownEditor(appProxy, host, owner);
		cmp = editor;
		parent.addChild(editor);
		owner.editMode = editor;
		editor.set(bodyText);
		initialBody = getBodyValue(); // the editor may normalise line endings; compare against what it holds
	} catch (err) {
		console.warn("Universe Builder: couldn't create the Live Preview editor; using the raw markdown editor.", err);
		try { if (cmp) parent.removeChild(cmp); } catch { /* ignore */ }
		wrap.remove();
		return null;
	}

	function getBodyValue(): string {
		return cmp?.editor?.getValue?.() ?? cmp?.cm?.state?.doc?.toString?.() ?? bodyText;
	}

	// Save / Cancel keys while the editor has focus. A Scope takes priority over Obsidian's own
	// hotkeys (e.g. Mod+Enter would otherwise "open link in new tab").
	const scope = new Scope(app.scope);
	scope.register(["Mod"], "s", () => { keys.save(); return false; });
	scope.register(["Mod"], "Enter", () => { keys.save(); return false; });
	scope.register([], "Escape", () => { keys.cancel(); return false; });
	let scopePushed = false;
	const popScope = () => {
		if (scopePushed) app.keymap.popScope(scope);
		scopePushed = false;
	};
	host.addEventListener("focusin", () => {
		if (!scopePushed) { app.keymap.pushScope(scope); scopePushed = true; }
		// Lets editor commands and hotkeys (bold, toggle checklist, ...) act on this editor.
		app.workspace.activeEditor = owner;
	});
	host.addEventListener("focusout", (e) => {
		if (!host.contains(e.relatedTarget as Node | null)) popScope();
	});

	const bodyChanged = () => getBodyValue() !== initialBody;
	const propsChanged = () => !!fm && !!props && props.value !== fm.yaml;
	let destroyed = false;
	return {
		getText: () => {
			if (!bodyChanged() && !propsChanged()) return text;
			const newBody = lead + (bodyChanged() ? getBodyValue() : bodyText);
			if (!fm || !props) return newBody;
			// Emptying the Properties box removes the frontmatter block entirely.
			if (!props.value.trim()) return newBody;
			return fm.open + props.value + fm.close + newBody;
		},
		isDirty: () => bodyChanged() || propsChanged(),
		focus: () => {
			try { cmp?.editor?.focus?.(); } catch { /* ignore */ }
			host.scrollTop = 0;
		},
		destroy: () => {
			if (destroyed) return;
			destroyed = true;
			popScope();
			if (app.workspace.activeEditor === owner) app.workspace.activeEditor = null;
			try { if (cmp) parent.removeChild(cmp); } catch { /* ignore */ }
			wrap.remove();
		},
	};
}

// ─── Modals ──────────────────────────────────────────────────────────────────

/** Small yes/no dialog (used to guard unsaved inline edits). Resolves true only if the action button is clicked. */
function confirmModal(app: App, title: string, message: string, actionLabel: string): Promise<boolean> {
	return new Promise((resolve) => {
		let result = false;
		const modal = new Modal(app);
		modal.titleEl.setText(title);
		modal.contentEl.createEl("p", { text: message });
		const buttons = modal.contentEl.createDiv("wb-confirm-buttons");
		const cancelBtn = buttons.createEl("button", { text: "Cancel", cls: "wb-btn-secondary", attr: { type: "button" } });
		cancelBtn.onclick = () => modal.close();
		const okBtn = buttons.createEl("button", { text: actionLabel, cls: "wb-btn-primary", attr: { type: "button" } });
		okBtn.onclick = () => { result = true; modal.close(); };
		modal.onClose = () => resolve(result);
		modal.open();
		cancelBtn.focus();
	});
}

/**
 * The portrait drop area at the top of every New entry form, and above the inline editor of an
 * expanded entry that has no portrait yet. An image dragged onto it (from outside Obsidian or from
 * its file list), or picked by clicking it (the only way on mobile), is previewed straight away;
 * it's imported into `<Universe folder>/Images/<Section>` only when the entry is created or saved,
 * so cancelling leaves nothing behind in the vault. The embed goes at the very top of the note
 * (right after its properties), which makes it the entry's portrait.
 */
class PortraitPicker {
	private image: DroppedImage | null = null;
	private objectUrl: string | null = null;
	private zone: HTMLElement;
	private previewImg: HTMLImageElement;
	private nameEl: HTMLElement;

	/**
	 * `sectionFolder` is the folder the note is (or will be) in, e.g. "UniverseBuilder/Lore"; it only
	 * sets which Images subfolder the hint names. `dropGuard` (a modal) also swallows files let go
	 * anywhere else inside it.
	 */
	constructor(
		private app: App,
		private plugin: UniverseBuilderPlugin,
		parent: HTMLElement,
		sectionFolder: string,
		dropGuard?: HTMLElement
	) {
		const folder = portraitFolderFor(plugin.settings.worldFolder, `${sectionFolder}/_.md`);
		this.zone = parent.createDiv({
			cls: "wb-portrait-drop",
			attr: { role: "button", tabindex: "0", "aria-label": "Portrait: drop an image here, or press Enter to choose one" },
		});
		const preview = this.zone.createDiv("wb-portrait-drop-preview");
		this.previewImg = preview.createEl("img", { attr: { alt: "", draggable: "false" } });
		setIcon(preview.createDiv("wb-portrait-drop-icon"), "image-plus");

		const text = this.zone.createDiv("wb-portrait-drop-text");
		text.createDiv({ cls: "wb-portrait-drop-title", text: "Drag and drop an image here to import it into the vault" });
		this.nameEl = text.createDiv({ cls: "wb-portrait-drop-name" });
		text.createDiv({ cls: "wb-portrait-drop-hint", text: `Or click to choose a file. It becomes the entry's portrait and is saved to ${folder}/.` });

		const removeBtn = this.zone.createEl("button", {
			cls: "wb-portrait-drop-remove clickable-icon",
			attr: { type: "button", "aria-label": "Remove image" },
		});
		setIcon(removeBtn, "x");
		removeBtn.onclick = (e) => { e.stopPropagation(); this.set(null); };

		// Kept outside the zone so its own click event doesn't bubble back into the zone's click handler.
		const input = parent.createEl("input", {
			cls: "wb-portrait-drop-input",
			attr: { type: "file", accept: "image/*,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.avif", tabindex: "-1" },
		});
		input.onchange = () => {
			const picked = imageFromFiles(this.app, Array.from(input.files ?? []));
			if (picked) this.set(picked);
			input.value = "";
		};
		this.zone.onclick = () => input.click();
		this.zone.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
		};

		const clear = () => this.zone.removeClass("is-dragover");
		this.zone.addEventListener("dragenter", (e) => {
			if (!isImageDrag(this.app, e)) return;
			e.preventDefault();
			this.zone.addClass("is-dragover");
		});
		this.zone.addEventListener("dragover", (e) => {
			if (!isImageDrag(this.app, e)) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
			this.zone.addClass("is-dragover");
		});
		this.zone.addEventListener("dragleave", (e) => {
			if (!this.zone.contains(e.relatedTarget as Node | null)) clear();
		});
		this.zone.addEventListener("drop", (e) => {
			clear();
			if (!isImageDrag(this.app, e)) return;
			e.preventDefault();
			e.stopPropagation();
			const image = droppedImageFrom(this.app, e.dataTransfer!);
			if (image) this.set(image);
		});
		// A file let go anywhere else on the form is ignored, rather than handed to the window
		// (which could try to open it).
		dropGuard?.addEventListener("dragover", (e) => {
			if (!e.dataTransfer?.types.includes("Files") || this.zone.contains(e.target as Node)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "none";
		});
		dropGuard?.addEventListener("drop", (e) => {
			if (e.dataTransfer?.types.includes("Files") && !this.zone.contains(e.target as Node)) e.preventDefault();
		});
	}

	/** True once an image has been chosen (and not removed). */
	get hasImage(): boolean {
		return this.image !== null;
	}

	private set(image: DroppedImage | null) {
		if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
		this.image = image;
		if (!image) {
			this.previewImg.removeAttribute("src");
		} else if (image.kind === "vault") {
			this.previewImg.src = this.app.vault.getResourcePath(image.file);
		} else {
			this.objectUrl = URL.createObjectURL(image.file);
			this.previewImg.src = this.objectUrl;
		}
		this.nameEl.setText(image ? (image.kind === "vault" ? `${image.file.name} (already in the vault)` : image.file.name) : "");
		this.zone.toggleClass("has-image", !!image);
	}

	/**
	 * Called once the note exists (or its edits are saved): imports the chosen image (if it came
	 * from outside the vault) and embeds it at the top of the note. A failure here doesn't undo the
	 * note itself; `failNotice` says so. Returns true if a portrait was added.
	 */
	async attachTo(note: TFile, failNotice: string): Promise<boolean> {
		const image = this.image;
		if (!image) return false;
		try {
			const imageFile = image.kind === "vault"
				? image.file
				: await importImage(this.app, this.plugin.settings.worldFolder, image.file, note.path);
			await this.app.vault.process(note, (data) => insertAtBodyTop(data, portraitEmbed(this.app, imageFile, note.path)));
			return true;
		} catch (err) {
			console.error("Universe Builder: importing portrait failed", err);
			new Notice(failNotice);
			return false;
		}
	}

	/** Removes the drop area from the page and releases the preview's temporary URL. */
	remove() {
		this.destroy();
		this.zone.remove();
	}

	/** Releases the preview's temporary URL (call from the modal's onClose). */
	destroy() {
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
	}
}

class CharacterModal extends Modal {
	plugin: UniverseBuilderPlugin;
	onDone: () => void;
	portrait: PortraitPicker | null = null;
	data = {
		name: "", role: "protagonist", age: "", group: "", ship: "", home: "",
		physicalDesc: "", personality: "", goals: ""
	};

	constructor(app: App, plugin: UniverseBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Character" });
		this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Characters`, this.modalEl);

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Character name").onChange((v) => (this.data.name = v));
		});
		new Setting(contentEl).setName("Role").addDropdown((d) => {
			["protagonist", "antagonist", "supporting", "minor"].forEach((o) => {
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
			});
			d.setValue(this.data.role);
			d.onChange((v) => (this.data.role = v));
		});
		new Setting(contentEl).setName("Age").addText((t) => {
			t.setPlaceholder("e.g. 34").onChange((v) => (this.data.age = v));
		});
		new Setting(contentEl).setName("Group").addText((t) => {
			t.setPlaceholder("Group name").onChange((v) => (this.data.group = v));
		});
		new Setting(contentEl).setName("Ship").addText((t) => {
			t.setPlaceholder("Ship name").onChange((v) => (this.data.ship = v));
		});
		new Setting(contentEl).setName("Home").addText((t) => {
			t.setPlaceholder("Home name").onChange((v) => (this.data.home = v));
		});
		new Setting(contentEl).setName("Physical Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.physicalDesc = v));
		});
		new Setting(contentEl).setName("Personality").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.personality = v));
		});
		new Setting(contentEl).setName("Goals").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.goals = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => void this.submit())
		);
	}

	async submit() {
		if (!this.data.name.trim()) { new Notice("Name is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Characters`;
		// Character note sections, in order. Text entered in the form goes under its heading;
		// the rest are left as empty headings to fill in later.
		const sections: [string, string][] = [
			["Origin", ""],
			["Physical Description", this.data.physicalDesc],
			["Occupation", ""],
			["Resume", ""],
			["Role In Story", ""],
			["Goals", this.data.goals],
			["Personality", this.data.personality],
			["Habits/Mannerisms", ""],
			["Earlier Life", ""],
			["Internal Conflicts", ""],
			["External Conflicts", ""],
		];
		const sectionLines: string[] = [];
		for (const [heading, text] of sections) {
			sectionLines.push(`## ${heading}`);
			if (text) sectionLines.push(text);
			sectionLines.push("");
		}
		const content = [
			"---",
			`name: "${this.data.name}"`,
			`role: ${this.data.role}`,
			`age: "${this.data.age}"`,
			`group: "${this.data.group}"`,
			`ship: "${this.data.ship}"`,
			`home: "${this.data.home}"`,
			`type: character`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			...sectionLines,
		].join("\n");
		const file = await createNote(this.app, folder, this.data.name, content);
		await this.portrait?.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`);
		new Notice(`Character "${this.data.name}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() {
		this.portrait?.destroy();
		this.contentEl.empty();
	}
}

class LocationModal extends Modal {
	plugin: UniverseBuilderPlugin;
	onDone: () => void;
	portrait: PortraitPicker | null = null;
	data = {
		name: "", type: "planet", parent: "", description: "",
		inhabitants: "", secrets: ""
	};

	constructor(app: App, plugin: UniverseBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Location" });
		this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Locations`, this.modalEl);

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Location name").onChange((v) => (this.data.name = v));
		});
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			["planet", "dwarf planet", "moon", "station", "asteroid", "belt", "ship", "city", "region", "building", "landmark", "other"].forEach((o) => {
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
			});
			d.setValue(this.data.type);
			d.onChange((v) => (this.data.type = v));
		});
		new Setting(contentEl).setName("Parent Location").addText((t) => {
			t.setPlaceholder("e.g. The Northern Kingdom").onChange((v) => (this.data.parent = v));
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.description = v));
		});
		new Setting(contentEl).setName("Who Lives Here").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.inhabitants = v));
		});
		new Setting(contentEl).setName("Secrets").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.secrets = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => void this.submit())
		);
	}

	async submit() {
		if (!this.data.name.trim()) { new Notice("Name is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Locations`;
		const parentLink = this.data.parent ? `[[${this.data.parent}]]` : "";
		const content = [
			"---",
			`name: "${this.data.name}"`,
			`type: ${this.data.type}`,
			`parent: "${this.data.parent}"`,
			`entry_type: location`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			...(parentLink ? [`**Part of:** ${parentLink}`, ""] : []),
			"## Description",
			this.data.description || "_None provided._",
			"",
			"## Who Lives Here",
			this.data.inhabitants || "_None provided._",
			"",
			"## Secrets",
			this.data.secrets || "_None provided._",
		].join("\n");
		const file = await createNote(this.app, folder, this.data.name, content);
		await this.portrait?.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`);
		new Notice(`Location "${this.data.name}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() {
		this.portrait?.destroy();
		this.contentEl.empty();
	}
}

class GroupModal extends Modal {
	plugin: UniverseBuilderPlugin;
	onDone: () => void;
	portrait: PortraitPicker | null = null;
	data = {
		name: "", type: "corporation", subsidiaryOf: "", alignment: "neutral", goals: "", enemies: "", allies: "", description: ""
	};

	constructor(app: App, plugin: UniverseBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Group" });
		this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Groups`, this.modalEl);

		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Group name").onChange((v) => (this.data.name = v));
		});
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			GROUP_TYPES.forEach(({ key, label }) => { d.addOption(key, label); });
			d.setValue(this.data.type);
			d.onChange((v) => (this.data.type = v));
		});
		// Existing groups (by their `name` property, else the file name), alphabetically.
		const folder = `${this.plugin.settings.worldFolder}/Groups`;
		const existing = Array.from(new Set(
			getMarkdownFilesIn(this.app, folder)
				.map((f) => {
					const name: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter?.name;
					return (typeof name === "string" && name.trim()) ? name.trim() : f.basename;
				})
		)).sort((a, b) => a.localeCompare(b));
		new Setting(contentEl)
			.setName("Subsidiary of")
			.setDesc("Nests this group under its parent's Subsidiaries label instead of its Type section.")
			.addDropdown((d) => {
				d.addOption("", "None");
				existing.forEach((n) => { d.addOption(n, n); });
				d.setValue(this.data.subsidiaryOf);
				d.onChange((v) => (this.data.subsidiaryOf = v));
			});
		new Setting(contentEl).setName("Alignment").addDropdown((d) => {
			["lawful", "neutral", "chaotic"].forEach((o) => {
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
			});
			d.setValue(this.data.alignment);
			d.onChange((v) => (this.data.alignment = v));
		});
		new Setting(contentEl).setName("Goals").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.goals = v));
		});
		new Setting(contentEl).setName("Enemies").addText((t) => {
			t.setPlaceholder("Comma-separated").onChange((v) => (this.data.enemies = v));
		});
		new Setting(contentEl).setName("Allies").addText((t) => {
			t.setPlaceholder("Comma-separated").onChange((v) => (this.data.allies = v));
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.description = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => void this.submit())
		);
	}

	async submit() {
		if (!this.data.name.trim()) { new Notice("Name is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Groups`;
		const enemyLinks = this.data.enemies.split(",").filter(Boolean).map((e) => `[[${e.trim()}]]`).join(", ");
		const allyLinks = this.data.allies.split(",").filter(Boolean).map((a) => `[[${a.trim()}]]`).join(", ");
		const lines = [
			"---",
			`name: "${this.data.name}"`,
			`type: ${this.data.type}`,
			`${SUBSIDIARY_OF}: "${this.data.subsidiaryOf.replace(/"/g, "'")}"`,
			`alignment: ${this.data.alignment}`,
			`goals: "${this.data.goals.replace(/"/g, "'")}"`,
			`entry_type: group`,
			"---",
			"",
			`# ${this.data.name}`,
			"",
			`**Type:** ${GROUP_TYPES.find((t) => t.key === this.data.type)?.label ?? this.data.type}`,
			...(this.data.subsidiaryOf ? [`**Subsidiary of:** [[${this.data.subsidiaryOf}]]`] : []),
			`**Alignment:** ${this.data.alignment}`,
		];
		if (enemyLinks) lines.push(`**Enemies:** ${enemyLinks}`);
		if (allyLinks) lines.push(`**Allies:** ${allyLinks}`);
		lines.push("", "## Goals", this.data.goals || "_None provided._", "", "## Description", this.data.description || "_None provided._");
		const file = await createNote(this.app, folder, this.data.name, lines.join("\n"));
		await this.portrait?.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`);
		new Notice(`Group "${this.data.name}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() {
		this.portrait?.destroy();
		this.contentEl.empty();
	}
}

class LoreModal extends Modal {
	plugin: UniverseBuilderPlugin;
	onDone: () => void;
	portrait: PortraitPicker | null = null;
	data = { title: "", category: "history", content: "" };

	constructor(app: App, plugin: UniverseBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Lore Entry" });
		this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Lore`, this.modalEl);

		new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Entry title").onChange((v) => (this.data.title = v));
		});
		new Setting(contentEl).setName("Category").addDropdown((d) => {
			["history", "tech", "religion", "culture", "other"].forEach((o) => {
				d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
			});
			d.setValue(this.data.category);
			d.onChange((v) => (this.data.category = v));
		});
		new Setting(contentEl).setName("Content").addTextArea((t) => {
			t.inputEl.addClasses(["wb-textarea", "wb-textarea-tall"]);
			t.onChange((v) => (this.data.content = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => void this.submit())
		);
	}

	async submit() {
		if (!this.data.title.trim()) { new Notice("Title is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Lore`;
		const content = [
			"---",
			`title: "${this.data.title}"`,
			`category: ${this.data.category}`,
			`entry_type: lore`,
			"---",
			"",
			`# ${this.data.title}`,
			"",
			`*Category: ${this.data.category}*`,
			"",
			this.data.content || "_No content yet._",
		].join("\n");
		const file = await createNote(this.app, folder, this.data.title, content);
		await this.portrait?.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`);
		new Notice(`Lore entry "${this.data.title}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() {
		this.portrait?.destroy();
		this.contentEl.empty();
	}
}

class TimelineModal extends Modal {
	plugin: UniverseBuilderPlugin;
	onDone: () => void;
	portrait: PortraitPicker | null = null;
	data = { date: "", title: "", description: "", characters: "", locations: "" };

	constructor(app: App, plugin: UniverseBuilderPlugin, onDone: () => void) {
		super(app);
		this.plugin = plugin;
		this.onDone = onDone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h2", { text: "New Timeline Event" });
		this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Timeline`, this.modalEl);

		new Setting(contentEl).setName("Date / Era").addText((t) => {
			t.setPlaceholder("e.g. Year 342 AE").onChange((v) => (this.data.date = v));
		});
		new Setting(contentEl).setName("Title").addText((t) => {
			t.setPlaceholder("Event title").onChange((v) => (this.data.title = v));
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.inputEl.addClass("wb-textarea");
			t.onChange((v) => (this.data.description = v));
		});
		new Setting(contentEl).setName("Linked Characters").addText((t) => {
			t.setPlaceholder("Comma-separated names").onChange((v) => (this.data.characters = v));
		});
		new Setting(contentEl).setName("Linked Locations").addText((t) => {
			t.setPlaceholder("Comma-separated names").onChange((v) => (this.data.locations = v));
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => void this.submit())
		);
	}

	async submit() {
		if (!this.data.title.trim()) { new Notice("Title is required."); return; }
		const folder = `${this.plugin.settings.worldFolder}/Timeline`;
		const charLinks = this.data.characters.split(",").filter(Boolean).map((c) => `[[${c.trim()}]]`).join(", ");
		const locLinks = this.data.locations.split(",").filter(Boolean).map((l) => `[[${l.trim()}]]`).join(", ");
		const filename = this.data.date ? `${this.data.date} - ${this.data.title}` : this.data.title;
		const lines = [
			"---",
			`title: "${this.data.title}"`,
			`date: "${this.data.date}"`,
			`entry_type: timeline`,
			"---",
			"",
			`# ${this.data.title}`,
			"",
			`**Date/Era:** ${this.data.date || "_Unknown_"}`,
		];
		if (charLinks) lines.push(`**Characters:** ${charLinks}`);
		if (locLinks) lines.push(`**Locations:** ${locLinks}`);
		lines.push("", "## Description", this.data.description || "_None provided._");
		const file = await createNote(this.app, folder, filename, lines.join("\n"));
		await this.portrait?.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`);
		new Notice(`Timeline event "${this.data.title}" created.`);
		this.close();
		this.onDone();
		await this.app.workspace.getLeaf().openFile(file);
	}

	onClose() {
		this.portrait?.destroy();
		this.contentEl.empty();
	}
}

// ─── Folder migration prompt ──────────────────────────────────────────────────

/** What the user picked in the folder migration prompt. Closing it (Esc / X) counts as "ask-later". */
type MigrationChoice = "move" | "ask-later" | "decline";

interface FolderMigrationInfo {
	/** Path of the legacy folder as it exists in the vault (e.g. "World"). */
	source: string;
	/** Section folders found in it, with how many files each holds. */
	sections: { label: string; count: number }[];
	/** Whether the original World Builder plugin is installed, and if so whether it's enabled. */
	worldBuilder: "enabled" | "disabled" | null;
}

/**
 * Asks whether to move the section folders out of the legacy World folder. Resolves exactly once,
 * through `onChoose`, when the modal closes.
 */
class FolderMigrationModal extends Modal {
	private choice: MigrationChoice = "ask-later";

	constructor(app: App, private info: FolderMigrationInfo, private onChoose: (choice: MigrationChoice) => void) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		const { source, sections, worldBuilder } = this.info;
		contentEl.addClass("wb-modal", "wb-migrate-modal");
		this.setTitle("Universe Builder now has its own folder");

		const total = sections.reduce((n, s) => n + s.count, 0);
		const found = sections.map((s) => `${s.label} (${s.count})`).join(", ");
		contentEl.createEl("p", {
			text:
				`Your Universe Builder notes are in "${source}/", a folder other plugins may also use. ` +
				`Universe Builder now keeps its notes in "${DEFAULT_FOLDER}/" instead.`,
		});
		contentEl.createEl("p", {
			text:
				`Moving only covers the Characters, Groups, Locations, Lore, Timeline and ${IMAGES_SUBFOLDER} folders in "${source}/". ` +
				`Found: ${found}, ${total} file${total === 1 ? "" : "s"} in all. ` +
				`Anything else in "${source}/" stays where it is. Links between notes keep working.`,
		});
		if (worldBuilder) {
			contentEl.createEl("p", {
				cls: "wb-migrate-warning",
				text:
					`The World Builder plugin is installed in this vault (${worldBuilder}). ` +
					`After moving, it will no longer see these notes.`,
			});
		}
		contentEl.createEl("p", {
			cls: "wb-migrate-note",
			text: `Folder paths typed into other plugins or notes (for example a Dataview query on "${source}") aren't updated.`,
		});

		const buttons = contentEl.createDiv({ cls: "wb-migrate-buttons" });
		const add = (text: string, choice: MigrationChoice, cta = false) => {
			const btn = buttons.createEl("button", { text });
			if (cta) btn.addClass("mod-cta");
			btn.addEventListener("click", () => {
				this.choice = choice;
				this.close();
			});
		};
		add(`Move to ${DEFAULT_FOLDER}/ (recommended)`, "move", true);
		add(`Keep ${source}/, ask again next update`, "ask-later");
		add(`Keep ${source}/, don't ask again`, "decline");
	}

	onClose() {
		this.contentEl.empty();
		this.onChoose(this.choice);
	}
}

/**
 * Offers to delete the legacy folder once a move has left it with no files. Resolves once, through
 * `onChoose`, when the modal closes: "delete", "keep", or null if closed without choosing.
 */
class LegacyCleanupModal extends Modal {
	private choice: "delete" | "keep" | null = null;

	constructor(
		app: App,
		private folder: string,
		private emptyFolders: string[],
		private onChoose: (choice: "delete" | "keep" | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, folder, emptyFolders } = this;
		contentEl.addClass("wb-modal", "wb-migrate-modal");
		this.setTitle(`Delete the empty "${folder}" folder?`);

		contentEl.createEl("p", {
			text:
				`Your notes are now in "${DEFAULT_FOLDER}/", and "${folder}/" has no files left in it` +
				(emptyFolders.length ? ` (only empty folders: ${emptyFolders.join(", ")}).` : ".") +
				" Nothing uses it any more, so it can be deleted.",
		});
		contentEl.createEl("p", {
			cls: "wb-migrate-note",
			text: `Deleted folders go to the trash, following Obsidian's "Deleted files" setting.`,
		});

		const buttons = contentEl.createDiv({ cls: "wb-migrate-buttons" });
		const add = (text: string, choice: "delete" | "keep", cta = false) => {
			const btn = buttons.createEl("button", { text });
			if (cta) btn.addClass("mod-cta");
			btn.addEventListener("click", () => {
				this.choice = choice;
				this.close();
			});
		};
		add(`Delete ${folder}/`, "delete", true);
		add(`Keep ${folder}/`, "keep");
	}

	onClose() {
		this.contentEl.empty();
		this.onChoose(this.choice);
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class UniverseBuilderSettingTab extends PluginSettingTab {
	plugin: UniverseBuilderPlugin;
	constructor(app: App, plugin: UniverseBuilderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings (Obsidian 1.13.0+). Obsidian renders these, indexes them for settings
	 * search, and reads/writes values through getControlValue/setControlValue below. Keep this
	 * cheap: it runs on every update() and once when the tab is registered.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Universe folder",
				desc:
					"Root folder for all Universe Builder notes. Changing it doesn't move existing notes; " +
					'to move notes out of an old "World" folder, run the "Move notes out of the World folder" command.',
				aliases: ["world folder", "root", "directory", "path"],
				control: {
					type: "text",
					key: "worldFolder",
					placeholder: DEFAULT_SETTINGS.worldFolder,
					defaultValue: DEFAULT_SETTINGS.worldFolder,
				},
			},
			{
				name: "Sidebar editor",
				desc:
					"What the Edit button on an expanded entry opens. Live Preview uses Obsidian's own editor " +
					"(formatting shown as you type, [[link]] suggestions); Raw markdown is a plain text box. " +
					"If Live Preview ever stops working after an Obsidian update, the plugin falls back to Raw markdown on its own.",
				aliases: ["live preview", "raw markdown", "edit"],
				control: {
					type: "dropdown",
					key: "inlineEditor",
					options: { live: "Live Preview", raw: "Raw markdown" },
					defaultValue: DEFAULT_SETTINGS.inlineEditor,
				},
			},
		];
	}

	/**
	 * Normalises values before they are stored, preserving the rules the old imperative tab
	 * applied in its onChange handlers: an empty folder falls back to the default, and the
	 * editor choice is always "live" or "raw".
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key) {
			case "worldFolder":
				settings.worldFolder = (typeof value === "string" && value) || DEFAULT_SETTINGS.worldFolder;
				break;
			case "inlineEditor":
				settings.inlineEditor = value === "raw" ? "raw" : "live";
				break;
			default:
				return;
		}
		await this.plugin.saveSettings();
	}
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class UniverseBuilderPlugin extends Plugin {
	settings!: UniverseBuilderSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new UniverseBuilderView(leaf, this));

		this.addRibbonIcon("orbit", "Universe Builder", () => void this.activateSidebar());

		this.addCommand({
			id: "open-sidebar",
			name: "Open sidebar",
			callback: () => void this.activateSidebar(),
		});
		this.addCommand({
			id: "new-character",
			name: "New Character",
			callback: () => new CharacterModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-location",
			name: "New Location",
			callback: () => new LocationModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-group",
			name: "New Group",
			callback: () => new GroupModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-lore",
			name: "New Lore Entry",
			callback: () => new LoreModal(this.app, this, () => this.refreshSidebar()).open(),
		});
		this.addCommand({
			id: "new-timeline-event",
			name: "New Timeline Event",
			callback: () => new TimelineModal(this.app, this, () => this.refreshSidebar()).open(),
		});

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				let changed = false;
				for (const order of Object.values(this.settings.characterOrder)) {
					const i = order.indexOf(oldPath);
					if (i !== -1) { order[i] = file.path; changed = true; }
				}
				for (const order of Object.values(this.settings.sectionOrder)) {
					if (!order) continue;
					const i = order.indexOf(oldPath);
					if (i !== -1) { order[i] = file.path; changed = true; }
				}
				const parent = this.settings.collapsedParents.indexOf(oldPath);
				if (parent !== -1) { this.settings.collapsedParents[parent] = file.path; changed = true; }
				const sub = this.settings.collapsedSubsidiaries.indexOf(oldPath);
				if (sub !== -1) { this.settings.collapsedSubsidiaries[sub] = file.path; changed = true; }
				const b = this.settings.bookmarks.indexOf(oldPath);
				if (b !== -1) { this.settings.bookmarks[b] = file.path; changed = true; }
				if (changed) await this.saveSettings();
			})
		);
		// A deleted note's bookmark goes with it.
		this.registerEvent(
			this.app.vault.on("delete", async (file) => {
				if (!this.settings.bookmarks.includes(file.path)) return;
				this.settings.bookmarks = this.settings.bookmarks.filter((p) => p !== file.path);
				await this.saveSettings();
			})
		);

		this.addSettingTab(new UniverseBuilderSettingTab(this.app, this));

		this.addCommand({
			id: "move-world-folder",
			name: "Move notes out of the World folder",
			callback: () => void this.checkFolderMigration(true),
		});
		// The vault's file tree isn't fully indexed until layout is ready.
		this.app.workspace.onLayoutReady(() => void this.checkFolderMigration());
	}

	// ─── Folder migration (World/ -> UniverseBuilder/) ───────────────────────────

	/** Set while the prompt is open or a move is running, so the check never runs twice at once. */
	private migrationBusy = false;

	/**
	 * Offers to move the section folders out of the legacy World folder. Runs once per plugin
	 * update until settled (moved, declined, or nothing to move). `manual` (the command) ignores
	 * the recorded state and always re-checks.
	 */
	async checkFolderMigration(manual = false) {
		if (this.migrationBusy) return;
		const state = this.settings.folderMigration;
		// Moved earlier but the empty World/ question was never answered (dialog closed): ask again.
		const cleanupPending = !manual && state.status === "moved" && !state.legacyCleanup;
		if (!manual && !cleanupPending && (state.status || state.askedInVersion === this.manifest.version)) return;

		this.migrationBusy = true;
		try {
			if (cleanupPending) {
				await this.offerLegacyCleanup();
				return;
			}

			const current = this.settings.worldFolder.toLowerCase();
			if (current !== LEGACY_FOLDER.toLowerCase() && current !== DEFAULT_FOLDER.toLowerCase()) {
				// A custom folder is the user's own choice; leave it alone.
				if (manual) {
					new Notice(`Universe Builder uses the custom folder "${this.settings.worldFolder}", so there's nothing to move.`);
				} else {
					state.status = "not-needed";
					await this.saveSettings();
				}
				return;
			}

			const legacy = this.findLegacyFolder();
			const sections = legacy ? this.legacySections(legacy) : [];
			// World/Images alone isn't a reason to prompt: it only moves along with notes, since a vault
			// shared with the original World Builder may keep its own images there.
			if (!legacy || !sections.some((sec) => sec.label !== IMAGES_SUBFOLDER)) {
				if (manual && state.status === "moved" && legacy && !this.hasFiles(legacy)) {
					// Already moved, and World/ is still sitting there empty: offer to delete it again.
					await this.offerLegacyCleanup();
					return;
				}
				if (manual) new Notice(`There are no Universe Builder notes in "${LEGACY_FOLDER}/" to move.`);
				// An install that was using an empty World/ switches to the new default.
				if (current === LEGACY_FOLDER.toLowerCase()) this.settings.worldFolder = DEFAULT_FOLDER;
				if (!state.status) state.status = "not-needed";
				await this.saveSettings();
				this.refreshSidebar();
				return;
			}

			const info: FolderMigrationInfo = {
				source: legacy.path,
				sections: sections.map((s) => ({ label: s.label, count: s.files.length })),
				worldBuilder: await this.detectWorldBuilder(),
			};
			const choice = await new Promise<MigrationChoice>((resolve) => {
				new FolderMigrationModal(this.app, info, resolve).open();
			});

			if (choice === "move") {
				await this.moveLegacyFolder();
			} else {
				this.settings.worldFolder = legacy.path;
				if (choice === "decline") {
					state.status = "declined";
				} else {
					delete state.status;
					state.askedInVersion = this.manifest.version;
				}
				await this.saveSettings();
				this.refreshSidebar();
			}
		} catch (e) {
			console.error("Universe Builder: folder migration check failed", e);
		} finally {
			this.migrationBusy = false;
		}
	}

	/** The top-level legacy folder, matched case-insensitively (e.g. "World" or "world"). */
	private findLegacyFolder(): TFolder | null {
		for (const child of this.app.vault.getRoot().children) {
			if (child instanceof TFolder && child.name.toLowerCase() === LEGACY_FOLDER.toLowerCase()) return child;
		}
		return null;
	}

	/**
	 * The folders the migration moves (see migratedFolderNames) that exist inside `root` and hold
	 * at least one file (any type), with those files.
	 */
	private legacySections(root: TFolder): { label: string; folder: TFolder; files: TFile[] }[] {
		const out: { label: string; folder: TFolder; files: TFile[] }[] = [];
		for (const label of migratedFolderNames()) {
			const folder = root.children.find(
				(c): c is TFolder => c instanceof TFolder && c.name.toLowerCase() === label.toLowerCase()
			);
			if (!folder) continue;
			const files: TFile[] = [];
			Vault.recurseChildren(folder, (f) => {
				if (f instanceof TFile) files.push(f);
			});
			if (files.length) out.push({ label, folder, files });
		}
		return out;
	}

	/**
	 * Whether the original World Builder plugin is installed, using only public API: its manifest
	 * in the plugins folder means installed, its id in community-plugins.json means enabled.
	 * Returns null when it isn't installed or the check fails (the prompt then just omits the warning).
	 */
	private async detectWorldBuilder(): Promise<"enabled" | "disabled" | null> {
		try {
			const { adapter, configDir } = this.app.vault;
			if (!(await adapter.exists(`${configDir}/plugins/${WORLD_BUILDER_ID}/manifest.json`))) return null;
			let enabled: unknown = [];
			try {
				enabled = JSON.parse(await adapter.read(`${configDir}/community-plugins.json`));
			} catch {
				// No community-plugins.json: nothing is enabled.
			}
			return Array.isArray(enabled) && enabled.includes(WORLD_BUILDER_ID) ? "enabled" : "disabled";
		} catch {
			return null;
		}
	}

	/**
	 * Moves each migrated folder (sections and Images) from the legacy folder into DEFAULT_FOLDER. One whose
	 * destination doesn't exist yet is moved as one folder; otherwise (or if that fails) it's moved
	 * file by file, skipping any file that already exists at the destination. Nothing is ever
	 * overwritten or deleted, apart from folders left empty by the move. Obsidian's file manager
	 * does the moving, so links to the moved notes and portrait images are updated per the user's settings.
	 */
	private async moveLegacyFolder() {
		const state = this.settings.folderMigration;
		// Re-read the vault: another device's move may have synced in while the prompt was open.
		const legacy = this.findLegacyFolder();
		const sections = legacy ? this.legacySections(legacy) : [];
		const moved = new Map<string, string>();
		const skipped: string[] = [];
		const failed: string[] = [];
		const { vault, fileManager } = this.app;

		try {
			await ensureFolder(this.app, DEFAULT_FOLDER);
		} catch (e) {
			console.error(`Universe Builder: couldn't create "${DEFAULT_FOLDER}"`, e);
			new Notice(`Couldn't create the "${DEFAULT_FOLDER}" folder, so nothing was moved.`);
			return;
		}

		for (const { label, folder, files } of sections) {
			const dest = `${DEFAULT_FOLDER}/${label}`;
			const srcPrefix = folder.path;
			const targetOf = (f: TFile) => dest + f.path.slice(srcPrefix.length);

			if (!vault.getAbstractFileByPath(dest)) {
				const plan = files.map((f) => [f.path, targetOf(f)] as const);
				try {
					await fileManager.renameFile(folder, dest);
					for (const [from, to] of plan) moved.set(from, to);
					continue;
				} catch (e) {
					console.warn(`Universe Builder: moving "${srcPrefix}" as a folder failed, moving file by file`, e);
				}
			}

			for (const file of files) {
				const target = targetOf(file);
				if (vault.getAbstractFileByPath(target)) {
					skipped.push(file.path);
					continue;
				}
				const from = file.path;
				try {
					await ensureFolder(this.app, target.slice(0, target.lastIndexOf("/")));
					await fileManager.renameFile(file, target);
					moved.set(from, target);
				} catch (e) {
					console.error(`Universe Builder: couldn't move "${from}"`, e);
					failed.push(from);
				}
			}
			await this.removeEmptyFolders(folder);
		}

		// Whatever else World/ still holds is listed; if it holds no files at all, deleting it is offered below.
		const leftovers = legacy && this.hasFiles(legacy) ? legacy.children.map((c) => c.name) : [];

		this.remapPaths(moved);
		if (moved.size || !failed.length) this.settings.worldFolder = DEFAULT_FOLDER;
		if (failed.length) {
			// Leave the migration unsettled so the prompt comes back on the next launch.
			delete state.status;
			delete state.askedInVersion;
		} else {
			state.status = "moved";
			delete state.askedInVersion;
		}
		await this.saveSettings();
		this.refreshSidebar();

		const lines = [`Moved ${moved.size} file${moved.size === 1 ? "" : "s"} to "${DEFAULT_FOLDER}/".`];
		if (skipped.length) {
			lines.push(`${skipped.length} skipped because a file with the same name was already there: ${skipped.join(", ")}.`);
		}
		if (failed.length) {
			lines.push(`${failed.length} couldn't be moved (see the developer console); you'll be asked again next launch: ${failed.join(", ")}.`);
		}
		if (leftovers.length && legacy) lines.push(`Left in "${legacy.path}/": ${leftovers.join(", ")}.`);
		// Keep a problem report on screen until clicked; a clean move fades normally.
		new Notice(lines.join("\n"), skipped.length || failed.length ? 0 : 8000);

		if (!failed.length) await this.offerLegacyCleanup();
	}

	/** True when `folder` or any folder inside it holds at least one file. */
	private hasFiles(folder: TFolder): boolean {
		let found = false;
		Vault.recurseChildren(folder, (f) => {
			if (f instanceof TFile) found = true;
		});
		return found;
	}

	/**
	 * After a move, offers to delete the legacy World folder when it holds no files (empty
	 * subfolders don't count), since nothing uses it any more. A vault shared with the original
	 * World Builder keeps its World/Factions notes, so it never qualifies. "Delete" sends the
	 * folder to the trash per Obsidian's "Deleted files" setting. The answer is recorded;
	 * closing the dialog leaves it unanswered, so it's offered again on the next launch.
	 */
	private async offerLegacyCleanup() {
		const legacy = this.findLegacyFolder();
		if (!legacy || this.hasFiles(legacy)) return;

		const emptyFolders: string[] = [];
		Vault.recurseChildren(legacy, (f) => {
			if (f instanceof TFolder && f !== legacy) emptyFolders.push(f.path.slice(legacy.path.length + 1));
		});
		const choice = await new Promise<"delete" | "keep" | null>((resolve) => {
			new LegacyCleanupModal(this.app, legacy.path, emptyFolders, resolve).open();
		});
		if (!choice) return;

		const state = this.settings.folderMigration;
		if (choice === "keep") {
			state.legacyCleanup = "kept";
		} else {
			// Re-check: a file may have synced in while the dialog was open.
			const current = this.findLegacyFolder();
			if (current && this.hasFiles(current)) {
				new Notice(`"${current.path}/" has files in it again, so it wasn't deleted.`);
				return;
			}
			try {
				if (current) await this.app.fileManager.trashFile(current);
				state.legacyCleanup = "deleted";
				new Notice(`Deleted the empty "${legacy.path}/" folder.`);
			} catch (e) {
				console.error(`Universe Builder: couldn't delete "${legacy.path}"`, e);
				new Notice(`Couldn't delete "${legacy.path}/" (see the developer console).`);
				return;
			}
		}
		await this.saveSettings();
	}

	/** Deletes `folder` and any subfolders that hold no files, deepest first. */
	private async removeEmptyFolders(folder: TFolder) {
		for (const child of [...folder.children]) {
			if (child instanceof TFolder) await this.removeEmptyFolders(child);
		}
		if (folder.children.length === 0) {
			try {
				await this.app.fileManager.trashFile(folder);
			} catch (e) {
				console.warn(`Universe Builder: couldn't remove the empty "${folder.path}" folder`, e);
			}
		}
	}

	/** Points every note path stored in settings at its new location after a move. */
	private remapPaths(moved: Map<string, string>) {
		if (!moved.size) return;
		const remap = (paths: string[]) => paths.map((p) => moved.get(p) ?? p);
		const s = this.settings;
		for (const key of Object.keys(s.characterOrder)) s.characterOrder[key] = remap(s.characterOrder[key]);
		for (const tab of Object.keys(s.sectionOrder) as WBTab[]) {
			const order = s.sectionOrder[tab];
			if (order) s.sectionOrder[tab] = remap(order);
		}
		s.collapsedParents = remap(s.collapsedParents);
		s.collapsedSubsidiaries = remap(s.collapsedSubsidiaries);
		s.bookmarks = remap(s.bookmarks);
	}

	async activateSidebar() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	refreshSidebar() {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (leaf?.view instanceof UniverseBuilderView) {
			void leaf.view.render();
		}
	}

	async loadSettings() {
		const data = (await this.loadData()) as StoredSettings | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.settings.characterOrder = data?.characterOrder ?? {};
		this.settings.collapsedGroups = data?.collapsedGroups ?? [];
		this.settings.collapsedGroupTypes = data?.collapsedGroupTypes ?? [];
		this.settings.collapsedParents = data?.collapsedParents ?? [];
		this.settings.collapsedSubsidiaries = data?.collapsedSubsidiaries ?? [];
		this.settings.sectionOrder = data?.sectionOrder ?? {};
		this.settings.bookmarks = data?.bookmarks ?? [];
		this.settings.collapsedBookmarkGroups = data?.collapsedBookmarkGroups ?? [];
		this.settings.folderMigration = { ...(data?.folderMigration ?? {}) };
		this.migrateLegacySettings(data);
		this.settings.inlineEditor = data?.inlineEditor === "raw" ? "raw" : "live";
	}
	/**
	 * Carries over plugin data saved before the "Employers" tab was renamed to "Groups", so
	 * collapsed sections and custom ordering survive the rename. The old keys are dropped on the
	 * next save.
	 */
	private migrateLegacySettings(data: StoredSettings | null) {
		if (!data) return;
		const legacy = this.settings as UniverseBuilderSettings & LegacySettings;
		if (!data.collapsedGroups && data.collapsedEmployers) this.settings.collapsedGroups = data.collapsedEmployers;
		if (!data.collapsedGroupTypes && data.collapsedEmployerTypes) this.settings.collapsedGroupTypes = data.collapsedEmployerTypes;
		delete legacy.collapsedEmployers;
		delete legacy.collapsedEmployerTypes;
		const order = this.settings.sectionOrder as UniverseBuilderSettings["sectionOrder"] & { employers?: string[] };
		if (order.employers && !order.groups) order.groups = order.employers;
		delete order.employers;
		this.settings.collapsedBookmarkGroups = this.settings.collapsedBookmarkGroups.map((k) => (k === "employers" ? "groups" : k));
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}
