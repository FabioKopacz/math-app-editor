import {
	type CSSProperties,
	type FC,
	type FocusEvent,
	useCallback,
	useEffect,
	useState,
} from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SIZE = 5;
const MAX_SIZE = 11;
const SYMBOLS = ["+", "-", "x", "/", "="] as const;

type Symbol = (typeof SYMBOLS)[number];

const EQ_COLORS: string[] = [
	"#f97316",
	"#6366f1",
	"#10b981",
	"#ef4444",
	"#3b82f6",
	"#a855f7",
	"#eab308",
	"#ec4899",
	"#14b8a6",
	"#f43f5e",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Grid = string[][];
type Equations = Record<string, string>;

interface ParsedCell {
	value: string;
	eqs: string[];
}

interface ExportData {
	missingNumbers: number[];
	equations: Equations;
	grid: Grid;
}

interface Selected {
	r: number;
	c: number;
}

type PanelId = "cell" | "eq" | "export";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_GRID = (rows: number, cols: number): Grid =>
	Array.from({ length: rows }, () => Array(cols).fill("B"));

function isSymbol(v: string): v is Symbol {
	return (SYMBOLS as readonly string[]).includes(v);
}

function cellBg(value: string, selected: boolean): string {
	if (selected) return "#1a1a5a";
	if (value === "B") return "#1a1a2e";
	if (isSymbol(value)) return "#2d2d44";
	return "#0f3460";
}

function cellBorder(value: string, selected: boolean): string {
	if (selected) return "1.5px solid #6366f1";
	if (value === "B") return "1px dashed #1e1e3a";
	if (isSymbol(value)) return "1px solid #2d2d4a";
	return "1.5px solid #1e4080";
}

function cellColor(value: string): string {
	if (value === "B") return "#333355";
	if (isSymbol(value)) return "#a0a0c0";
	return "#e2f0ff";
}

function parseCell(raw: string): ParsedCell {
	if (!raw || raw === "B") return { value: "B", eqs: [] };
	const [val, eqPart] = raw.split(":");
	return { value: val, eqs: eqPart ? eqPart.split("&") : [] };
}

function deriveExport(
	grid: Grid,
	equations: Equations,
	missingNumbers: number[],
): ExportData {
	const exportGrid: Grid = grid.map((row) => row.map((cell) => cell || "B"));
	return { missingNumbers, equations, grid: exportGrid };
}

// ── Random equation generator ─────────────────────────────────────────────────

interface EqDef {
	cells: Selected[]; // exactly 5 cells: A op B = result
	a: number;
	op: string;
	b: number;
	result: number;
}

function rnd(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateEquation(
	a: number,
	op: string,
	b: number,
): { a: number; op: string; b: number; result: number } {
	let result: number;
	if (op === "+") result = a + b;
	else if (op === "-") result = a - b;
	else if (op === "x") result = a * b;
	else result = a / b;
	return { a, op, b, result };
}

function pickRandomEquation(): {
	a: number;
	op: string;
	b: number;
	result: number;
} {
	const ops = ["+", "-", "x"];
	const op = ops[rnd(0, ops.length - 1)];
	let a: number, b: number, result: number;
	for (let attempt = 0; attempt < 50; attempt++) {
		a = rnd(1, 9);
		b = rnd(1, 9);
		const eq = generateEquation(a, op, b);
		result = eq.result;
		if (result > 0 && result <= 99 && Number.isInteger(result)) {
			return eq;
		}
	}
	return { a: 2, op: "+", b: 3, result: 5 };
}

type Direction = "right" | "down";

function tryPlaceEquation(
	grid: Grid,
	size: number,
	startR: number,
	startC: number,
	dir: Direction,
	eq: ReturnType<typeof pickRandomEquation>,
	sharedIdx: number | null, // index 0-4 of the shared cell (already placed)
): Selected[] | null {
	const cells: Selected[] = [];
	for (let i = 0; i < 5; i++) {
		const r = dir === "right" ? startR : startR + i;
		const c = dir === "right" ? startC + i : startC;
		if (r < 0 || r >= size || c < 0 || c >= size) return null;
		cells.push({ r, c });
	}

	const pattern = [String(eq.a), eq.op, String(eq.b), "=", String(eq.result)];

	// Check each cell: must be blank OR be the shared cell with a matching value
	for (let i = 0; i < 5; i++) {
		const { r, c } = cells[i];
		const existing = grid[r][c];
		const { value } = parseCell(existing);
		if (value === "B") continue;
		if (sharedIdx === i && value === pattern[i]) continue;
		return null; // conflict
	}

	return cells;
}

function generateRandomGrid(size: number): {
	grid: Grid;
	equations: Equations;
} {
	const targetEqs = rnd(5, 7);
	// Raw value grid (no tags, just values)
	const rawGrid: string[][] = Array.from({ length: size }, () =>
		Array(size).fill("B"),
	);
	// Cell → list of eq keys that include it
	const cellEqs: Map<string, string[]> = new Map();
	const eqDefs: EqDef[] = [];
	const equations: Equations = {};
	const dirs: Direction[] = ["right", "down"];

	function cellKey(r: number, c: number): string {
		return `${r},${c}`;
	}

	let attempts = 0;
	while (eqDefs.length < targetEqs && attempts < 2000) {
		attempts++;
		const eq = pickRandomEquation();
		const pattern = [String(eq.a), eq.op, String(eq.b), "=", String(eq.result)];
		const dir = dirs[rnd(0, 1)];

		let placed: Selected[] | null = null;
		let sharedIdx: number | null = null;

		// Try to share a cell with an already-placed equation
		if (eqDefs.length > 0 && Math.random() < 0.55) {
			const srcEq = eqDefs[rnd(0, eqDefs.length - 1)];
			const srcPattern = [
				String(srcEq.a),
				srcEq.op,
				String(srcEq.b),
				"=",
				String(srcEq.result),
			];
			const srcIdxes = [0, 2, 4].sort(() => Math.random() - 0.5);
			for (const srcIdx of srcIdxes) {
				const sharedVal = srcPattern[srcIdx];
				if (isSymbol(sharedVal as Symbol) || sharedVal === "=") continue;
				for (let newIdx = 0; newIdx < 5; newIdx++) {
					if (pattern[newIdx] !== sharedVal) continue;
					if (isSymbol(pattern[newIdx] as Symbol) || pattern[newIdx] === "=")
						continue;
					const { r: sr, c: sc } = srcEq.cells[srcIdx];
					const startR = dir === "right" ? sr : sr - newIdx;
					const startC = dir === "right" ? sc - newIdx : sc;
					const result = tryPlaceEquation(
						rawGrid,
						size,
						startR,
						startC,
						dir,
						eq,
						newIdx,
					);
					if (result) {
						placed = result;
						sharedIdx = newIdx;
						break;
					}
				}
				if (placed) break;
			}
		}

		// Random placement fallback
		if (!placed) {
			const maxStart = size - 5;
			if (maxStart < 0) continue;
			for (let t = 0; t < 30; t++) {
				const startR = dir === "right" ? rnd(0, size - 1) : rnd(0, maxStart);
				const startC = dir === "right" ? rnd(0, maxStart) : rnd(0, size - 1);
				const result = tryPlaceEquation(
					rawGrid,
					size,
					startR,
					startC,
					dir,
					eq,
					null,
				);
				if (result) {
					placed = result;
					break;
				}
			}
		}

		if (!placed) continue;

		// Write raw values to rawGrid
		for (let i = 0; i < 5; i++) {
			const { r, c } = placed[i];
			rawGrid[r][c] = pattern[i];
		}

		const eqKey = `eq${eqDefs.length + 1}`;
		const startCell = placed[0];
		const endCell = placed[4];
		equations[eqKey] =
			`2|${startCell.r},${startCell.c},${endCell.r},${endCell.c}`;

		// Tag numeric cells (indices 0, 2, 4 = a, b, result) with this equation
		for (const numIdx of [0, 2, 4]) {
			const { r, c } = placed[numIdx];
			const key = cellKey(r, c);
			const existing = cellEqs.get(key) ?? [];
			if (!existing.includes(eqKey)) existing.push(eqKey);
			cellEqs.set(key, existing);
		}

		eqDefs.push({
			cells: placed,
			a: eq.a,
			op: eq.op,
			b: eq.b,
			result: eq.result,
		});
	}

	// Build final annotated grid
	const grid: Grid = Array.from({ length: size }, (_, r) =>
		Array.from({ length: size }, (_, c) => {
			const val = rawGrid[r][c];
			if (val === "B") return "B";
			// Operators and "=" don't get eq tags
			if (isSymbol(val as Symbol) || val === "=") return val;
			const eqList = cellEqs.get(cellKey(r, c));
			if (eqList && eqList.length > 0) return `${val}:${eqList.join("&")}`;
			return val;
		}),
	);

	// After building the annotated grid, recompute counts dynamically
	// Count how many cells in the grid are tagged with each eq key
	const eqCounts: Record<string, number> = {};
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			const cell = grid[r][c];
			const { value, eqs } = parseCell(cell);
			if (value === "B" || isSymbol(value as Symbol) || value === "=") continue;
			for (const eqKey of eqs) {
				eqCounts[eqKey] = (eqCounts[eqKey] ?? 0) + 1;
			}
		}
	}

	// Update equations with correct counts
	for (const eqKey of Object.keys(equations)) {
		const coordPart = equations[eqKey].split("|")[1] ?? "";
		const count = eqCounts[eqKey] ?? 0;
		equations[eqKey] = `${count}|${coordPart}`;
	}

	return { grid, equations };
}

