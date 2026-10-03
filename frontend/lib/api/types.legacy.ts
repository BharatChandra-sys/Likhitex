/**
 * TypeScript types for API responses
 * Matches backend schema definitions
 */

// User & Auth
export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: string;
  storage_used: number;
  storage_limit: number;
}

// Projects
export interface Project {
  id: string;
  title: string;
  owner_id: string;
  owner_name: string;
  created_at: string;
  updated_at: string;
  last_compiled_at?: string;
  compile_status?: 'success' | 'failed' | 'pending' | 'compiling';
  size_bytes: number;
  is_shared: boolean;
  role: 'owner' | 'editor' | 'viewer';
  tags: string[];
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateProjectRequest {
  title: string;
  main_file?: string;
  compiler?: 'pdflatex' | 'xelatex' | 'lualatex';
  init_template?: boolean;
}

// Files
export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified_at?: string;
  children?: FileNode[];
  is_main?: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  modified_at: string;
}

// Compilation
export interface CompileRequest {
  project_id: string;
  compiler?: 'pdflatex' | 'xelatex' | 'lualatex';
  force?: boolean;
}

export interface CompileStatus {
  status: 'success' | 'failed' | 'pending' | 'compiling' | 'queued';
  position?: number;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface CompileError {
  file: string;
  line: number;
  message: string;
  excerpt: string;
  type: 'error' | 'warning';
}

export interface CompileResult {
  status: 'success' | 'failed';
  pdf_url?: string;
  errors: CompileError[];
  warnings: CompileError[];
  log: string;
  duration_ms: number;
}

// Sharing
export interface ProjectMember {
  user_id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: 'owner' | 'editor' | 'viewer';
  added_at: string;
  status: 'active' | 'pending' | 'not_invited';
}

export interface ShareProjectRequest {
  email: string;
  role: 'editor' | 'viewer';
}

export interface UpdateMemberRoleRequest {
  role: 'editor' | 'viewer';
}

// Storage
export interface StorageBreakdown {
  source_files: number;
  images: number;
  pdfs_and_history: number;
  total: number;
  limit: number;
  percentage: number;
}

export interface LargestProject {
  id: string;
  title: string;
  size_bytes: number;
  last_modified: string;
}

export interface StorageStats {
  total_used: number;
  limit: number;
  breakdown: StorageBreakdown;
  largest_projects: LargestProject[];
}

// History
export interface Version {
  id: string;
  project_id: string;
  commit_hash: string;
  author_id: string;
  author_name: string;
  author_initials: string;
  created_at: string;
  message: string;
  changes_summary: string;
  label?: string;
  is_labeled: boolean;
}

export interface DiffLine {
  line_number: number;
  type: 'add' | 'remove' | 'context';
  content: string;
}

export interface FileDiff {
  path: string;
  old_content: string;
  new_content: string;
  diff_lines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface VersionComparison {
  old_version: Version;
  new_version: Version;
  file_diffs: FileDiff[];
}

// WebSocket
export interface WebSocketTicket {
  ticket: string;
  expires_at: string;
  project_id: string;
}

// Tags
export interface Tag {
  id: string;
  name: string;
  color: string;
  project_count: number;
}
