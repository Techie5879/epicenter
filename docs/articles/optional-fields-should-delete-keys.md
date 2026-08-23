# Optional Fields Should Delete Keys

An optional Matter field should be absent when it has no value. Not `null`, not a JSON union, not a sentinel date. The schema should describe valid present values, and the model should describe whether a row is allowed to omit them.

That split matters because Matter is both a table viewer and a markdown folder. The table wants typed columns. The folder wants plain frontmatter a person can edit by hand.

```json
{
  "fields": {
    "name": { "type": "string", "minLength": 1 },
    "reviewBy": { "type": "string", "format": "date" }
  },
  "optional": ["reviewBy"]
}
```

`reviewBy` stays a plain JSON Schema value schema. If the key is present, it must be a date string. `optional` is Matter policy around row completeness: this row may be valid without that key.

## Fields describe values; optional describes rows

This is the tempting shape:

```json
{
  "fields": {
    "reviewBy": {
      "type": "string",
      "format": "date",
      "optional": true
    }
  }
}
```

It puts policy inside the value schema. That breaks the contract we want from `fields.*`: each field value should be copy-pasteable JSON Schema. JSON Schema already has a place for requiredness, but it belongs to the parent object, not the property schema.

Matter's default is also different from plain JSON Schema. In JSON Schema, omitted `required` means every property is optional. In Matter today, modeled fields are required by default. So the smaller extension is an exception list.

```txt
fields.*  present-value schema
optional  exceptions to Matter's default requiredness
```

The JSON Schema object form is still derivable:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "reviewBy": { "type": "string", "format": "date" }
  },
  "required": ["name"]
}
```

Matter authors the compact folder model; tools can derive the object schema when they need it.

## Clear should delete the key

Matter already writes this way. The field write path treats `undefined` as clear:

```typescript
export function editField(raw: string, key: string, value: unknown): string {
  const { data } = parseMarkdown(raw);
  if (!data) return raw;
  const frontmatter = { ...data.frontmatter };
  if (value === undefined) delete frontmatter[key];
  else frontmatter[key] = value;
  return serializeEntry(frontmatter, data.body);
}
```

The test says the same thing in user terms:

```typescript
test('clearing a field removes the key, never writes null', () => {
  const raw = '---\ntitle: Hello\nstatus: draft\n---\nbody';
  const out = editField(raw, 'status', undefined);
  expect(out).not.toContain('status');
  expect(out).not.toContain('null');
  expect(parseMarkdown(out).data?.frontmatter).toEqual({ title: 'Hello' });
});
```

So an optional `reviewBy` with no scheduled date should look like this:

```yaml
---
name: Alice
location: new-york
---
```

Not this:

```yaml
---
name: Alice
reviewBy:
location: new-york
---
```

And not this:

```yaml
---
name: Alice
reviewBy: null
location: new-york
---
```

The canonical file format is omission. Clearing the cell removes the key.

## The reader should still tolerate null

Strict writing does not require strict reading. YAML makes `reviewBy:` parse as `null`, and hand-edited markdown folders will contain that shape sooner or later. A local file tool should not turn a mechanical missing spelling into a repair chore.

Matter already has this read contract for required fields:

```typescript
function classifyCell(field: Field, value: unknown): Cell {
  if (value == null) return { field, state: 'MISSING_REQUIRED' };
  if (field.check(value)) return { field, state: 'OK', value };
  return { field, state: 'INVALID', raw: value };
}
```

Absent and explicit YAML null both hit the same branch. Optional fields should keep that branch and change only the verdict:

```txt
missing required field       MISSING_REQUIRED
null required field          MISSING_REQUIRED
missing optional field       MISSING_OPTIONAL
null optional field          MISSING_OPTIONAL
present valid field          OK
present invalid field        INVALID
```

`INVALID` should mean a human needs to decide what value was intended. A string in an integer field is invalid. A malformed URL is invalid. `reviewBy: null` has only one useful repair: delete the key. That is not a human judgment problem.

## Null is normalized before validation

Claude's review sharpened the formal sentence:

```txt
Matter validates dropNullKeys(frontmatter) against the derived object schema.
```

That sentence reconciles tolerant reading with pure JSON Schema fields. Raw `reviewBy: null` would fail the derived JSON Schema object, because `reviewBy` is a date string when present. Matter's folder reader first treats nullish frontmatter values as missing cells. Then it applies row completeness:

```txt
dropNullKeys({ name: "Alice", reviewBy: null })
  = { name: "Alice" }
```

For an optional field, that is valid. For a required field, that needs a value.

This is the same shape as a database projection. Missing optional fields project to SQL `NULL`, but the markdown source does not need to carry `null` as authored data. The typed table can have nullable columns while the file format stays clean.

## Do not use JSON unions for optionality

A union makes optionality look like part of the value:

```json
{
  "anyOf": [
    { "type": "string", "format": "date" },
    { "type": "null" }
  ]
}
```

That is the wrong layer for Matter. It makes `null` a valid value instead of a missing cell state, and it stops the field from being a simple date column. The app would need to unwrap nullable schemas, the grid would need to remember which nulls mean missing, and SQL queries would lose the clean shape that made the field useful.

The useful queries are plain:

```sql
reviewBy <= '2026-07-01'
reviewBy is null and location = 'new-york'
```

The first query finds scheduled reviews. The second finds people with no scheduled date who become relevant when place matters.

## The rule

The implementation rule should be boring:

```txt
Matter never writes null for a cleared field.
Matter clears by deleting the frontmatter key.
Matter reads a missing key as missing.
Matter reads explicit null as missing.
Missing required fields classify as MISSING_REQUIRED.
Missing optional fields classify as MISSING_OPTIONAL.
Present values are validated by the field's JSON Schema.
```

There is one sharp edge worth validating: every name in `optional` should land on a typed modeled field. A typo like `"reviewby"` should not silently do nothing. The model loader should report it.

One implementation boundary matters: widgets should not inspect requiredness. The loaded model may carry `required` so conformance can classify a missing value, but the UI should consume the classified state:

```txt
MISSING_REQUIRED  missing required value
MISSING_OPTIONAL  missing optional value
```

That keeps row policy in the model layer and keeps field widgets focused on rendering present values or a shared missing-value indicator.

The product sentence stays small:

```txt
Matter fields describe present values; Matter optionality describes whether a row may omit them.
```

That keeps markdown clean, keeps JSON Schema honest, and keeps the grid queryable.