interface SavedGrid {
	id: string;
	name: string;
	savedAt: number;
	gridSize: number;
	grid: Grid;
	equations: Equations;
	missingNumbers: number[];
}

const LS_KEY = "mathgrid_saved";

function loadSaved(): SavedGrid[] {
	try {
		const raw = localStorage.getItem(LS_KEY);
		return raw ? (JSON.parse(raw) as SavedGrid[]) : [];
	} catch {
		return [];
	}
}

function persistSaved(list: SavedGrid[]): void {
	localStorage.setItem(LS_KEY, JSON.stringify(list));
}

// ── SavedSidebar ──────────────────────────────────────────────────────────────

interface SavedSidebarProps {
	saved: SavedGrid[];
	onLoad: (s: SavedGrid) => void;
	onDelete: (id: string) => void;
	onExportAll: () => void;
	onClearAll: () => void;
}

const SavedSidebar: FC<SavedSidebarProps> = ({
	saved,
	onLoad,
	onDelete,
	onExportAll,
	onClearAll,
}) => (
	<div
		className="saved-sidebar"
		style={{
			width: 210,
			background: "#0a0a1a",
			borderRight: "1px solid #1a1a30",
			display: "flex",
			flexDirection: "column",
			overflow: "hidden",
			flexShrink: 0,
		}}
	>
		{/* Header */}
		<div
			style={{
				padding: "14px 16px 12px",
				borderBottom: "1px solid #1a1a30",
				flexShrink: 0,
			}}
		>
			<div
				style={{
					color: "#333355",
					fontSize: 9,
					letterSpacing: 2,
					marginBottom: 3,
				}}
			>
				LIBRARY
			</div>
			<div style={{ color: "#e2f0ff", fontSize: 14, fontWeight: 700 }}>
				💾 SAVED
			</div>
		</div>

		{/* Action buttons */}
		{saved.length > 0 && (
			<div
				style={{
					padding: "8px 12px",
					borderBottom: "1px solid #1a1a30",
					display: "flex",
					gap: 6,
					flexShrink: 0,
				}}
			>
				<button
					onClick={onExportAll}
					style={{
						flex: 1,
						padding: "6px 0",
						borderRadius: 7,
						cursor: "pointer",
						background: "#6366f115",
						border: "1px solid #6366f135",
						color: "#6366f1",
						fontSize: 9,
						fontWeight: 700,
						letterSpacing: 1,
					}}
				>
					↗ EXPORT ALL
				</button>
				<button
					onClick={onClearAll}
					style={{
						padding: "6px 9px",
						borderRadius: 7,
						cursor: "pointer",
						background: "#ef444415",
						border: "1px solid #ef444435",
						color: "#ef4444",
						fontSize: 9,
						fontWeight: 700,
						letterSpacing: 1,
					}}
				>
					🗑 ALL
				</button>
			</div>
		)}

		<div
			style={{
				flex: 1,
				overflowY: "auto",
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
		>
			{saved.length === 0 && (
				<div
					style={{
						color: "#252540",
						fontSize: 10,
						textAlign: "center",
						paddingTop: 28,
						lineHeight: 2,
					}}
				>
					no grids saved yet
					<br />
					<span style={{ color: "#1e1e38", fontSize: 9 }}>
						use SAVE below the grid
					</span>
				</div>
			)}

			{saved.map((s) => {
				const d = new Date(s.savedAt);
				const dateStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
				const eqCount = Object.keys(s.equations).length;

				return (
					<div
						key={s.id}
						style={{
							background: "#0d0d1f",
							border: "1px solid #1a1a30",
							borderRadius: 10,
							overflow: "hidden",
						}}
					>
						{/* Mini grid preview */}
						<div
							style={{
								padding: "8px 10px 6px",
								display: "grid",
								gridTemplateColumns: `repeat(${s.gridSize}, 1fr)`,
								gap: 2,
							}}
						>
							{s.grid.slice(0, s.gridSize).map((row, r) =>
								row.slice(0, s.gridSize).map((cell, c) => {
									const { value } = parseCell(cell);
									const isB = value === "B";
									const isOp = isSymbol(value as Symbol) || value === "=";
									return (
										<div
											key={`${r}-${c}`}
											style={{
												width: "100%",
												aspectRatio: "1",
												borderRadius: 3,
												background: isB
													? "#111122"
													: isOp
														? "#2a2a3a"
														: "#0f3060",
												fontSize: Math.max(5, 9 - s.gridSize),
												color: isB
													? "transparent"
													: isOp
														? "#7070a0"
														: "#a0c0ff",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontWeight: 700,
											}}
										>
											{isB ? "" : value.length > 2 ? "·" : value}
										</div>
									);
								}),
							)}
						</div>

						{/* Info + actions */}
						<div style={{ padding: "4px 10px 8px" }}>
							<div
								style={{
									color: "#a0a0c0",
									fontSize: 11,
									fontWeight: 700,
									marginBottom: 1,
								}}
							>
								{s.name}
							</div>
							<div style={{ color: "#333355", fontSize: 8, marginBottom: 6 }}>
								{s.gridSize}×{s.gridSize} · {eqCount} eq · {dateStr}
							</div>
							<div style={{ display: "flex", gap: 5 }}>
								<button
									onClick={() => onLoad(s)}
									style={{
										flex: 1,
										padding: "5px 0",
										borderRadius: 6,
										cursor: "pointer",
										background: "#6366f115",
										border: "1px solid #6366f135",
										color: "#6366f1",
										fontSize: 9,
										fontWeight: 700,
										letterSpacing: 1,
									}}
								>
									LOAD
								</button>
								<button
									onClick={() => onDelete(s.id)}
									style={{
										padding: "5px 9px",
										borderRadius: 6,
										cursor: "pointer",
										background: "transparent",
										border: "1px solid #1e1e3a",
										color: "#333355",
										fontSize: 12,
									}}
								>
									×
								</button>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	</div>
);

interface CellPanelProps {
	r: number;
	c: number;
	raw: string;
	missingNumbers: number[];
	onMissingChange: (nums: number[]) => void;
	onSet: (r: number, c: number, val: string) => void;
}

const CellPanel: FC<CellPanelProps> = ({
	r,
	c,
	raw,
	missingNumbers,
	onMissingChange,
	onSet,
}) => {
	const { value: initVal, eqs: initEqs } = parseCell(raw);
	const [val, setVal] = useState<string>(initVal === "B" ? "" : initVal);
	const [eqSel, setEqSel] = useState<Set<string>>(new Set(initEqs));

	useEffect(() => {
		const { value, eqs } = parseCell(raw);
		setVal(value === "B" ? "" : value);
		setEqSel(new Set(eqs));
	}, [r, c, raw]);

	function toggleEq(k: string): void {
		setEqSel((prev) => {
			const next = new Set(prev);
			next.has(k) ? next.delete(k) : next.add(k);
			applyValue(undefined, next);
			return next;
		});
	}

	function buildCell(v: string, sel: Set<string>): string {
		const eqs = [...sel];
		return !isSymbol(v) && v !== "B" && eqs.length > 0
			? `${v}:${eqs.join("&")}`
			: v;
	}

	function applyValue(overrideVal?: string, overrideSel?: Set<string>): void {
		const v = (overrideVal ?? val).trim() || "B";
		const sel = overrideSel ?? eqSel;
		onSet(r, c, buildCell(v, sel));
	}

	function handleSymbol(s: string): void {
		setVal(s);
		setEqSel(new Set());
		onSet(r, c, s);
	}

	function handleBlank(): void {
		setVal("");
		setEqSel(new Set());
		onSet(r, c, "B");
	}

	function handleNumpadDigit(d: string): void {
		const next = val === "" || isSymbol(val) ? d : val + d;
		setVal(next);
		applyValue(next);
	}

	function handleNumpadBackspace(): void {
		const next = val.slice(0, -1);
		setVal(next);
		applyValue(next || "B");
	}

	const isSymbolVal = isSymbol(val);

	const previewRaw: string = (() => {
		const v = val.trim() || "B";
		const eqs = [...eqSel];
		if (isSymbol(v) || v === "B" || eqs.length === 0) return v;
		return `${v}:${eqs.join("&")}`;
	})();

	const label: CSSProperties = {
		color: "#333355",
		fontSize: 10,
		letterSpacing: 2,
		marginBottom: 8,
	};

	const numpadKeys: string[] = [
		"7",
		"8",
		"9",
		"4",
		"5",
		"6",
		"1",
		"2",
		"3",
		"0",
		"⌫",
	];

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "14px 18px 12px",
					borderBottom: "1px solid #1e1e3a",
					flexShrink: 0,
				}}
			>
				<div
					style={{
						color: "#333355",
						fontSize: 10,
						letterSpacing: 2,
						marginBottom: 4,
					}}
				>
					EDITING CELL
				</div>
				<div style={{ color: "#6366f1", fontSize: 20, fontWeight: 700 }}>
					[{r}, {c}]
				</div>
			</div>

			<div
				style={{
					flex: 1,
					overflowY: "auto",
					padding: "16px 18px",
					display: "flex",
					flexDirection: "column",
					gap: 18,
				}}
			>
				{/* Operators + Blank */}
				<div>
					<div style={label}>OPERADOR</div>
					<div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
						{SYMBOLS.map((s) => (
							<button
								key={s}
								onClick={() => handleSymbol(s)}
								style={{
									width: 40,
									height: 40,
									borderRadius: 8,
									cursor: "pointer",
									background: val === s ? "#6366f120" : "#16162a",
									border: `1.5px solid ${val === s ? "#6366f1" : "#222240"}`,
									color: val === s ? "#6366f1" : "#666688",
									fontSize: 16,
									fontWeight: 700,
									transition: "all .1s",
								}}
							>
								{s}
							</button>
						))}
						<button
							onClick={handleBlank}
							style={{
								width: 40,
								height: 40,
								borderRadius: 8,
								cursor: "pointer",
								background: val === "" ? "#ef444418" : "#16162a",
								border: `1.5px solid ${val === "" ? "#ef4444" : "#222240"}`,
								color: val === "" ? "#ef4444" : "#444466",
								fontSize: 10,
								fontWeight: 700,
								transition: "all .1s",
							}}
						>
							B
						</button>
					</div>
				</div>

				{/* Equation toggles — always visible eq1..eq10 */}
				<div>
					<div style={label}>EQUATIONS</div>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(5, 1fr)",
							gap: 5,
						}}
					>
						{Array.from({ length: 10 }, (_, i) => {
							const key = `eq${i + 1}`;
							const on = eqSel.has(key);
							const col = EQ_COLORS[i % EQ_COLORS.length];
							return (
								<button
									key={key}
									onClick={() => toggleEq(key)}
									style={{
										height: 34,
										borderRadius: 8,
										cursor: "pointer",
										background: on ? col + "20" : "#16162a",
										border: `1.5px solid ${on ? col : "#222240"}`,
										color: on ? col : "#333355",
										fontSize: 10,
										fontWeight: on ? 700 : 400,
										transition: "all .12s",
									}}
								>
									{key}
								</button>
							);
						})}
					</div>
				</div>

				{/* Numpad */}
				<div>
					<div style={label}>NÚMERO</div>
					{/* Display */}
					<div
						style={{
							background: "#10101f",
							border: "1px solid #1a1a30",
							borderRadius: 8,
							padding: "8px 12px",
							marginBottom: 8,
							minHeight: 36,
							fontSize: 18,
							fontWeight: 700,
							color: isSymbolVal ? "#444466" : "#e2f0ff",
							letterSpacing: 2,
							textAlign: "right",
						}}
					>
						{isSymbolVal ? "—" : val || "0"}
					</div>
					{/* Keys */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(3, 1fr)",
							gap: 5,
						}}
					>
						{numpadKeys.map((k) => {
							const isBack = k === "⌫";
							return (
								<button
									key={k}
									onClick={() =>
										isBack ? handleNumpadBackspace() : handleNumpadDigit(k)
									}
									style={{
										height: 40,
										borderRadius: 8,
										cursor: "pointer",
										background: isBack ? "#ef444418" : "#16162a",
										border: `1.5px solid ${isBack ? "#ef444440" : "#222240"}`,
										color: isBack ? "#ef4444" : "#a0a0c0",
										fontSize: isBack ? 14 : 16,
										fontWeight: 700,
										transition: "all .1s",
									}}
								>
									{k}
								</button>
							);
						})}
					</div>
				</div>

				{/* Missing Numbers */}
				<div>
					<div style={label}>MISSING NUMBERS</div>
					{/* Current list */}
					{missingNumbers.length > 0 && (
						<div
							style={{
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								marginBottom: 8,
							}}
						>
							{missingNumbers.map((n, i) => (
								<div
									key={i}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 4,
										padding: "3px 8px 3px 10px",
										borderRadius: 20,
										background: "#10b98118",
										border: "1px solid #10b98140",
										color: "#10b981",
										fontSize: 12,
										fontWeight: 700,
									}}
								>
									{n}
									<button
										onClick={() =>
											onMissingChange(missingNumbers.filter((_, j) => j !== i))
										}
										style={{
											background: "transparent",
											border: "none",
											color: "#10b98180",
											cursor: "pointer",
											fontSize: 13,
											padding: "0 2px",
											lineHeight: 1,
										}}
									>
										×
									</button>
								</div>
							))}
						</div>
					)}
					{/* Add current cell value button */}
					{!isSymbolVal && val !== "" && (
						<button
							onClick={() => {
								const n = Number(val);
								if (!isNaN(n)) onMissingChange([...missingNumbers, n]);
							}}
							style={{
								width: "100%",
								padding: "8px",
								borderRadius: 8,
								cursor: "pointer",
								background: "#10b98112",
								border: "1.5px solid #10b98135",
								color: "#10b981",
								fontSize: 11,
								fontWeight: 700,
							}}
						>
							+ ADD "{val}" TO MISSING
						</button>
					)}
					{(isSymbolVal || val === "") && (
						<div
							style={{
								padding: "8px 10px",
								borderRadius: 8,
								background: "#16162a",
								border: "1px dashed #222240",
								color: "#333355",
								fontSize: 10,
								textAlign: "center",
							}}
						>
							select a number cell to add
						</div>
					)}
				</div>

				{/* Preview */}
				<div>
					<div style={label}>PREVIEW</div>
					<div
						style={{
							background: "#10101f",
							border: "1px solid #1a1a30",
							borderRadius: 8,
							padding: "9px 13px",
							fontSize: 12,
							color: "#7090d0",
							wordBreak: "break-all",
						}}
					>
						"{previewRaw}"
					</div>
				</div>
			</div>
		</div>
	);
};

