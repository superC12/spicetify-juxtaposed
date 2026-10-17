// Juxtaposed - a Spicetify theme
// VERSION: 1.0.3
// https://github.com/superC12/spicetify-juxtaposed

(function juxtaposed() {
// Marketplace and a manual install can both try to load the theme; run once
if (window.__juxtaposedTheme) return;
window.__juxtaposedTheme = true;

// ---- Dynamic colours ----
(function dynamicColors() {
	// Menu items are built with React, which Spicetify exposes a little after Player and Menu
	if (!document.body || !window.Spicetify?.Player || !Spicetify.Menu || !Spicetify.React || !Spicetify.ReactJSX) {
		setTimeout(dynamicColors, 300);
		return;
	}

	const STORAGE_KEY = "dynamicColors:enabled";
	const FADE_MS = 700;
	// Theme colours that get replaced. Text colours are left alone so contrast stays readable.
	const COLOR_VARS = ["main", "sidebar", "player", "card", "main-elevated", "highlight", "highlight-elevated", "button", "button-active", "tab-active"];

	let enabled = localStorage.getItem(STORAGE_KEY) !== "false";
	let currentCover = null;
	let barColor = null;
	// Read by Layout Tweaks' "Copy theme diagnostics" menu item
	const status = { loaded: true };
	window.__dynamicColorsStatus = status;
	const PAUSED_BAR = "hsl(0 0% 11%)";
	let headerColor = null;
	const PAUSED_HEADER = "hsl(0 0% 33%)";
	const root = document.documentElement;

	// Registering the variables as colours lets the browser fade between songs instead of snapping
	for (const name of COLOR_VARS) {
		try {
			CSS.registerProperty({ name: `--spice-${name}`, syntax: "<color>", inherits: true, initialValue: "#121212" });
		} catch {
			// already registered
		}
	}
	try {
		CSS.registerProperty({ name: "--dynamic-bar", syntax: "<color>", inherits: true, initialValue: "#181818" });
	} catch {
		// already registered
	}
	const style = document.createElement("style");
	style.className = "dynamicColors";
	style.textContent = `
		:root.dynamicColors {
			transition: ${[...COLOR_VARS.map((name) => `--spice-${name}`), "--dynamic-bar"].map((name) => `${name} ${FADE_MS}ms ease`).join(", ")};
		}
		/* Player bar: carries the song's colour while playing and goes grey when paused */
		:root.dynamicColors .main-nowPlayingBar-container {
			background: linear-gradient(90deg, var(--dynamic-bar), color-mix(in srgb, var(--dynamic-bar) 45%, black));
			border-radius: 8px;
		}
		/* Home header glow: the song's colour while playing and grey when paused, unless a shortcut tile is hovered */
		:root.dynamicColors:not(.dynamicColors-tileHover) main > div > div:first-child:has(~ [data-testid="home-page"]),
		/* ...and the bar that sticks to the top once Home is scrolled */
		:root.dynamicColors:not(.dynamicColors-tileHover) main > div > div:has(~ [data-testid="home-page"]):has(> .contentSpacing) > div:first-child:not(.contentSpacing) {
			background-color: var(--dynamic-header) !important;
		}
		:root.dynamicColors .Root__top-container {
			background: linear-gradient(160deg, var(--dynamic-glow) 0%, var(--dynamic-base) 55%) !important;
		}
		/* Cat-Jam Synced: give the cat a glow in the song's colour. Does nothing if that extension isn't installed. */
		:root.dynamicColors #catjam-webm {
			box-shadow: 0 0 14px 1px rgba(var(--spice-rgb-button), 0.5);
		}
	`;
	document.head.appendChild(style);

	function coverUrl() {
		const image = Spicetify.Player.data?.item?.metadata?.image_url;
		if (!image) return null;
		if (image.startsWith("spotify:image:")) return `https://i.scdn.co/image/${image.slice("spotify:image:".length)}`;
		return image.startsWith("http") ? image : null;
	}

	function rgbToHsl(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;
		if (max === min) return [0, 0, l];
		const d = max - min;
		const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		let h;
		if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		return [h * 60, s, l];
	}

	function hslToRgb(h, s, l) {
		const k = (n) => (n + h / 30) % 12;
		const a = s * Math.min(l, 1 - l);
		const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
		return [f(0), f(8), f(4)];
	}

	// Find the cover's dominant hue. Averaging every pixel turns mixed covers grey, so pixels vote for a
	// hue in proportion to how colourful they are, and the winning hue's own saturation is used.
	function colorFromImage(url) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.onload = () => {
				try {
					const size = 32;
					const canvas = document.createElement("canvas");
					canvas.width = canvas.height = size;
					const ctx = canvas.getContext("2d", { willReadFrequently: true });
					ctx.drawImage(img, 0, 0, size, size);
					const { data } = ctx.getImageData(0, 0, size, size);
					const BUCKETS = 24;
					const votes = new Array(BUCKETS).fill(0);
					const sumX = new Array(BUCKETS).fill(0);
					const sumY = new Array(BUCKETS).fill(0);
					const sumS = new Array(BUCKETS).fill(0);
					let total = 0;
					for (let i = 0; i < data.length; i += 4) {
						const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
						const chroma = s * (1 - Math.abs(2 * l - 1));
						const bucket = Math.floor((h / 360) * BUCKETS) % BUCKETS;
						const angle = (h * Math.PI) / 180;
						votes[bucket] += chroma;
						sumX[bucket] += Math.cos(angle) * chroma;
						sumY[bucket] += Math.sin(angle) * chroma;
						sumS[bucket] += s * chroma;
						total += chroma;
					}
					// Practically colourless cover: stay neutral
					if (total / (size * size) < 0.02) {
						resolve([0, 0, 0.5]);
						return;
					}
					// Score each hue together with its two neighbours so a colour split across a bucket edge still wins
					let best = 0;
					let bestScore = -1;
					for (let i = 0; i < BUCKETS; i++) {
						const score = votes[(i + BUCKETS - 1) % BUCKETS] + votes[i] + votes[(i + 1) % BUCKETS];
						if (score > bestScore) {
							bestScore = score;
							best = i;
						}
					}
					let x = 0;
					let y = 0;
					let s = 0;
					for (const i of [(best + BUCKETS - 1) % BUCKETS, best, (best + 1) % BUCKETS]) {
						x += sumX[i];
						y += sumY[i];
						s += sumS[i];
					}
					const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
					resolve([hue, s / bestScore, 0.5]);
				} catch (error) {
					reject(error);
				}
			};
			img.onerror = reject;
			img.src = url;
		});
	}

	async function colorFromSpotify() {
		const uri = Spicetify.Player.data?.item?.uri;
		const colors = uri && (await Spicetify.colorExtractor?.(uri));
		const hex = colors?.VIBRANT ?? colors?.PROMINENT;
		if (!hex) throw new Error("No colour available for this track");
		const n = Number.parseInt(hex.slice(1), 16);
		return rgbToHsl(n >> 16, (n >> 8) & 255, n & 255);
	}

	function apply([h, s]) {
		// Keep surfaces dark whatever the cover looks like; only hue and a capped saturation carry over
		// A cover with any real colour gets at least a visible tint; a colourless one stays neutral
		const surface = s < 0.08 ? s : Math.min(Math.max(s, 0.3), 0.55);
		const palette = {
			main: [h, surface, 0.09],
			sidebar: [h, surface, 0.065],
			player: [h, surface, 0.05],
			card: [h, surface, 0.14],
			"main-elevated": [h, surface, 0.16],
			highlight: [h, surface, 0.17],
			"highlight-elevated": [h, surface, 0.21],
			button: [h, Math.max(s, 0.45) * (s < 0.08 ? 0 : 1), 0.62],
			"button-active": [h, Math.max(s, 0.45) * (s < 0.08 ? 0 : 1), 0.7],
			"tab-active": [h, surface, 0.2],
		};
		for (const [name, hsl] of Object.entries(palette)) {
			const [r, g, b] = hslToRgb(...hsl);
			root.style.setProperty(`--spice-${name}`, `rgb(${r}, ${g}, ${b})`);
			root.style.setProperty(`--spice-rgb-${name}`, `${r}, ${g}, ${b}`);
		}
		root.style.setProperty("--dynamic-glow", `hsl(${h} ${Math.round(surface * 100)}% 20%)`);
		root.style.setProperty("--dynamic-base", `hsl(${h} ${Math.round(surface * 100)}% 3%)`);
		barColor = `hsl(${h} ${Math.round(Math.min(s, 0.6) * 100)}% 20%)`;
		headerColor = `hsl(${h} ${Math.round((s < 0.08 ? s : Math.min(Math.max(s, 0.35), 0.65)) * 100)}% 30%)`;
		updateBar();
		root.classList.add("dynamicColors");
	}

	function updateBar() {
		if (!barColor) return;
		const playing = Spicetify.Player.isPlaying();
		root.style.setProperty("--dynamic-bar", playing ? barColor : PAUSED_BAR);
		root.style.setProperty("--dynamic-header", playing ? headerColor : PAUSED_HEADER);
	}

	// Home's header glow follows whichever shortcut tile is hovered. Track that, so the song's colour can
	// take over whenever no tile is hovered.
	document.addEventListener(
		"pointerover",
		(event) => {
			let overTile = false;
			let node = event.target instanceof Element ? event.target : null;
			for (let depth = 0; node && depth < 6 && !overTile; depth++, node = node.parentElement) {
				overTile = node.querySelector(':scope > [data-testid="shortcut-background"]') !== null;
			}
			root.classList.toggle("dynamicColors-tileHover", overTile);
		},
		true
	);

	function clear() {
		root.classList.remove("dynamicColors");
		for (const name of COLOR_VARS) {
			root.style.removeProperty(`--spice-${name}`);
			root.style.removeProperty(`--spice-rgb-${name}`);
		}
		root.style.removeProperty("--dynamic-glow");
		root.style.removeProperty("--dynamic-base");
		root.style.removeProperty("--dynamic-bar");
		root.style.removeProperty("--dynamic-header");
		currentCover = null;
		barColor = null;
		headerColor = null;
	}

	async function update() {
		if (!enabled) return;
		const url = coverUrl();
		status.rawImage = Spicetify.Player.data?.item?.metadata?.image_url ?? null;
		status.cover = url;
		if (!url || url === currentCover) return;
		currentCover = url;
		let color;
		try {
			color = await colorFromImage(url);
			status.source = "image";
		} catch (imageError) {
			status.imageError = String(imageError?.message ?? imageError?.type ?? imageError);
			try {
				color = await colorFromSpotify();
				status.source = "spotify";
			} catch (error) {
				status.error = String(error?.message ?? error);
				console.warn("[Dynamic Colors] could not read a colour for this song", error);
				return;
			}
		}
		status.color = color;
		// A newer song may have started while this one was loading
		if (enabled && currentCover === url) apply(color);
	}

	Spicetify.Player.addEventListener("songchange", update);
	Spicetify.Player.addEventListener("onplaypause", updateBar);
	update();
	// At startup the player may not have its track yet, and no songchange fires for a song that is already loaded
	let startupTries = 0;
	const startupTimer = setInterval(() => {
		if (currentCover || ++startupTries > 60) clearInterval(startupTimer);
		else update();
	}, 500);

	new Spicetify.Menu.Item("Dynamic Colors", enabled, (item) => {
		enabled = !enabled;
		localStorage.setItem(STORAGE_KEY, String(enabled));
		item.setState(enabled);
		if (enabled) update();
		else clear();
	}).register();
})();

