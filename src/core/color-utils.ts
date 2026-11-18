export function normalizeHexColor(value: string): string | null {
	const hex = String(value).trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(hex)) {
		return `#${[...hex].map((c) => c + c).join('').toLowerCase()}`;
	}
	return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function contrastInk(color: string): string {
	const parts = color.slice(1).match(/../g);
	if (!parts) return '#ffffff';
	const [r, g, b] = parts
		.map((x) => parseInt(x, 16) / 255)
		.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? '#111111' : '#ffffff';
}