// ── EqPanel ───────────────────────────────────────────────────────────────────

interface EqPanelProps {
	equations: Equations;
	onChange: (eq: Equations) => void;
}

const EqPanel: FC<EqPanelProps> = ({ equations, onChange }) => {
	const [newKey, setNewKey] = useState<string>("");
	const [newVal, setNewVal] = useState<string>("");

	function addEq(): void {
		const k = newKey.trim();
		const v = newVal.trim();
		if (!k || !v) return;
		onChange({ ...equations, [k]: v });
		setNewKey("");
		setNewVal("");
	}

	const label: CSSProperties = {
		color: "#333355",
		fontSize: 10,
		letterSpacing: 2,
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "14px 18px 12px",
					borderBottom: "1px solid #1e1e3a",
					flexShrink: 0,
				}}
			>
				<div
					style={{
						color: "#333355",
						fontSize: 10,
						letterSpacing: 2,
						marginBottom: 4,
					}}
				>
					MANAGER
				</div>
				<div style={{ color: "#e2f0ff", fontSize: 16, fontWeight: 700 }}>
					⚡ EQUATIONS
				</div>
			</div>

			<div
				style={{
					flex: 1,
					overflowY: "auto",
					padding: "16px 18px",
					display: "flex",
					flexDirection: "column",
					gap: 7,
				}}
			>
				{Object.keys(equations).length === 0 && (
					<div
						style={{
							color: "#252540",
							fontSize: 11,
							textAlign: "center",
							paddingTop: 24,
						}}
					>
						no equations yet
					</div>
				)}

				{Object.entries(equations).map(([k, v], i) => (
					<div
						key={k}
						style={{ display: "flex", gap: 7, alignItems: "center" }}
					>
						<span
							style={{
								padding: "3px 8px",
								borderRadius: 6,
								fontSize: 10,
								background: EQ_COLORS[i % EQ_COLORS.length] + "18",
								color: EQ_COLORS[i % EQ_COLORS.length],
								border: `1px solid ${EQ_COLORS[i % EQ_COLORS.length]}35`,
								minWidth: 38,
								textAlign: "center",
								flexShrink: 0,
							}}
						>
							{k}
						</span>
						<input
							value={v}
							onChange={(e) => onChange({ ...equations, [k]: e.target.value })}
							style={{
								flex: 1,
								background: "#16162a",
								border: "1px solid #222240",
								borderRadius: 6,
								color: "#e2f0ff",
								padding: "5px 9px",
								fontSize: 11,
								outline: "none",
							}}
							onFocus={(e: FocusEvent<HTMLInputElement>) => {
								e.target.style.borderColor = EQ_COLORS[i % EQ_COLORS.length];
							}}
							onBlur={(e: FocusEvent<HTMLInputElement>) => {
								e.target.style.borderColor = "#222240";
							}}
						/>
						<button
							onClick={() => {
								const next = { ...equations };
								delete next[k];
								onChange(next);
							}}
							style={{
								background: "transparent",
								border: "1px solid #1e1e3a",
								borderRadius: 6,
								color: "#333355",
								padding: "4px 8px",
								cursor: "pointer",
								fontSize: 13,
								flexShrink: 0,
							}}
						>
							×
						</button>
					</div>
				))}

				{/* Add new */}
				<div
					style={{
						borderTop: "1px solid #1a1a30",
						paddingTop: 14,
						marginTop: 6,
						display: "flex",
						flexDirection: "column",
						gap: 8,
					}}
				>
					<div style={label}>ADD NEW</div>
					<div style={{ display: "flex", gap: 7 }}>
						<input
							placeholder="eq1"
							value={newKey}
							onChange={(e) => setNewKey(e.target.value)}
							onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
								if (e.key === "Enter") addEq();
							}}
							style={{
								width: 52,
								background: "#16162a",
								border: "1px solid #222240",
								borderRadius: 6,
								color: "#e2f0ff",
								padding: "6px 8px",
								fontSize: 11,
								outline: "none",
							}}
						/>
						<input
							placeholder="2|0,0,0,4"
							value={newVal}
							onChange={(e) => setNewVal(e.target.value)}
							onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
								if (e.key === "Enter") addEq();
							}}
							style={{
								flex: 1,
								background: "#16162a",
								border: "1px solid #222240",
								borderRadius: 6,
								color: "#e2f0ff",
								padding: "6px 9px",
								fontSize: 11,
								outline: "none",
							}}
						/>
					</div>
					<button
						onClick={addEq}
						style={{
							width: "100%",
							padding: "8px",
							borderRadius: 8,
							cursor: "pointer",
							background: "#6366f115",
							border: "1.5px solid #6366f135",
							color: "#6366f1",
							fontSize: 11,
							fontWeight: 700,
						}}
					>
						+ ADD EQUATION
					</button>
				</div>

				<div
					style={{
						background: "#10101f",
						border: "1px solid #1a1a30",
						borderRadius: 8,
						padding: "9px 12px",
						color: "#252540",
						fontSize: 9,
						lineHeight: 1.9,
					}}
				>
					FORMAT: count|r1,c1,r2,c2
					<br />
					<span style={{ color: "#6366f150" }}>2|0,0,0,4</span> → 2 vals,
					[0,0]→[0,4]
				</div>
			</div>
		</div>
	);
};

