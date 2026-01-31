import type { Backend } from '../types.js';
import type { Issue, NewIssue, NewComment, Comment } from '../../types.js';
import { readConfig, writeConfig, type Config } from './config.js';
import { readIssue, writeIssue, deleteIssue as removeIssueFile, listIssueFiles, parseIssueFile } from './issues.js';
import fs from 'node:fs';

export class LocalBackend implements Backend {
  private root: string;
  private config: Config;

  constructor(root: string) {
    this.root = root;
    this.config = readConfig(root);
  }

  private save(): void {
    writeConfig(this.root, this.config);
  }

  getStatuses(): string[] {
    return this.config.statuses;
  }

  getIterations(): string[] {
    return this.config.iterations;
  }

  getCurrentIteration(): string {
    return this.config.current_iteration;
  }

  setCurrentIteration(name: string): void {
    this.config.current_iteration = name;
    if (!this.config.iterations.includes(name)) {
      this.config.iterations.push(name);
    }
    this.save();
  }

  listIssues(iteration?: string): Issue[] {
    const files = listIssueFiles(this.root);
    const issues = files.map(f => {
      const raw = fs.readFileSync(f, 'utf-8');
      return parseIssueFile(raw);
    });
    if (iteration) return issues.filter(i => i.iteration === iteration);
    return issues;
  }

  getIssue(id: number): Issue {
    return readIssue(this.root, id);
  }

  createIssue(data: NewIssue): Issue {
    const now = new Date().toISOString();
    const issue: Issue = {
      ...data,
      id: this.config.next_id,
      created: now,
      updated: now,
      comments: [],
    };
    this.config.next_id++;
    if (data.iteration && !this.config.iterations.includes(data.iteration)) {
      this.config.iterations.push(data.iteration);
    }
    this.save();
    writeIssue(this.root, issue);
    return issue;
  }

  updateIssue(id: number, data: Partial<Issue>): Issue {
    const issue = this.getIssue(id);
    const updated = { ...issue, ...data, id, updated: new Date().toISOString() };
    writeIssue(this.root, updated);
    return updated;
  }

  deleteIssue(id: number): void {
    removeIssueFile(this.root, id);
  }

  addComment(issueId: number, comment: NewComment): Comment {
    const issue = this.getIssue(issueId);
    const newComment: Comment = {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
    issue.comments.push(newComment);
    issue.updated = new Date().toISOString();
    writeIssue(this.root, issue);
    return newComment;
  }
}
