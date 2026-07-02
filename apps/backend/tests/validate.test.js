const {
  validate, ValidationError, required, optional, isString,
  isEmail, minLen, maxLen, oneOf, isBoolean, isArray,
} = require('../src/utils/validate');

describe('validate', () => {
  test('passes and returns trimmed values', () => {
    const out = validate(
      { username: '  admin  ', password: 'secret1' },
      { username: [required, isString], password: [required, minLen(6)] }
    );
    expect(out).toEqual({ username: 'admin', password: 'secret1' });
  });

  test('aggregates one error per field', () => {
    expect.assertions(3);
    try {
      validate(
        { email: 'nope', password: '12' },
        { email: [required, isEmail], password: [required, minLen(6)] }
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.status).toBe(400);
      expect(e.fields).toEqual({
        email: 'Must be a valid email address',
        password: 'Must be at least 6 characters',
      });
    }
  });

  test('required catches missing fields', () => {
    try {
      validate({}, { username: [required], password: [required] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.fields).toEqual({
        username: 'This field is required',
        password: 'This field is required',
      });
    }
  });

  test('optional skips the rest of the chain when absent', () => {
    const out = validate(
      { email: 'a@b.co' },
      { email: [required, isEmail], role: [optional, oneOf(['admin'])] }
    );
    expect(out).toEqual({ email: 'a@b.co' });
  });

  test('optional still validates when a value is present', () => {
    try {
      validate({ role: 'wizard' }, { role: [optional, oneOf(['admin', 'engineer'])] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.fields).toEqual({ role: 'Must be one of: admin, engineer' });
    }
  });

  test('type + length rules', () => {
    try {
      validate(
        { name: 'x'.repeat(300), active: 'yes', ids: 'not-a-list' },
        { name: [maxLen(255)], active: [isBoolean], ids: [isArray] }
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.fields.name).toMatch(/at most 255/);
      expect(e.fields.active).toBe('Must be true or false');
      expect(e.fields.ids).toBe('Must be a list');
    }
  });
});