// ── ExportPanel ───────────────────────────────────────────────────────────────

interface ExportPanelProps {
	content: string;
	onCopy: () => void;
	copied: boolean;
}

const ExportPanel: FC<ExportPanelProps> = ({ content, onCopy, copied }) => (
	<div
		style={{
			display: "flex",
			flexDirection: "column",
			height: "100%",
			overflow: "hidden",
		}}
	>
		<div
			style={{
				padding: "14px 18px 12px",
				borderBottom: "1px solid #1e1e3a",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				flexShrink: 0,
			}}
		>
			<div>
				<div
					style={{
						color: "#333355",
						fontSize: 10,
						letterSpacing: 2,
						marginBottom: 4,
					}}
				>
					OUTPUT
				</div>
				<div style={{ color: "#e2f0ff", fontSize: 16, fontWeight: 700 }}>
					↗ EXPORT
				</div>
			</div>
			<button
				onClick={onCopy}
				style={{
					background: copied ? "#10b98118" : "#16162a",
					border: `1.5px solid ${copied ? "#10b98160" : "#222240"}`,
					borderRadius: 8,
					color: copied ? "#10b981" : "#666688",
					padding: "6px 13px",
					cursor: "pointer",
					fontSize: 10,
					letterSpacing: 1,
					transition: "all .2s",
				}}
			>
				{copied ? "✓ COPIED" : "⎘ COPY"}
			</button>
		</div>
		<pre
			style={{
				flex: 1,
				overflowY: "auto",
				overflowX: "auto",
				margin: 0,
				padding: "14px 18px",
				color: "#7090c0",
				fontSize: 10,
				lineHeight: 1.8,
				background: "transparent",
				whiteSpace: "pre",
				fontFamily: "monospace",
			}}
		>
			{content}
		</pre>
	</div>
);

