/**
 * Cross-client conformance: random documents written by the web client must survive load + save in
 * the C++ client byte-identically. Needs the C++ test binary (`ninja -C bDebug`); skipped otherwise.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { serializeCashGuard } from '../../src/core';
import { randomDocument } from './random-data';

const CPP_TEST = process.env['CASHGUARD_CPP_ROUNDTRIP'] ?? fileURLToPath(new URL('../../../bDebug/cashguard_roundtrip_test', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../generated/', import.meta.url));

it.skipIf(!existsSync(CPP_TEST))('C++ client round-trips random documents written by the web client', () => {
	rmSync(OUTPUT, { recursive: true, force: true });
	mkdirSync(OUTPUT, { recursive: true });
	for (let seed = 1; seed <= 300; seed++) {
		writeFileSync(`${OUTPUT}random-${seed}.json`, serializeCashGuard(randomDocument(seed)));
	}
	const result = spawnSync(CPP_TEST, [OUTPUT], { cwd: OUTPUT, encoding: 'utf8' });
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toContain('300/300');
});

// files of older versions: both clients must upgrade them alike (e.g. derive the same account ids,
// see `legacyAccountIds`); each `legacy/<name>.json` has its upgrade in `legacy/<name>.upgraded.json`
const LEGACY = fileURLToPath(new URL('../fixtures/legacy/', import.meta.url));
const legacyFiles = readdirSync(LEGACY).filter((name) => name.endsWith('.json') && !name.endsWith('.upgraded.json'));

it.skipIf(!existsSync(CPP_TEST)).each(legacyFiles)('C++ client upgrades %s exactly like the web client', (name) => {
	const dir = `${OUTPUT}legacy/`;
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	copyFileSync(`${LEGACY}${name}`, `${dir}${name}`);
	// (the C++ test reports a difference: the upgraded file isn't the old one; its saved copy is what counts)
	spawnSync(CPP_TEST, [name], { cwd: dir, encoding: 'utf8' });
	expect(readFileSync(`${dir}roundtrip_test_output/${name}`, 'utf8')).toBe(readFileSync(`${LEGACY}${name.replace(/\.json$/, '.upgraded.json')}`, 'utf8'));
});
