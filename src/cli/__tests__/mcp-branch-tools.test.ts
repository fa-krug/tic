import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Backend } from '../../backends/types.js';
import { BACKEND_CAPABILITIES } from '../../backends/capabilities.js';
import { registerTools, createDeleteTracker } from '../commands/mcp.js';

function registeredToolNames(root: string, gitCwd?: string): string[] {
  const names: string[] = [];
  const server = {
    tool: (name: string) => {
      names.push(name);
    },
  } as unknown as McpServer;
  const backend = {
    getCapabilities: () => BACKEND_CAPABILITIES['github']!,
  } as unknown as Backend;
  registerTools(
    server,
    backend,
    createDeleteTracker(),
    root,
    undefined,
    gitCwd,
  );
  return names;
}

describe('registerTools branch tools', () => {
  let projectRoot: string;
  let gitDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-mcp-root-'));
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-mcp-git-'));
    execFileSync('git', ['init'], { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('gates branch tools on the git cwd, not the project root', () => {
    // In a linked worktree `.tic/` lives in the main checkout while branch
    // operations must run in the worktree.
    expect(registeredToolNames(projectRoot, gitDir)).toContain(
      'tic-list_branches',
    );
  });

  it('defaults the git cwd to the project root', () => {
    expect(registeredToolNames(projectRoot)).not.toContain('tic-list_branches');
    expect(registeredToolNames(gitDir)).toContain('tic-list_branches');
  });
});
