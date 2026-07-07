// Tiny dependency-free request validator.
//
// Usage:
//   const data = validate(req.body, {
//     username: [required, isString, maxLen(100)],
//     email:    [required, isEmail],
//     password: [required, minLen(6)],
//     role:     [optional, isString, oneOf(VALID_ROLES)],
//   });
//
// Each field maps to an ordered list of rules. A rule returns undefined when
// the value is acceptable, or a string message when it is not. `optional`
// short-circuits the remaining rules when the value is absent.
//
// On failure it throws a ValidationError -> the central errorHandler turns it
// into: 400 { error, fields: { <field>: <message> } }.
// On success it returns the validated (and coerced) subset of the input.

class ValidationError extends Error {
  constructor(fields) {
    super('Validation failed');
    this.status = 400;
    this.fields = fields;
  }
}

// Sentinel used to stop a field's rule chain early (optional + absent value).
const SKIP = Symbol('skip');

const isAbsent = (v) => v === undefined || v === null || v === '';

// --- rules -----------------------------------------------------------------
const required = (v) => (isAbsent(v) ? 'This field is required' : undefined);

// Marks a field optional: if absent, skip the rest of its chain.
const optional = (v) => (isAbsent(v) ? SKIP : undefined);

const isString = (v) => (typeof v === 'string' ? undefined : 'Must be text');

const isBoolean = (v) => (typeof v === 'boolean' ? undefined : 'Must be true or false');

const isArray = (v) => (Array.isArray(v) ? undefined : 'Must be a list');

const minLen = (n) => (v) =>
  typeof v === 'string' && v.length < n ? `Must be at least ${n} characters` : undefined;

const maxLen = (n) => (v) =>
  typeof v === 'string' && v.length > n ? `Must be at most ${n} characters` : undefined;

const oneOf = (allowed) => (v) =>
  allowed.includes(v) ? undefined : `Must be one of: ${allowed.join(', ')}`;

// Rejects any whitespace (e.g. usernames must be a single token).
const noSpaces = (v) =>
  typeof v === 'string' && /\s/.test(v) ? 'Cannot contain spaces' : undefined;

// Deliberately simple email shape check (server is not an email verifier).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (v) =>
  typeof v === 'string' && EMAIL_RE.test(v) ? undefined : 'Must be a valid email address';

// --- runner ----------------------------------------------------------------
function validate(input, schema) {
  const body = input || {};
  const fields = {};
  const out = {};

  for (const [name, rules] of Object.entries(schema)) {
    let value = body[name];
    if (typeof value === 'string') value = value.trim();

    let failed = false;
    for (const rule of rules) {
      const result = rule(value);
      if (result === SKIP) break; // optional + absent: accept as-is, stop.
      if (typeof result === 'string') {
        fields[name] = result;
        failed = true;
        break; // first error per field wins.
      }
    }
    if (!failed && !isAbsent(value)) out[name] = value;
  }

  if (Object.keys(fields).length) throw new ValidationError(fields);
  return out;
}

module.exports = {
  validate,
  ValidationError,
  required,
  optional,
  isString,
  isBoolean,
  isArray,
  minLen,
  maxLen,
  oneOf,
  noSpaces,
  isEmail,
};
