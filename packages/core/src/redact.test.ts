import { describe, expect, it } from 'vitest';
import { containsSecret, redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it.each([
    [
      'github classic token',
      'Authenticating with ghp_AbCdEf0123456789AbCdEf0123456789',
      'github_token',
    ],
    [
      'github fine-grained token',
      'token github_pat_11ABCDEFG0aBcDeFgHiJ_kLmNoPqRsTuVwXyZ012345',
      'github_token',
    ],
    ['aws access key id', 'aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'aws_access_key_id'],
    [
      'jwt',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      'jwt',
    ],
    ['slack token', 'xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx', 'slack_token'],
    ['npm token', 'npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789', 'npm_token'],
    ['anthropic key', 'ANTHROPIC key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz', 'api_key'],
    ['bearer header', 'authorization: Bearer abcdef0123456789ABCDEF', 'bearer_token'],
    ['password assignment', 'PGPASSWORD=sup3r-s3cret-value', 'assigned_secret'],
    ['quoted secret', 'api_key: "abcd1234efgh5678"', 'assigned_secret'],
    ['email', 'notify: builds@example.com', 'email'],
  ])('redacts a %s', (_name, input, type) => {
    const output = redactSecrets(input);
    expect(output).toContain(`[REDACTED:${type}]`);
    expect(containsSecret(output)).toBe(false);
  });

  it('redacts a private key block including its body', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAxWPZ0xKz8Zq1lJ7yq3mD9nQ2sT4uV6wX8yZ0aB1cD2eF3gH4iJ',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    const output = redactSecrets(`Loaded key:\n${key}\ndone`);
    expect(output).toBe('Loaded key:\n[REDACTED:private_key]\ndone');
    expect(output).not.toContain('MIIEow');
  });

  it('keeps the host but drops credentials in connection strings', () => {
    const output = redactSecrets('psql postgres://logsy:hunter2@db.internal:5432/logsy failed');
    expect(output).toBe(
      'psql postgres://logsy:[REDACTED:url_credentials]@db.internal:5432/logsy failed',
    );
  });

  it('redacts every secret in a multi-line log', () => {
    const log = [
      '##[group]Run deploy',
      'export GITHUB_TOKEN=ghs_0123456789abcdefABCDEF0123456789abcd',
      'export DATABASE_URL=postgres://app:p4ssw0rd@10.0.0.5:5432/app',
      'curl -H "Authorization: Bearer AbCdEf0123456789XyZ" https://api.example.com',
      '##[error]Process completed with exit code 1.',
    ].join('\n');

    const output = redactSecrets(log);
    expect(output).not.toMatch(/ghs_|p4ssw0rd|AbCdEf0123456789XyZ/);
    expect(output).toContain('##[error]Process completed with exit code 1.');
    expect(output.split('\n')).toHaveLength(5);
  });

  it('leaves ordinary log content alone', () => {
    const log = [
      'Run actions/checkout@v7',
      'Commit 9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456 checked out',
      '  Duration: 12.4s, exit code 137',
      'FAIL src/server.test.ts > returns 401 for an invalid signature',
      'npm ERR! code ERESOLVE',
      'Version 22.13.1 (linux/amd64) at /home/runner/work/logsy/logsy',
      '##[group]GITHUB_TOKEN Permissions',
      'Secret source: Actions',
      'Permissions: none',
    ].join('\n');

    expect(redactSecrets(log)).toBe(log);
  });

  it('is idempotent', () => {
    const once = redactSecrets('token=abcd1234efgh5678 user@example.com');
    expect(redactSecrets(once)).toBe(once);
  });

  it('redacts CLI --password flags', () => {
    const output = redactSecrets('mysql --password s3cr3tV4lue!xyz');
    expect(output).toContain('[REDACTED:cli_secret_flag]');
    expect(output).not.toContain('s3cr3tV4lue!xyz');
  });

  it('does not false-positive on "GITHUB_TOKEN Permissions"', () => {
    const input = '##[group]GITHUB_TOKEN Permissions';
    expect(redactSecrets(input)).toBe(input);
  });

  it('does not false-positive on "Secret source: Actions"', () => {
    const input = 'Secret source: Actions';
    expect(redactSecrets(input)).toBe(input);
  });
});
