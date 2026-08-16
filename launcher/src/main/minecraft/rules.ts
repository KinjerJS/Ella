/**
 * Rule evaluation for libraries and launch arguments.
 *
 * Mojang gates libraries and arguments behind rule lists. The semantics are easy to get
 * subtly wrong, and getting them wrong means either missing natives (the game crashes on
 * startup) or extra ones (the game loads the wrong LWJGL). The rules are:
 *
 *   - An empty or absent rule list allows the entry.
 *   - Otherwise the entry starts disallowed and each matching rule sets the action.
 *     Later rules override earlier ones, so order matters.
 *   - A rule with no conditions matches everything.
 */

import os from 'node:os';
import type { Rule } from './types.ts';

export interface OsInfo {
  name: 'windows' | 'osx' | 'linux';
  arch: string;
  version: string;
}

function mapPlatform(platform: NodeJS.Platform): OsInfo['name'] {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'osx';
  return 'linux';
}

/** Mojang uses `x86` for 32-bit, `x86_64` for 64-bit and `arm64` for Apple silicon. */
function mapArch(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'x86_64';
    case 'ia32':
      return 'x86';
    default:
      return arch;
  }
}

export function currentOs(): OsInfo {
  return {
    name: mapPlatform(process.platform),
    arch: mapArch(process.arch),
    version: os.release(),
  };
}

function ruleMatches(rule: Rule, osInfo: OsInfo, features: Record<string, boolean>): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osInfo.name) return false;
    if (rule.os.arch && rule.os.arch !== osInfo.arch) return false;
    // `version` is a regex, e.g. `^10\\.` to single out Windows 10.
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(osInfo.version)) return false;
      } catch {
        // A malformed pattern should not stop the game launching.
        return false;
      }
    }
  }

  if (rule.features) {
    for (const [feature, expected] of Object.entries(rule.features)) {
      if ((features[feature] ?? false) !== expected) return false;
    }
  }

  return true;
}

export function matchesRules(
  rules: Rule[] | undefined,
  features: Record<string, boolean> = {},
  osInfo: OsInfo = currentOs(),
): boolean {
  if (!rules || rules.length === 0) return true;

  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, osInfo, features)) {
      allowed = rule.action === 'allow';
    }
  }
  return allowed;
}