// ── App ───────────────────────────────────────────────────────────────────────

const GridEditor: FC = () => {
	const [gridSize, setGridSize] = useState<number>(11);
	const [grid, setGrid] = useState<Grid>(() => EMPTY_GRID(11, 11));
	const [equations, setEquations] = useState<Equations>({});
	const [missingNumbers, setMissingNumbers] = useState<number[]>([]);
	const [selected, setSelected] = useState<Selected>({ r: 0, c: 0 });
	const [panel, setPanel] = useState<PanelId>("cell");
	const [exported, setExported] = useState<string>(
		"— click EXPORT to generate —",
	);
	const [copied, setCopied] = useState<boolean>(false);
	const [saved, setSaved] = useState<SavedGrid[]>(() => loadSaved());
	const [saveLabel, setSaveLabel] = useState<string>("");

	// ── Drag-to-select state ──────────────────────────────────────────────────
	const [isDragging, setIsDragging] = useState<boolean>(false);
	const [dragCells, setDragCells] = useState<Selected[]>([]);
	const [dragStartPrefilled, setDragStartPrefilled] = useState<boolean>(false);

	function applyEquationPattern(
		cells: Selected[],
		startVal: string | null,
	): void {
		// cells = all 5 dragged cells (including start if prefilled)
		// If prefilled: cell[0] keeps its value, cells[1..4] get "+ B = result"
		// If blank: cells[0..4] get "A + B = result"
		const a =
			startVal && !isSymbol(startVal) && startVal !== "B" ? startVal : "2";
		const b = "2";
		const result = String(Number(a) + Number(b));
		const pattern = startVal
			? ["+", b, "=", result] // 4 cells to fill (skip cell[0])
			: [a, "+", b, "=", result]; // 5 cells to fill

		const targets = startVal ? cells.slice(1) : cells;

		setGrid((g) => {
			const next = g.map((row) => [...row]);
			targets.forEach(({ r, c }, i) => {
				next[r][c] = pattern[i];
			});
			return next;
		});
	}

	// Track drag cells set for quick lookup
	const dragCellSet = new Set(dragCells.map(({ r, c }) => `${r},${c}`));

	// Always need 5 total cells dragged
	const dragTarget = 5;

	function handleCellMouseDown(r: number, c: number): void {
		const raw = grid[r]?.[c] ?? "B";
		const { value } = parseCell(raw);
		const prefilled = value !== "B" && !isSymbol(value) && value !== "";
		setIsDragging(true);
		setDragStartPrefilled(prefilled);
		setDragCells([{ r, c }]);
		setSelected({ r, c });
		if (panel === "export") setPanel("cell");
	}

	function handleCellMouseEnter(r: number, c: number): void {
		if (!isDragging) return;
		setDragCells((prev) => {
			if (prev.some((p) => p.r === r && p.c === c)) return prev;
			return [...prev, { r, c }];
		});
		setSelected({ r, c });
	}

	function handleMouseUp(): void {
		if (isDragging && dragCells.length === 5) {
			const startRaw = grid[dragCells[0].r]?.[dragCells[0].c] ?? "B";
			const { value: startVal } = parseCell(startRaw);
			applyEquationPattern(dragCells, dragStartPrefilled ? startVal : null);
		}
		setIsDragging(false);
		setDragCells([]);
		setDragStartPrefilled(false);
	}

	useEffect(() => {
		window.addEventListener("mouseup", handleMouseUp);
		return () => window.removeEventListener("mouseup", handleMouseUp);
	}, [isDragging, dragCells, dragStartPrefilled]);

	function handleSizeChange(newSize: number): void {
		setGridSize(newSize);
		setGrid((prev) => {
			// Resize: keep existing cells, fill new ones with "B"
			const next: Grid = Array.from({ length: newSize }, (_, r) =>
				Array.from({ length: newSize }, (_, c) =>
					prev[r] && prev[r][c] !== undefined ? prev[r][c] : "B",
				),
			);
			return next;
		});
		// Clamp selected cell to new bounds
		setSelected((prev) => ({
			r: Math.min(prev.r, newSize - 1),
			c: Math.min(prev.c, newSize - 1),
		}));
	}

	const setCell = useCallback((r: number, c: number, val: string): void => {
		setGrid((g) => {
			const next = g.map((row) => [...row]);
			next[r][c] = val;
			return next;
		});
	}, []);

	// ── Global keyboard handler ───────────────────────────────────────────────
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent): void {
			// Don't intercept if focus is inside an input/textarea
			const tag = (e.target as HTMLElement).tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;

			const { r, c } = selected;

			// Arrow navigation
			if (e.key === "ArrowRight") {
				e.preventDefault();
				setSelected({ r, c: Math.min(c + 1, gridSize - 1) });
				return;
			}
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				setSelected({ r, c: Math.max(c - 1, 0) });
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelected({ r: Math.min(r + 1, gridSize - 1), c });
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelected({ r: Math.max(r - 1, 0), c });
				return;
			}

			// Blank cell with Delete or Space
			if (e.key === "Delete" || e.key === " ") {
				e.preventDefault();
				setCell(r, c, "B");
				return;
			}

			// Operator shortcuts
			const opMap: Record<string, string> = {
				"+": "+",
				"-": "-",
				x: "x",
				X: "x",
				"/": "/",
				"=": "=",
			};
			if (opMap[e.key]) {
				e.preventDefault();
				setCell(r, c, opMap[e.key]);
				if (panel !== "cell") setPanel("cell");
				return;
			}

			// Digit input — appends to current numeric value
			if (/^\d$/.test(e.key)) {
				e.preventDefault();
				setGrid((g) => {
					const next = g.map((row) => [...row]);
					const current = next[r][c];
					const { value, eqs } = parseCell(current);
					const isCurrentSymbol = isSymbol(value);
					const newNum =
						isCurrentSymbol || value === "B" ? e.key : value + e.key;
					next[r][c] = eqs.length > 0 ? `${newNum}:${eqs.join("&")}` : newNum;
					return next;
				});
				if (panel !== "cell") setPanel("cell");
				return;
			}

			// Backspace — removes last digit or clears cell
			if (e.key === "Backspace") {
				e.preventDefault();
				setGrid((g) => {
					const next = g.map((row) => [...row]);
					const current = next[r][c];
					const { value, eqs } = parseCell(current);
					if (value === "B" || isSymbol(value)) {
						next[r][c] = "B";
					} else {
						const trimmed = value.slice(0, -1);
						next[r][c] =
							trimmed === ""
								? "B"
								: eqs.length > 0
									? `${trimmed}:${eqs.join("&")}`
									: trimmed;
					}
					return next;
				});
				return;
			}
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selected, panel, setCell, gridSize]);

	function handleSave(): void {
		const eqCount = Object.keys(equations).length;
		const name =
			saveLabel.trim() ||
			`Grid ${saved.length + 1} (${gridSize}×${gridSize}, ${eqCount} eq)`;
		const entry: SavedGrid = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			name,
			savedAt: Date.now(),
			gridSize,
			grid: grid.slice(0, gridSize).map((row) => row.slice(0, gridSize)),
			equations,
			missingNumbers,
		};
		const next = [entry, ...saved];
		setSaved(next);
		persistSaved(next);
		setSaveLabel("");
	}

	function handleLoadSaved(s: SavedGrid): void {
		const newGrid = EMPTY_GRID(gridSize, gridSize);
		s.grid.forEach((row, r) => {
			row.forEach((cell, c) => {
				if (r < gridSize && c < gridSize) newGrid[r][c] = cell;
			});
		});
		setGridSize(s.gridSize);
		setGrid(s.grid);
		setEquations(s.equations);
		setMissingNumbers(s.missingNumbers);
		setSelected({ r: 0, c: 0 });
		setExported("— click EXPORT to generate —");
	}

	function handleDeleteSaved(id: string): void {
		const next = saved.filter((s) => s.id !== id);
		setSaved(next);
		persistSaved(next);
	}

	function handleClearAll(): void {
		if (!confirm(`Delete all ${saved.length} saved grids?`)) return;
		setSaved([]);
		persistSaved([]);
	}

	function handleExportAll(): void {
		const lines: string[] = ["const levels = ["];
		saved.forEach((s, idx) => {
			// Recompute equation counts for this saved grid
			const liveEquations: Equations = { ...s.equations };
			const eqCounts: Record<string, number> = {};
			for (const row of s.grid) {
				for (const cell of row) {
					const { value, eqs } = parseCell(cell);
					if (value === "B" || isSymbol(value) || value === "=") continue;
					for (const k of eqs) eqCounts[k] = (eqCounts[k] ?? 0) + 1;
				}
			}
			for (const k of Object.keys(liveEquations)) {
				const coordPart = liveEquations[k].split("|")[1] ?? "";
				liveEquations[k] = `${eqCounts[k] ?? 0}|${coordPart}`;
			}

			const data = deriveExport(s.grid, liveEquations, s.missingNumbers);
			lines.push(`  // ${s.name}`);
			lines.push("  {");
			lines.push(`    missingNumbers: [${data.missingNumbers.join(", ")}],`);
			lines.push("    equations: {");
			Object.entries(data.equations).forEach(([k, v]) =>
				lines.push(`      ${k}: "${v}",`),
			);
			lines.push("    },");
			lines.push("    grid: [");
			data.grid.forEach((row, i) => {
				const cells = row.map((c) => `"${c}"`).join(", ");
				lines.push(`      [${cells}]${i < data.grid.length - 1 ? "," : ""}`);
			});
			lines.push("    ],");
			lines.push(`  }${idx < saved.length - 1 ? "," : ""}`);
		});
		lines.push("];");
		const text = lines.join("\n");

		// Open export in the right panel
		setExported(text);
		setPanel("export");
	}

	function handleRandom(): void {
		const { grid: newGrid, equations: newEqs } = generateRandomGrid(gridSize);
		setGrid(newGrid);
		setEquations(newEqs);
		setMissingNumbers([]);
		setSelected({ r: 0, c: 0 });
		setExported("— click EXPORT to generate —");
	}

	function doExport(): void {
		const slicedGrid: Grid = grid
			.slice(0, gridSize)
			.map((row) => row.slice(0, gridSize));

		// Recompute equation counts from the actual grid cells
		const liveEquations: Equations = { ...equations };
		const eqCounts: Record<string, number> = {};
		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				const { value, eqs } = parseCell(slicedGrid[r][c]);
				if (value === "B" || isSymbol(value) || value === "=") continue;
				for (const k of eqs) eqCounts[k] = (eqCounts[k] ?? 0) + 1;
			}
		}
		for (const k of Object.keys(liveEquations)) {
			const coordPart = liveEquations[k].split("|")[1] ?? "";
			liveEquations[k] = `${eqCounts[k] ?? 0}|${coordPart}`;
		}

		const data = deriveExport(slicedGrid, liveEquations, missingNumbers);
		const lines: string[] = [];
		lines.push("{");
		lines.push(`  missingNumbers: [${data.missingNumbers.join(", ")}],`);
		lines.push("  equations: {");
		Object.entries(data.equations).forEach(([k, v]) =>
			lines.push(`    ${k}: "${v}",`),
		);
		lines.push("  },");
		lines.push("  grid: [");
		data.grid.forEach((row, i) => {
			const cells = row.map((c) => `"${c}"`).join(", ");
			lines.push(`    [${cells}]${i < data.grid.length - 1 ? "," : ""}`);
		});
		lines.push("  ],");
		lines.push("},");
		setExported(lines.join("\n"));
		setPanel("export");
	}

	function doCopy(): void {
		navigator.clipboard.writeText(exported).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}

	const eqKeys = Object.keys(equations);

	const tabs: { id: PanelId; label: string }[] = [
		{ id: "cell", label: "✎ CELL" },
		{ id: "eq", label: `⚡ EQ${eqKeys.length ? ` (${eqKeys.length})` : ""}` },
		{ id: "export", label: "↗ OUT" },
	];

	return (
		<div
			style={{
				height: "100dvh",
				width: "100vw",
				background: "#0a0a1a",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
				boxSizing: "border-box",
			}}
		>
			<style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e1e3a; border-radius: 4px; }
        @media (max-width: 900px) {
          .saved-sidebar { display: none !important; }
        }
        @media (max-width: 700px) {
          .right-panel { width: 200px !important; }
          .header-size-selector { display: none !important; }
        }
        @media (max-width: 520px) {
          .right-panel { display: none !important; }
          .header-tabs { display: none !important; }
        }
      `}</style>
			{/* Header */}
			<div
				style={{
					background: "#0d0d1f",
					borderBottom: "1px solid #1a1a30",
					padding: "11px 20px",
					display: "flex",
					alignItems: "center",
					gap: 14,
					flexShrink: 0,
				}}
			>
				<div>
					<div style={{ color: "#6366f140", fontSize: 9, letterSpacing: 3 }}>
						MATHGRID
					</div>
					<div
						style={{
							color: "#e2f0ff",
							fontSize: 15,
							fontWeight: 700,
							letterSpacing: 1,
						}}
					>
						LEVEL EDITOR
					</div>
				</div>
				<div style={{ flex: 1 }} />

				{/* Grid size selector */}
				<div
					className="header-size-selector"
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						background: "#0a0a1a",
						border: "1px solid #1a1a30",
						borderRadius: 8,
						padding: "3px 10px 3px 6px",
					}}
				>
					<span style={{ color: "#333355", fontSize: 9, letterSpacing: 2 }}>
						SIZE
					</span>
					<div style={{ display: "flex", gap: 2 }}>
						{Array.from(
							{ length: MAX_SIZE - MIN_SIZE + 1 },
							(_, i) => MIN_SIZE + i,
						).map((s) => (
							<button
								key={s}
								onClick={() => handleSizeChange(s)}
								style={{
									width: 24,
									height: 24,
									borderRadius: 6,
									cursor: "pointer",
									background: gridSize === s ? "#6366f1" : "transparent",
									border: "none",
									color: gridSize === s ? "#fff" : "#333355",
									fontSize: 9,
									fontWeight: gridSize === s ? 700 : 400,
									transition: "all .15s",
								}}
							>
								{s}
							</button>
						))}
					</div>
				</div>

				{/* Tabs */}
				<div
					className="header-tabs"
					style={{
						display: "flex",
						gap: 2,
						background: "#0a0a1a",
						borderRadius: 8,
						padding: 3,
						border: "1px solid #1a1a30",
					}}
				>
					{tabs.map((tab) => (
						<button
							key={tab.id}
							onClick={() => setPanel(tab.id)}
							style={{
								padding: "5px 13px",
								borderRadius: 6,
								cursor: "pointer",
								background: panel === tab.id ? "#6366f1" : "transparent",
								border: "none",
								color: panel === tab.id ? "#fff" : "#333355",
								fontSize: 10,
								letterSpacing: 1,
								fontWeight: panel === tab.id ? 700 : 400,
								transition: "all .15s",
							}}
						>
							{tab.label}
						</button>
					))}
				</div>

				<button
					onClick={handleRandom}
					style={{
						background: "#10b981",
						border: "none",
						borderRadius: 8,
						color: "#fff",
						padding: "7px 16px",
						cursor: "pointer",
						fontSize: 10,
						letterSpacing: 1,
						fontWeight: 700,
					}}
				>
					⚄ RANDOM
				</button>

				<button
					onClick={doExport}
					style={{
						background: "#6366f1",
						border: "none",
						borderRadius: 8,
						color: "#fff",
						padding: "7px 16px",
						cursor: "pointer",
						fontSize: 10,
						letterSpacing: 1,
						fontWeight: 700,
					}}
				>
					EXPORT
				</button>

				<button
					onClick={() => {
						if (confirm("Clear grid?")) {
							setGrid(EMPTY_GRID(gridSize, gridSize));
							setMissingNumbers([]);
						}
					}}
					style={{
						background: "transparent",
						border: "1px solid #1a1a30",
						borderRadius: 8,
						color: "#252540",
						padding: "7px 12px",
						cursor: "pointer",
						fontSize: 12,
					}}
				>
					⟳
				</button>
			</div>

			{/* Body */}
			<div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
				{/* Saved sidebar */}
				<SavedSidebar
					saved={saved}
					onLoad={handleLoadSaved}
					onDelete={handleDeleteSaved}
					onExportAll={handleExportAll}
					onClearAll={handleClearAll}
				/>

				{/* Grid */}
				<div
					style={{
						flex: 1,
						minWidth: 0,
						padding: "16px 20px",
						overflow: "auto",
						display: "flex",
						flexDirection: "column",
					}}
				>
					{/* Eq legend */}
					{eqKeys.length > 0 && (
						<div
							style={{
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								marginBottom: 14,
							}}
						>
							{eqKeys.map((k, i) => (
								<div
									key={k}
									style={{
										padding: "2px 10px",
										borderRadius: 20,
										background: EQ_COLORS[i % EQ_COLORS.length] + "15",
										border: `1px solid ${EQ_COLORS[i % EQ_COLORS.length]}35`,
										color: EQ_COLORS[i % EQ_COLORS.length],
										fontSize: 9,
										letterSpacing: 1,
									}}
								>
									{k} <span style={{ opacity: 0.4 }}>{equations[k]}</span>
								</div>
							))}
						</div>
					)}

					{/* Col headers */}
					<div style={{ display: "flex", marginBottom: 3, marginLeft: 24 }}>
						{Array.from({ length: gridSize }, (_, c) => (
							<div
								key={c}
								style={{
									width: 46,
									textAlign: "center",
									color: "#1e1e38",
									fontSize: 9,
									flexShrink: 0,
								}}
							>
								{c}
							</div>
						))}
					</div>

					{/* Rows */}
					{grid.slice(0, gridSize).map((row, r) => (
						<div
							key={r}
							style={{ display: "flex", alignItems: "center", marginBottom: 3 }}
						>
							<div
								style={{
									width: 20,
									color: "#1e1e38",
									fontSize: 9,
									textAlign: "right",
									paddingRight: 4,
									flexShrink: 0,
								}}
							>
								{r}
							</div>

							{row.slice(0, gridSize).map((raw, c) => {
								const { value, eqs } = parseCell(raw);
								const isBlank = value === "B";
								const isSel = selected.r === r && selected.c === c;
								const isDragCell = dragCellSet.has(`${r},${c}`);
								const dragIdx = isDragging
									? dragCells.findIndex((p) => p.r === r && p.c === c)
									: -1;
								const dotColors = eqs.map((eq) => {
									const idx = eqKeys.indexOf(eq);
									return idx >= 0 ? EQ_COLORS[idx % EQ_COLORS.length] : "#fff";
								});

								let bg = cellBg(value, isSel);
								let border = cellBorder(value, isSel);
								if (isDragging && isDragCell) {
									const tooMany = dragCells.length > dragTarget;
									bg = tooMany ? "#3a1a1a" : "#1a3a2a";
									border = tooMany
										? "1.5px solid #ef4444"
										: "1.5px solid #10b981";
								}

								return (
									<div
										key={c}
										onMouseDown={() => handleCellMouseDown(r, c)}
										onMouseEnter={() => handleCellMouseEnter(r, c)}
										onClick={() => {
											if (!isDragging) {
												setSelected({ r, c });
												if (panel === "export") setPanel("cell");
											}
										}}
										style={{
											width: 46,
											height: 46,
											flexShrink: 0,
											margin: "0 1.5px",
											borderRadius: 8,
											background: bg,
											border,
											color: cellColor(value),
											display: "flex",
											flexDirection: "column",
											alignItems: "center",
											justifyContent: "center",
											cursor: isDragging ? "crosshair" : "pointer",
											position: "relative",
											fontSize:
												value.length > 3 ? 9 : value.length > 2 ? 11 : 15,
											fontWeight: isBlank ? 400 : 700,
											transition: isDragging
												? "none"
												: "background .1s, border-color .1s",
											userSelect: "none",
											boxShadow:
												isSel && !isDragging ? "0 0 14px #6366f130" : "none",
										}}
									>
										{isDragging && isDragCell && dragIdx >= 0 ? (
											<span
												style={{
													fontSize:
														dragIdx === 0 && dragStartPrefilled ? 14 : 11,
													fontWeight: 700,
													color:
														dragCells.length > dragTarget
															? "#ef4444"
															: "#10b981",
												}}
											>
												{dragIdx === 0 && dragStartPrefilled
													? "⚓"
													: dragIdx + 1}
											</span>
										) : isBlank ? (
											<span
												style={{
													color: isSel ? "#6366f1" : "#181830",
													fontSize: isSel ? 20 : 16,
													animation: isSel
														? "blink 1s step-end infinite"
														: "none",
												}}
											>
												|
											</span>
										) : (
											<span>{value}</span>
										)}
										{dotColors.length > 0 && (
											<div
												style={{
													position: "absolute",
													bottom: 3,
													left: "50%",
													transform: "translateX(-50%)",
													display: "flex",
													gap: 2,
												}}
											>
												{dotColors.slice(0, 4).map((col, i) => (
													<div
														key={i}
														style={{
															width: 4,
															height: 4,
															borderRadius: "50%",
															background: col,
															opacity: 0.8,
														}}
													/>
												))}
											</div>
										)}
									</div>
								);
							})}
						</div>
					))}

					<div
						style={{
							marginTop: 14,
							color: "#1e1e38",
							fontSize: 9,
							lineHeight: 2,
							letterSpacing: 0.5,
						}}
					>
						CLICK to select · type digits · + - x / = for operators · ← → ↑ ↓
						navigate · DEL/SPACE clear · BKSP erase ·{" "}
						<span style={{ color: "#10b98150" }}>
							DRAG 5 cells → auto-equation
						</span>
					</div>

					{/* Save bar */}
					<div
						style={{
							marginTop: 14,
							display: "flex",
							gap: 8,
							alignItems: "center",
						}}
					>
						<input
							type="text"
							value={saveLabel}
							onChange={(e) => setSaveLabel(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleSave();
							}}
							placeholder="name (optional)..."
							style={{
								flex: 1,
								background: "#0d0d1f",
								border: "1px solid #1a1a30",
								borderRadius: 8,
								color: "#e2f0ff",
								padding: "8px 12px",
								fontSize: 11,
								outline: "none",
								maxWidth: 240,
							}}
							onFocus={(e: FocusEvent<HTMLInputElement>) => {
								e.target.style.borderColor = "#10b981";
							}}
							onBlur={(e: FocusEvent<HTMLInputElement>) => {
								e.target.style.borderColor = "#1a1a30";
							}}
						/>
						<button
							onClick={handleSave}
							style={{
								padding: "8px 18px",
								borderRadius: 8,
								cursor: "pointer",
								background: "#10b981",
								border: "none",
								color: "#fff",
								fontSize: 11,
								fontWeight: 700,
								letterSpacing: 1,
							}}
						>
							💾 SAVE
						</button>
						<button
							onClick={() => {
								setGrid(EMPTY_GRID(gridSize, gridSize));
								setEquations({});
								setMissingNumbers([]);
							}}
							style={{
								padding: "8px 14px",
								borderRadius: 8,
								cursor: "pointer",
								background: "#ef444415",
								border: "1px solid #ef444435",
								color: "#ef4444",
								fontSize: 11,
								fontWeight: 700,
								letterSpacing: 1,
							}}
						>
							✕ CLEAN
						</button>
					</div>

					{/* Drag counter badge */}
					{isDragging && (
						<div
							style={{
								position: "fixed",
								bottom: 24,
								left: "50%",
								transform: "translateX(-50%)",
								background:
									dragCells.length > dragTarget
										? "#ef444430"
										: dragCells.length === dragTarget
											? "#10b98130"
											: "#6366f130",
								border: `1.5px solid ${dragCells.length > dragTarget ? "#ef4444" : dragCells.length === dragTarget ? "#10b981" : "#6366f1"}`,
								borderRadius: 20,
								padding: "6px 20px",
								color:
									dragCells.length > dragTarget
										? "#ef4444"
										: dragCells.length === dragTarget
											? "#10b981"
											: "#6366f1",
								fontSize: 12,
								fontWeight: 700,
								letterSpacing: 2,
								pointerEvents: "none",
								zIndex: 99,
							}}
						>
							{dragCells.length} / {dragTarget}{" "}
							{dragCells.length === dragTarget
								? "✓ RELEASE TO APPLY"
								: dragCells.length > dragTarget
									? "TOO MANY"
									: dragStartPrefilled
										? "· starts from existing value"
										: ""}
						</div>
					)}
				</div>

				{/* Right panel */}
				<div
					className="right-panel"
					style={{
						width: 290,
						background: "#0d0d1f",
						borderLeft: "1px solid #1a1a30",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						flexShrink: 0,
					}}
				>
					{panel === "cell" && (
						<CellPanel
							r={selected.r}
							c={selected.c}
							raw={grid[selected.r][selected.c]}
							missingNumbers={missingNumbers}
							onMissingChange={setMissingNumbers}
							onSet={setCell}
						/>
					)}
					{panel === "eq" && (
						<EqPanel equations={equations} onChange={setEquations} />
					)}
					{panel === "export" && (
						<ExportPanel content={exported} onCopy={doCopy} copied={copied} />
					)}
				</div>
			</div>
		</div>
	);
};

export default GridEditor;
