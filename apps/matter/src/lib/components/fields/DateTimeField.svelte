<script lang="ts">
	import TextCell from './TextCell.svelte';
	import type { FieldProps } from './field-props';

	// A text input over the RFC 3339 string for now; a natural-language date-time
	// picker from @epicenter/ui/natural-language-date-input lands with the calendar
	// view (spec "Later"). A value that is not valid
	// RFC 3339 classifies INVALID and routes to the JSON repair editor, so this only
	// ever sees a parseable datetime. An empty draft reverts: there is no empty
	// datetime, and clearing the key is the cell's chrome. The distinct kind is the
	// seam where the picker replaces this one prop.
	let { cell, save }: FieldProps = $props();
</script>

<TextCell
	{cell}
	{save}
	inputClass="tabular-nums"
	displayClass="tabular-nums"
	parse={(text) => {
		const value = text.trim();
		return value === '' ? { type: 'cancel' } : { type: 'value', value };
	}}
/>