// ---- Layout ----
(function layoutTweaks() {
	// Menu items are built with React, which Spicetify exposes a little after Menu
	if (!document.head || !document.body || !window.Spicetify?.Menu || !Spicetify.React || !Spicetify.ReactJSX) {
		setTimeout(layoutTweaks, 300);
		return;
	}

	const STORAGE_KEY = "layoutTweaks:enabled";
	const HIDDEN_KEY = "layoutTweaks:hiddenHomeSections";
	let enabled = localStorage.getItem(STORAGE_KEY) !== "false";
	let hidden = new Set();
	try {
		hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
	} catch {
		// unreadable list, start empty
	}

	const style = document.createElement("style");
	style.className = "layoutTweaks";
	style.textContent = `
		/* Cat-Jam Synced: dock the cat against the right-hand controls instead of leaving it adrift */
		.main-nowPlayingBar-right:has(> #catjam-webm) > .main-nowPlayingBar-extraControls {
			flex-grow: 0;
		}
		/* The cat's video is cropped at its edges, so give it a rounded tile the size of the controls beside it */
		.main-nowPlayingBar-right > #catjam-webm {
			align-self: center;
			flex: 0 0 auto;
			width: 48px !important;
			height: 48px !important;
			margin-inline-end: 4px;
			border-radius: 10px;
			object-fit: cover;
			background: rgba(var(--spice-rgb-text), 0.06);
		}
		/* The narrower bar must not squeeze the volume slider */
		.main-nowPlayingBar-right [data-testid="volume-bar"] {
			flex: 0 0 125px;
		}

		/* Player bar: taller, larger cover and text, and a seek bar that uses a wide window */
		.main-nowPlayingBar-nowPlayingBar {
			height: 88px;
			/* Keep the song info and the right-hand controls near the playback buttons on very wide windows */
			width: 100%;
			max-width: 1800px;
			margin-inline: auto;
		}
		.main-nowPlayingBar-center {
			max-width: 1000px;
		}
		.main-nowPlayingBar-left [data-testid="CoverSlotCollapsed__container"],
		.main-nowPlayingBar-left [data-testid="CoverSlotCollapsed__container"] > div,
		.main-nowPlayingBar-left [data-testid="cover-art-button"],
		.main-nowPlayingBar-left [data-testid="cover-art-button"] > div,
		.main-nowPlayingBar-left [data-testid="cover-art-button"] img {
			width: 64px !important;
			height: 64px !important;
		}
		.main-nowPlayingBar-left [data-testid="context-item-info-title"] {
			font-size: 16px;
		}
		.main-nowPlayingBar-left [data-testid="context-item-info-subtitles"] {
			font-size: 13px;
		}


		/* Corners: match covers to the 8px radius the panels and cards already use */
		.main-cardImage-imageWrapper:not(.main-cardImage-circular),
		.main-cardImage-image:not(.main-cardImage-circular),
		[data-testid="cover-art-button"] {
			border-radius: 8px;
		}
		/* Home shortcut tiles (the grid at the top of Home) */
		div:has(> [data-testid="shortcut-background"]) {
			border-radius: 8px;
			overflow: hidden;
		}

		/* Section headings on Home: larger so they read as headings, not captions */
		[data-testid="home-page"] h2 {
			font-size: 28px !important;
			letter-spacing: -0.02em;
		}
		/* Keep the Hide button on the title's line so it doesn't add a row under every heading */
		[data-testid="home-page"] h2:has(> .layoutTweaks-hide) {
			display: flex;
			align-items: center;
			flex-wrap: nowrap;
		}
		[data-testid="home-page"] h2:has(> .layoutTweaks-hide) > :not(.layoutTweaks-hide) {
			flex: 0 1 auto;
			min-width: 0;
		}
		[data-testid="home-page"] h2 > .layoutTweaks-hide {
			flex: 0 0 auto;
		}

		/* Album, playlist and artist titles: one fixed, readable size instead of Spotify's shrink-to-fit */
		[data-testid="entityTitle"],
		[data-testid="entityTitle"] *,
		[data-testid="adaptiveEntityTitle"],
		[data-testid="adaptiveEntityTitle"] * {
			font-size: 3rem !important;
			line-height: 1.15 !important;
		}

		/* Type badges on card covers */
		[data-lt-badge] {
			position: relative;
		}
		[data-lt-badge]::before {
			content: attr(data-lt-badge);
			position: absolute;
			/* Explicit box, so nothing Spotify sets on this pseudo-element can stretch it over the cover */
			inset: 8px 8px auto auto;
			width: auto;
			height: auto;
			z-index: 1;
			padding: 2px 7px;
			border-radius: 6px;
			background: rgba(0, 0, 0, 0.72);
			color: #fff;
			font-size: 10px;
			font-weight: 700;
			letter-spacing: 0.06em;
			line-height: 1.5;
			text-transform: uppercase;
			pointer-events: none;
		}

		/* Search filters: squared, outlined tabs so they don't read as the same pills used everywhere else */
		:root[data-lt-route="search"] main [data-encore-id="chip"] {
			border-radius: 6px !important;
			background: transparent !important;
			box-shadow: inset 0 0 0 1px rgba(var(--spice-rgb-text), 0.28);
			color: var(--spice-text) !important;
		}
		:root[data-lt-route="search"] main [data-encore-id="chip"] > * {
			border-radius: 6px !important;
			background: transparent !important;
			color: inherit !important;
		}
		:root[data-lt-route="search"] main [data-encore-id="chip"]:hover {
			box-shadow: inset 0 0 0 1px var(--spice-text);
		}
		:root[data-lt-route="search"] main [data-encore-id="chip"]:is([aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]) {
			box-shadow: inset 0 0 0 1px var(--spice-button), inset 0 -3px 0 var(--spice-button);
			background: rgba(var(--spice-rgb-button), 0.16) !important;
		}

		/* Skip quiet intro button, floating just above the playback controls */
		.main-nowPlayingBar-center {
			position: relative;
		}
		.layoutTweaks-skipIntro {
			position: absolute;
			left: 50%;
			bottom: calc(100% + 14px);
			transform: translateX(-50%);
			padding: 6px 14px;
			border: 0;
			border-radius: 9999px;
			background: var(--spice-button);
			color: #000;
			font-size: 13px;
			font-weight: 700;
			white-space: nowrap;
			cursor: pointer;
			box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
		}

		/* Home sections: a Hide button that appears when you hover a section */
		.layoutTweaks-hidden {
			display: none !important;
		}
		.layoutTweaks-hide {
			margin-inline-start: 12px;
			vertical-align: middle;
			letter-spacing: normal;
			line-height: 1.4;
			padding: 2px 10px;
			border: 1px solid rgba(var(--spice-rgb-text), 0.3);
			border-radius: 9999px;
			background: transparent;
			color: var(--spice-subtext);
			font-size: 12px;
			cursor: pointer;
			opacity: 0;
			transition: opacity 0.15s;
		}
		.layoutTweaks-section:hover .layoutTweaks-hide,
		.layoutTweaks-hide:focus-visible {
			opacity: 1;
		}
		.layoutTweaks-hide:hover {
			color: var(--spice-text);
			border-color: var(--spice-text);
		}
	`;

	const saveHidden = () => localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));

	function decorateHome() {
		for (const heading of document.querySelectorAll('[data-testid="home-page"] h2')) {
			const section = heading.closest('section:not([data-testid="home-page"])');
			// The button lives inside the heading, so remember the title before its text is added
			const title = (heading.dataset.layoutTweaksTitle ??= heading.textContent.trim());
			if (!section || !title) continue;
			section.classList.add("layoutTweaks-section");
			section.classList.toggle("layoutTweaks-hidden", enabled && hidden.has(title));
			const existing = heading.querySelector(":scope > .layoutTweaks-hide");
			if (!enabled) {
				existing?.remove();
			} else if (!existing) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "layoutTweaks-hide";
				button.textContent = "Hide";
				button.title = `Hide "${title}" from Home`;
				button.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					hidden.add(title);
					saveHidden();
					decorateHome();
				});
				// Inside the heading so it sits on the title's line instead of adding a row of its own
				heading.appendChild(button);
			}
		}
	}

	// Home re-renders as you scroll, so re-check at most once per frame
	// Compatibility: Spotify 1.3.4 renamed its elements and Spicetify's name table has not caught up, so
	// the readable names that this theme, Spicetify's player-bar buttons and Cat-Jam Synced rely on are gone.
	// Put them back on the elements they belong to. Harmless once Spicetify restores them itself.
	function restoreLegacyNames() {
		const bar = document.querySelector('[data-testid="now-playing-bar"]');
		const row = bar?.firstElementChild;
		if (!row) return;
		const add = (el, name) => {
			if (el && !el.classList.contains(name)) el.classList.add(name);
		};
		add(bar, "main-nowPlayingBar-container");
		add(row, "main-nowPlayingBar-nowPlayingBar");
		const sections = [...row.children].filter((el) => el.tagName === "DIV");
		if (sections.length >= 3) {
			const right = sections[sections.length - 1];
			add(sections[0], "main-nowPlayingBar-left");
			add(sections[1], "main-nowPlayingBar-center");
			add(right, "main-nowPlayingBar-right");
			add(right.querySelector(":scope > div"), "main-nowPlayingBar-extraControls");
			add(right.querySelector('[data-testid="control-button-queue"]'), "main-genericButton-button");
		}
		add(bar.querySelector('[data-testid="now-playing-widget"]'), "main-nowPlayingWidget-nowPlaying");
		add(bar.querySelector('[data-testid="lyrics-button"]'), "main-nowPlayingBar-lyricsButton");
		const grid = bar.parentElement?.parentElement;
		if (grid && !grid.classList.contains("Root__top-container") && getComputedStyle(grid).display === "grid") {
			grid.classList.add("Root__top-container");
		}
	}
	restoreLegacyNames();

	// Marketplace and Lyrics Plus put their tab bars into ".main-topBar-topbarContentWrapper", which Spotify
	// 1.3.4 no longer has, so their tabs never appear. Provide a stand-in pinned over the top of the main view.
	// It lives on <body>, outside the part of the page Spotify re-renders, and stays on when Layout Tweaks is off.
	const topbarStyle = document.createElement("style");
	topbarStyle.className = "layoutTweaks-topbar";
	topbarStyle.textContent = `
		.layoutTweaks-topbarSlot {
			position: fixed;
			z-index: 9;
			pointer-events: auto;
			-webkit-app-region: no-drag;
			display: flex;
			align-items: center;
			box-sizing: border-box;
			height: 56px;
			padding: 0 24px;
			border-radius: 8px 8px 0 0;
			background: var(--spice-main, #121212);
		}
		.layoutTweaks-topbarSlot:empty {
			display: none;
		}
	`;
	document.head.appendChild(topbarStyle);
	let topbarSlot = null;
	function placeTopbar() {
		if (!topbarSlot) {
			// Use the real one if Spotify, Spicetify or another extension already provides it
			if (document.querySelector(".main-topBar-topbarContentWrapper")) return;
			topbarSlot = document.createElement("div");
			topbarSlot.className = "main-topBar-topbarContentWrapper layoutTweaks-topbarSlot";
			// Inside "#main": Spotify's click handling only covers that element, so tabs on <body> ignore clicks
			(document.querySelector("#main") ?? document.body).appendChild(topbarSlot);
		}
		const main = document.querySelector("#main-view") ?? document.querySelector("main");
		if (!main) return;
		const rect = main.getBoundingClientRect();
		topbarSlot.style.top = `${Math.round(rect.top)}px`;
		topbarSlot.style.left = `${Math.round(rect.left)}px`;
		topbarSlot.style.width = `${Math.round(rect.width)}px`;
	}
	placeTopbar();
	window.addEventListener("resize", placeTopbar);

	// Content width: Spotify caps pages at 1955px. Raise the cap on wide windows, but never above the main
	// view's own width, because Spotify's carousels pull their cards inward when the cap exceeds the space.
	const MAX_CONTENT_WIDTH = 2400;
	const SPOTIFY_CONTENT_WIDTH = 1955;
	let observedMain = null;
	const contentObserver = new ResizeObserver(updateContentWidth);
	function updateContentWidth() {
		const width = observedMain?.isConnected ? observedMain.clientWidth : 0;
		if (enabled && width > SPOTIFY_CONTENT_WIDTH) {
			document.documentElement.style.setProperty("--content-max-width", `${Math.min(MAX_CONTENT_WIDTH, width)}px`);
		} else {
			document.documentElement.style.removeProperty("--content-max-width");
		}
	}
	function watchMainView() {
		const main = document.querySelector("main");
		if (main === observedMain) return;
		if (observedMain) contentObserver.unobserve(observedMain);
		observedMain = main;
		if (main) contentObserver.observe(main);
		updateContentWidth();
	}
	watchMainView();

	// Route marker, so styles can target one page (the search filters share their markup with every other chip)
	function markRoute() {
		const path = Spicetify.Platform?.History?.location?.pathname ?? "/";
		document.documentElement.dataset.ltRoute = path.split("/")[1] || "home";
	}
	markRoute();
	Spicetify.Platform?.History?.listen?.(markRoute);

	// Type badges: a small label on each card's cover saying what it is. Artists are skipped because their
	// round covers already set them apart.
	const CARD_TYPES = { album: "Album", playlist: "Playlist", show: "Podcast", episode: "Episode", audiobook: "Audiobook" };
	function labelCards() {
		for (const card of document.querySelectorAll('main [data-encore-id="card"]:not([data-lt-type])')) {
			// The title link says what the card opens; the hidden click hint carries the same URI as a fallback
			const href = card.querySelector("a[href]")?.getAttribute("href") ?? "";
			const hint = card.querySelector('[id^="onClickHint"]')?.id ?? "";
			const type =
				href.match(/^\/(album|playlist|show|episode|audiobook)\//)?.[1] ??
				hint.match(/spotify:(album|playlist|show|episode|audiobook):/)?.[1] ??
				"";
			// The badge goes on the cover, not the card: Spotify already uses the card's pseudo-elements for its hover overlay
			const cover = [...card.children].find((child) => child.tagName === "DIV" && child.querySelector("img"));
			// Covers load lazily; leave the card unmarked so it is picked up again once its image exists
			if (type && !cover) continue;
			card.dataset.ltType = type;
			// Only an attribute is set. Adding an element inside the card makes Spotify's renderer fail and blank the app.
			if (type && enabled) cover.dataset.ltBadge = CARD_TYPES[type];
		}
	}

	// Skip quiet intro: when a track opens with several seconds of near-silence, offer a one-click skip
	const QUIET_DB = -35;
	const MIN_INTRO_SECONDS = 4;
	let introEndMs = 0;
	let introUri = null;
	const skipButton = document.createElement("button");
	skipButton.type = "button";
	skipButton.className = "layoutTweaks-skipIntro";
	skipButton.textContent = "Skip quiet intro";
	skipButton.addEventListener("click", () => {
		if (introEndMs) Spicetify.Player.seek(introEndMs);
		skipButton.remove();
	});
	async function loadIntro() {
		introEndMs = 0;
		skipButton.remove();
		const uri = Spicetify.Player?.data?.item?.uri;
		introUri = uri;
		if (!uri?.startsWith("spotify:track:") || !Spicetify.getAudioData) return;
		try {
			const data = await Spicetify.getAudioData(uri);
			if (introUri !== uri) return;
			const firstLoud = data?.segments?.find((segment) => segment.loudness_max > QUIET_DB);
			if (firstLoud && firstLoud.start >= MIN_INTRO_SECONDS) introEndMs = Math.round((firstLoud.start - 0.4) * 1000);
		} catch {
			// no audio analysis for this track
		}
	}
	function updateSkipIntro() {
		const show = enabled && introEndMs > 0 && Spicetify.Player.getProgress() < introEndMs - 1000;
		if (!show) {
			if (skipButton.isConnected) skipButton.remove();
			return;
		}
		const center = document.querySelector(".main-nowPlayingBar-center");
		if (center && skipButton.parentElement !== center) center.appendChild(skipButton);
	}
	if (Spicetify.Player?.addEventListener) {
		Spicetify.Player.addEventListener("songchange", loadIntro);
		loadIntro();
		setInterval(updateSkipIntro, 500);
	}

	// Spotify re-renders as you browse, so re-check at most once per frame
	let queued = false;
	new MutationObserver(() => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			restoreLegacyNames();
			placeTopbar();
			watchMainView();
			labelCards();
			if (document.querySelector('[data-testid="home-page"]')) decorateHome();
		});
	}).observe(document.body, { childList: true, subtree: true });

	function apply() {
		if (enabled) document.head.appendChild(style);
		else style.remove();
		updateContentWidth();
		decorateHome();
	}
	apply();

	new Spicetify.Menu.Item("Layout Tweaks", enabled, (item) => {
		enabled = !enabled;
		localStorage.setItem(STORAGE_KEY, String(enabled));
		item.setState(enabled);
		apply();
	}).register();

	// ---- Diagnostics: a text summary of the page structure, for fixing the theme after Spotify updates ----

	function describe(el) {
		const classes = [...el.classList].slice(0, 6).join(".");
		const testId = el.getAttribute("data-testid");
		const rect = el.getBoundingClientRect();
		const extra = ["data-encore-id", "role", "aria-checked", "aria-selected", "aria-pressed", "href", "data-lt-type"]
			.filter((name) => el.hasAttribute(name))
			.map((name) => `[${name}=${el.getAttribute(name).slice(0, 40)}]`)
			.join("");
		return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes ? `.${classes}` : ""}${testId ? `[testid=${testId}]` : ""}${extra} ${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.x)},${Math.round(rect.y)}`;
	}

	function tree(el, depth, maxChildren = 8, indent = "") {
		if (!el) return `${indent}(not found)\n`;
		let out = `${indent}${describe(el)}\n`;
		if (depth <= 0) return out;
		const children = [...el.children];
		for (const child of children.slice(0, maxChildren)) out += tree(child, depth - 1, maxChildren, `${indent}  `);
		if (children.length > maxChildren) out += `${indent}  … ${children.length - maxChildren} more\n`;
		return out;
	}

	function ancestors(el) {
		const out = [];
		for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
			const css = getComputedStyle(node);
			out.push(`${describe(node)} {display:${css.display}; bg:${css.backgroundColor}}`);
		}
		return `${out.join("\n")}\n`;
	}

	function diagnostics() {
		const $ = (selector) => document.querySelector(selector);
		const rootStyle = document.documentElement.getAttribute("style") ?? "";
		const bar = $('[data-testid="now-playing-bar"]');
		const firstShelf = $('[data-testid="home-page"] h2')?.closest('section:not([data-testid="home-page"])');
		const parts = [
			`Spotify ${Spicetify.Platform?.version} | Spicetify ${Spicetify.Config?.version} | window ${innerWidth}x${innerHeight} | path ${Spicetify.Platform?.History?.location?.pathname}`,
			`Dynamic Colors status: ${JSON.stringify(window.__dynamicColorsStatus ?? "extension not loaded")}`,
			`root class: ${document.documentElement.className}`,
			`root style: ${rootStyle.slice(0, 900)}`,
			`cat (#catjam-webm): ${$("#catjam-webm") ? describe($("#catjam-webm")) : "not on page"}`,
			`\n== player bar, up to body ==\n${bar ? ancestors(bar) : "(now-playing-bar not found)\n"}`,
			`== player bar tree ==\n${tree(bar, 5)}`,
			`== body children ==\n${tree(document.body, 3, 12)}`,
			`== app grid ==\n${tree(bar?.parentElement?.parentElement, 2, 10)}`,
			`== top bar ==\n${tree($("#global-nav-bar") ?? bar?.parentElement?.parentElement?.firstElementChild, 4, 8)}`,
			`== main view ==\n${tree($("main"), 3, 6)}`,
			`== first Home shelf ==\n${tree(firstShelf, 4, 5)}`,
			`== Home shortcut tile ==\n${tree($('[data-testid="shortcut-background"]')?.parentElement?.parentElement, 3, 5)}`,
			`== entity header (album/playlist page) ==\n${tree($('[data-testid="entity-header"]'), 7, 6)}`,
			`== below entity header ==\n${tree($('[data-testid="entity-header"]')?.parentElement, 2, 6)}`,
			`== first card ==\n${tree($('main [data-encore-id="card"]') ?? $("main .main-card-card"), 5, 5)}`,
			`== chips in main view ==\n${tree($('main [data-encore-id="chip"]')?.parentElement?.parentElement, 3, 4)}`,
			`== lyrics plus ==\n${tree($(".lyrics-lyricsContainer-LyricsContainer"), 2, 8)}`,
		];
		return parts.join("\n").slice(0, 30000);
	}

	new Spicetify.Menu.Item("Copy theme diagnostics", false, async () => {
		const text = diagnostics();
		try {
			if (Spicetify.Platform?.ClipboardAPI?.copy) await Spicetify.Platform.ClipboardAPI.copy(text);
			else await navigator.clipboard.writeText(text);
			Spicetify.showNotification?.("Theme diagnostics copied. Paste them to Claude.");
		} catch (error) {
			console.log(text);
			Spicetify.showNotification?.("Could not copy diagnostics", true);
		}
	}).register();

	new Spicetify.Menu.Item("Show hidden Home sections", false, () => {
		hidden.clear();
		saveHidden();
		decorateHome();
		Spicetify.showNotification?.("Hidden Home sections restored");
	}).register();
})();
})();
