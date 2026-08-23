const ACRONYMS = new Map(
	['API', 'HTTP', 'URL', 'OAuth', 'OS', 'JSON', 'IP', 'DNS'].map((acronym) => [
		acronym.toLowerCase(),
		acronym,
	]),
);

export function humanize(variantName: string): string {
	const words = splitVariantName(variantName);
	if (words.length === 0) return '';

	return words
		.map((word, index) => {
			const acronym = ACRONYMS.get(word.toLowerCase());
			if (acronym) return acronym;

			const lower = word.toLowerCase();
			if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
			return lower;
		})
		.join(' ');
}

function splitVariantName(variantName: string): string[] {
	const normalized = variantName.replaceAll('OAuth', 'OAUTH');
	return Array.from(
		normalized.matchAll(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g),
		(match) => match[0],
	).reduce<string[]>((words, word) => {
		const previous = words.at(-1);
		if (
			previous &&
			/^\d+$/.test(word) &&
			!ACRONYMS.has(previous.toLowerCase())
		) {
			words[words.length - 1] = `${previous}${word}`;
			return words;
		}
		words.push(word);
		return words;
	}, []);
}
